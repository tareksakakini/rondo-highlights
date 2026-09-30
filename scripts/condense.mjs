#!/usr/bin/env node
// Condensed cuts (experimental). Runs after `npm run ingest` and `npm run crests`.
//
// For every extended highlight in the published data, read the chapters YouTube
// shows on its watch page, turn them into key moments (scripts/lib/condense.mjs)
// and write public/data/condensed.json: { "<videoId>": { m: [[start, end], ...], s: seconds } }.
// The site reads that file only when a visitor turns on "Condensed extended cuts",
// and round files are left untouched, so switching the feature off (or deleting
// the file) leaves the rest of the site exactly as before.
//
// Chapters aren't in the YouTube Data API, so this reads the public watch page.
// To keep that light: each video's chapters are cached in cache/chapters.json and
// fetched once (videos without chapters yet are retried a few times, since YouTube
// adds them some hours after upload), at most MAX_FETCHES pages per run, one at a
// time, and the run stops fetching as soon as YouTube answers with anything other
// than a normal watch page. Never fails the workflow: problems are logged.
//
//   node scripts/condense.mjs [dataDir]      (default: public/data)
//   CONDENSE_MAX=300 npm run condense       (read more watch pages this run, e.g. a first backfill)

import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseChapters, momentsFor, goalsIn, MAX_VIDEO_SEC } from './lib/condense.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SKIP_DIRS = new Set(['cache', 'crests', '.git']);

export const MAX_FETCHES = Number(process.env.CONDENSE_MAX) || 40;
const GAP_MS = 1500;
const RETRY_AFTER_H = 8;
const MAX_TRIES = 4;
const STOP_AFTER_FAILURES = 3;

async function readJson(p, fallback) {
  try { return JSON.parse(await fs.readFile(p, 'utf8')); } catch { return fallback; }
}

/** Every extended highlight in the round files, newest first, with its match's goal count. */
export async function extendedVideos(dir) {
  const out = new Map();
  const comps = (await fs.readdir(dir, { withFileTypes: true })).filter((d) => d.isDirectory() && !SKIP_DIRS.has(d.name));
  for (const c of comps) {
    for (const f of await fs.readdir(path.join(dir, c.name))) {
      if (!f.endsWith('.json')) continue;
      const round = await readJson(path.join(dir, c.name, f), null);
      for (const m of round?.matches ?? []) {
        for (const h of m.highlights ?? []) {
          if (h.kind !== 'extended' || !h.durationSec || h.durationSec > MAX_VIDEO_SEC || out.has(h.videoId)) continue;
          out.set(h.videoId, { videoId: h.videoId, durationSec: h.durationSec, publishedAt: h.publishedAt, goals: goalsIn(m) });
        }
      }
    }
  }
  return [...out.values()].sort((a, b) => Date.parse(b.publishedAt) - Date.parse(a.publishedAt));
}

/** Should this video's watch page be (re)read this run? */
export function needsFetch(entry, now = Date.now()) {
  if (!entry) return true;
  if (entry.ch) return false; // chapters found: they don't change
  return (entry.n ?? 1) < MAX_TRIES && now - Date.parse(entry.at) > RETRY_AFTER_H * 3600e3;
}

async function fetchWatchPage(videoId) {
  const r = await fetch(`https://www.youtube.com/watch?v=${videoId}&hl=en`, {
    headers: { 'accept-language': 'en-US,en;q=0.8' },
    redirect: 'manual',
  });
  if (r.status !== 200) return { ok: false, why: `HTTP ${r.status}` };
  const chapters = parseChapters(await r.text());
  if (chapters === null) return { ok: false, why: 'no page data (consent or bot check?)' };
  return { ok: true, chapters };
}

export async function main(dir = path.join(ROOT, 'public', 'data'), { fetchPage = fetchWatchPage, gapMs = GAP_MS, maxFetches = MAX_FETCHES, log = console.log } = {}) {
  const cachePath = path.join(dir, 'cache', 'chapters.json');
  const cache = await readJson(cachePath, {});
  const videos = await extendedVideos(dir);
  const now = Date.now();

  let fetched = 0; let failures = 0; let stopped = null;
  for (const v of videos) {
    if (fetched >= maxFetches || stopped) break;
    if (!needsFetch(cache[v.videoId], now)) continue;
    if (fetched) await new Promise((r) => setTimeout(r, gapMs));
    fetched++;
    let res;
    try { res = await fetchPage(v.videoId); } catch (e) { res = { ok: false, why: e.message }; }
    if (!res.ok) {
      failures++;
      log(`  ${v.videoId}: ${res.why}`);
      if (failures >= STOP_AFTER_FAILURES) stopped = res.why;
      continue;
    }
    failures = 0;
    const prev = cache[v.videoId];
    cache[v.videoId] = res.chapters.length
      ? { at: new Date(now).toISOString(), ch: res.chapters.map((c) => [c.start, c.title]) }
      : { at: new Date(now).toISOString(), ch: null, n: (prev?.n ?? 0) + 1 };
  }

  // Forget videos that are no longer published.
  const live = new Set(videos.map((v) => v.videoId));
  for (const id of Object.keys(cache)) if (!live.has(id)) delete cache[id];

  const out = {};
  let gated = 0;
  for (const v of videos) {
    const ch = cache[v.videoId]?.ch;
    if (!ch) continue;
    const r = momentsFor(ch.map(([start, title]) => ({ start, title })), v.durationSec, v.goals);
    if (r) out[v.videoId] = r; else gated++;
  }
  const withChapters = videos.filter((v) => cache[v.videoId]?.ch).length;

  await fs.mkdir(path.dirname(cachePath), { recursive: true });
  await fs.writeFile(cachePath, JSON.stringify(sortKeys(cache)));
  await fs.writeFile(path.join(dir, 'condensed.json'), JSON.stringify(sortKeys(out)));

  log(`condensed cuts: ${videos.length} extended videos, ${fetched} watch page(s) read, ${withChapters} with chapters, `
    + `${Object.keys(out).length} condensed, ${gated} left in full (fewer chapters than goals or no saving)`);
  if (stopped) log(`  stopped reading watch pages this run: ${stopped}`);
  return { videos: videos.length, fetched, withChapters, condensed: Object.keys(out).length, stopped };
}

function sortKeys(o) {
  return Object.fromEntries(Object.keys(o).sort().map((k) => [k, o[k]]));
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main(process.argv[2] ? path.resolve(process.argv[2]) : undefined).catch((e) => {
    console.log(`condensed cuts: skipped (${e.message})`);
  });
}
