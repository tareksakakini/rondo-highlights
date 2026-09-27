#!/usr/bin/env node
// Rondo data ingestion.
//
//   npm run ingest                      # all competitions, last ~10 days of uploads
//   npm run ingest -- --only=PL,CL      # subset
//   npm run ingest -- --since=2026-08-15  # backfill further back (costs more quota)
//   npm run ingest -- --dry             # print a summary, write nothing
//
// Reads FOOTBALL_DATA_KEY and YOUTUBE_API_KEY from .env (or the environment).
// Writes public/data/index.json and public/data/<CODE>/<round>.json.
//
// Quota: football-data.org free tier = 10 req/min (we make 1 per competition).
// YouTube Data API = 10,000 units/day; a normal run uses ~30–80 units
// (channels.list 1u, playlistItems.list 1u/page, videos.list 1u/50 ids). No search.list.

import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  COMPETITIONS, REGION, MATCH_WINDOW_HOURS, DEFAULT_LOOKBACK_DAYS, MAX_PAGES_PER_CHANNEL,
} from './config.mjs';
import { looksLikeMatchHighlight, matchVideosToFixtures, buildCompetition } from './lib/match.mjs';
import { writeDataset, readPrevious } from './lib/output.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

// ---------- env / args ----------
async function loadEnv() {
  try {
    const txt = await fs.readFile(path.join(ROOT, '.env'), 'utf8');
    for (const line of txt.split(/\r?\n/)) {
      const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/);
      if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^['"]|['"]$/g, '');
    }
  } catch { /* no .env — fall back to real env vars */ }
}

const args = Object.fromEntries(
  process.argv.slice(2).map((a) => {
    const [k, v] = a.replace(/^--/, '').split('=');
    return [k, v ?? true];
  }),
);

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const log = (...a) => console.log(...a);

function currentSeason(d = new Date()) {
  return d.getUTCMonth() >= 6 ? d.getUTCFullYear() : d.getUTCFullYear() - 1; // season starts ~July
}

// ---------- football-data.org ----------
async function fdFetch(url, key, attempt = 0) {
  const res = await fetch(url, { headers: { 'X-Auth-Token': key } });
  if (res.status === 429 && attempt < 3) {
    const wait = Number(res.headers.get('x-requestcounter-reset') ?? 60) * 1000;
    log(`  football-data rate limit — waiting ${Math.round(wait / 1000)}s`);
    await sleep(wait);
    return fdFetch(url, key, attempt + 1);
  }
  if (!res.ok) throw new Error(`football-data ${res.status}: ${await res.text()}`);
  return res.json();
}

async function fetchFixtures(code, season, key) {
  const data = await fdFetch(`https://api.football-data.org/v4/competitions/${code}/matches?season=${season}`, key);
  return data.matches ?? [];
}

// ---------- YouTube Data API ----------
let quota = 0;
async function yt(endpoint, params, key) {
  const u = new URL(`https://www.googleapis.com/youtube/v3/${endpoint}`);
  for (const [k, v] of Object.entries({ ...params, key })) u.searchParams.set(k, v);
  const res = await fetch(u);
  quota += 1;
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`YouTube ${endpoint} ${res.status}: ${body.slice(0, 300)}`);
  }
  return res.json();
}

const channelCache = new Map();
async function resolveChannel(handle, key) {
  if (channelCache.has(handle)) return channelCache.get(handle);
  const data = await yt('channels', { part: 'snippet,contentDetails', forHandle: handle }, key);
  const item = data.items?.[0];
  const info = item
    ? { id: item.id, title: item.snippet.title, uploads: item.contentDetails.relatedPlaylists.uploads }
    : null;
  channelCache.set(handle, info);
  return info;
}

const uploadsCache = new Map();
async function recentUploads(channel, sinceMs, key) {
  const cacheKey = `${channel.id}@${sinceMs}`;
  if (uploadsCache.has(cacheKey)) return uploadsCache.get(cacheKey);
  const out = [];
  let pageToken;
  for (let page = 0; page < MAX_PAGES_PER_CHANNEL; page++) {
    const data = await yt('playlistItems', {
      part: 'snippet,contentDetails', playlistId: channel.uploads, maxResults: 50, ...(pageToken ? { pageToken } : {}),
    }, key);
    let older = false;
    for (const it of data.items ?? []) {
      const published = it.contentDetails.videoPublishedAt ?? it.snippet.publishedAt;
      if (Date.parse(published) < sinceMs) { older = true; continue; }
      out.push({ videoId: it.contentDetails.videoId, title: it.snippet.title, publishedAt: published });
    }
    pageToken = data.nextPageToken;
    if (older || !pageToken) break;
  }
  uploadsCache.set(cacheKey, out);
  return out;
}

function isoDurationToSec(iso) {
  const m = /P(?:(\d+)D)?T?(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?/.exec(iso ?? '');
  if (!m) return 0;
  const [, d, h, mi, s] = m.map((x) => Number(x ?? 0));
  return d * 86400 + h * 3600 + mi * 60 + s;
}

const detailsCache = new Map();
async function videoDetails(ids, key) {
  const need = ids.filter((id) => !detailsCache.has(id));
  for (let i = 0; i < need.length; i += 50) {
    const data = await yt('videos', { part: 'contentDetails,status,snippet', id: need.slice(i, i + 50).join(',') }, key);
    for (const v of data.items ?? []) {
      const rr = v.contentDetails.regionRestriction;
      const blocked = rr && ((rr.blocked ?? []).includes(REGION) || (rr.allowed && !rr.allowed.includes(REGION)));
      detailsCache.set(v.id, {
        durationSec: isoDurationToSec(v.contentDetails.duration),
        embeddable: v.status.embeddable !== false && v.status.privacyStatus === 'public' && !blocked,
        live: v.snippet.liveBroadcastContent !== 'none',
      });
    }
    for (const id of need.slice(i, i + 50)) if (!detailsCache.has(id)) detailsCache.set(id, null);
  }
  return ids.map((id) => detailsCache.get(id));
}

// ---------- main ----------
async function main() {
  await loadEnv();
  const FD = process.env.FOOTBALL_DATA_KEY;
  const YT = process.env.YOUTUBE_API_KEY;
  if (!FD || !YT) {
    console.error('Missing FOOTBALL_DATA_KEY or YOUTUBE_API_KEY. Add them to .env (see .env.example).');
    process.exit(1);
  }

  const season = Number(args.season ?? currentSeason());
  const only = args.only ? String(args.only).split(',').map((s) => s.trim().toUpperCase()) : null;
  const sinceMs = args.since
    ? Date.parse(String(args.since))
    : Date.now() - DEFAULT_LOOKBACK_DAYS * 86400e3;
  const comps = COMPETITIONS.filter((c) => !only || only.includes(c.code));

  log(`Rondo ingest — season ${season}, uploads since ${new Date(sinceMs).toISOString().slice(0, 10)}, region ${REGION}`);
  const results = [];

  for (const [i, comp] of comps.entries()) {
    if (i > 0) await sleep(6500); // stay under football-data's 10 req/min
    log(`\n▸ ${comp.name} (${comp.code})`);
    const fixtures = await fetchFixtures(comp.code, season, FD);
    log(`  ${fixtures.length} fixtures`);

    // Collect candidate uploads from every configured channel.
    const candidates = [];
    for (const [priority, ch] of comp.channels.entries()) {
      let info;
      try { info = await resolveChannel(ch.handle, YT); } catch (e) { log(`  ! ${ch.handle}: ${e.message}`); continue; }
      if (!info) { log(`  ! ${ch.handle}: handle not found — skipped`); continue; }
      const uploads = await recentUploads(info, sinceMs, YT);
      const must = ch.mustMatch ? new RegExp(ch.mustMatch, 'i') : null;
      const keep = uploads.filter((u) => looksLikeMatchHighlight(u.title) && (!must || must.test(u.title)));
      log(`  ${info.title.padEnd(28)} ${String(uploads.length).padStart(4)} uploads → ${keep.length} candidates`);
      for (const u of keep) candidates.push({ ...u, channel: info.title, channelId: info.id, priority });
    }

    const details = await videoDetails([...new Set(candidates.map((c) => c.videoId))], YT);
    const byId = new Map([...new Set(candidates.map((c) => c.videoId))].map((id, k) => [id, details[k]]));
    const videos = candidates
      .map((c) => ({ ...c, ...(byId.get(c.videoId) ?? { durationSec: 0, embeddable: false }) }))
      .filter((v) => !v.live);
    const blocked = videos.filter((v) => !v.embeddable).length;
    if (blocked) log(`  ${blocked} candidate(s) skipped: embedding disabled or blocked in ${REGION}`);

    const highlights = matchVideosToFixtures(fixtures, videos, { windowHours: MATCH_WINDOW_HOURS });
    const previous = await readPrevious(ROOT, comp.code, season);
    const built = buildCompetition(comp, season, fixtures, highlights, previous);
    const cur = built.index.rounds.find((r) => r.key === built.index.currentRound);
    log(`  matched ${highlights.size} matches · current: ${cur?.label ?? '—'} (${cur?.withHighlights ?? 0}/${cur?.matches ?? 0} with highlights)`);
    results.push(built);
  }

  log(`\nYouTube quota used: ~${quota} units (daily limit 10,000)`);
  if (args.dry) { log('Dry run — nothing written.'); return; }
  await writeDataset(ROOT, results, { source: 'live', merge: !!only });
  log('Wrote public/data/. Run `npm run dev` to watch.');
}

main().catch((e) => {
  const hint = e.message === 'fetch failed' ? ' — network error: can this machine reach api.football-data.org and www.googleapis.com?' : '';
  console.error(`\n✖ ${e.message}${hint}`);
  process.exit(1);
});
