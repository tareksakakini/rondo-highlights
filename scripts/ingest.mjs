#!/usr/bin/env node
// Rondo Highlights data ingestion.
//
//   npm run ingest                         # every competition, last ~10 days of uploads
//   npm run ingest -- --only=PL,CL         # subset (also forces archive competitions like WC)
//   npm run ingest -- --since=2026-08-15   # backfill further back (reads up to 60 pages per channel)
//   npm run ingest -- --pages=20           # override how many upload pages to read per channel
//   npm run ingest -- --dry                # print a summary, write nothing
//
// Reads FOOTBALL_DATA_KEY and YOUTUBE_API_KEY from .env (or the environment).
// Writes public/data/index.json and public/data/<CODE>/<round>.json.
//
// Global audience: every embeddable video is kept with its YouTube country
// restrictions (allow/block lists); the site picks what plays in each visitor's country.
//
// Quota: football-data.org free tier = 10 req/min (one call per fixture competition).
// YouTube Data API = 10,000 units/day. A normal run uses a few hundred units
// (channels.list 1u per channel, playlistItems.list 1u/page, videos.list 1u/50 ids). No search.list.

import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { COMPETITIONS, MATCH_WINDOW_HOURS, DEFAULT_LOOKBACK_DAYS, MAX_PAGES_PER_CHANNEL } from './config.mjs';
import { looksLikeMatchHighlight, matchVideosToFixtures, buildCompetition, detectComps, indexFor } from './lib/match.mjs';
import { makeRegistry, buildFromVideos } from './lib/videos.mjs';
import { writeDataset, readPrevious, readIndex } from './lib/output.mjs';

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
  if (!res.ok) {
    const err = new Error(`football-data ${res.status}: ${(await res.text()).slice(0, 200)}`);
    err.status = res.status;
    throw err;
  }
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
async function recentUploads(channel, sinceMs, key, maxPages = MAX_PAGES_PER_CHANNEL) {
  const cacheKey = `${channel.id}@${sinceMs}@${maxPages}`;
  if (uploadsCache.has(cacheKey)) return uploadsCache.get(cacheKey);
  const out = [];
  let pageToken;
  for (let page = 0; page < maxPages; page++) {
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
      const rr = v.contentDetails.regionRestriction ?? {};
      detailsCache.set(v.id, {
        durationSec: isoDurationToSec(v.contentDetails.duration),
        embeddable: v.status.embeddable !== false && v.status.privacyStatus === 'public',
        live: v.snippet.liveBroadcastContent !== 'none',
        allow: rr.allowed?.length ? [...rr.allowed].sort() : undefined,
        block: rr.blocked?.length ? [...rr.blocked].sort() : undefined,
      });
    }
    for (const id of need.slice(i, i + 50)) if (!detailsCache.has(id)) detailsCache.set(id, null);
  }
  return ids.map((id) => detailsCache.get(id));
}

// ---------- main ----------
/** Upload candidates for one competition from all its channels. */
async function collectCandidates(comp, sinceMs, YT, maxPages) {
  const candidates = [];
  for (const [priority, ch] of comp.channels.entries()) {
    let info;
    try { info = await resolveChannel(ch.handle, YT); } catch (e) { log(`  ! ${ch.handle}: ${e.message}`); continue; }
    if (!info) { log(`  ! ${ch.handle}: handle not found, skipped`); continue; }
    const uploads = await recentUploads(info, sinceMs, YT, maxPages);
    const must = ch.mustMatch ? new RegExp(ch.mustMatch, 'i') : null;
    const keep = uploads.filter((u) => {
      if (!looksLikeMatchHighlight(u.title) || (must && !must.test(u.title))) return false;
      const hints = detectComps(u.title);
      return !hints.size || hints.has(comp.code);
    });
    if (keep.length) log(`  ${info.title.slice(0, 30).padEnd(30)} ${String(uploads.length).padStart(4)} uploads → ${keep.length} candidates`);
    for (const u of keep) candidates.push({ ...u, channel: info.title, channelId: info.id, priority, tier: ch.tier });
  }
  const ids = [...new Set(candidates.map((c) => c.videoId))];
  const details = await videoDetails(ids, YT);
  const byId = new Map(ids.map((id, k) => [id, details[k]]));
  const videos = candidates
    .map((c) => ({ ...c, ...(byId.get(c.videoId) ?? { durationSec: 0, embeddable: false }) }))
    .filter((v) => !v.live);
  const blocked = videos.filter((v) => !v.embeddable).length;
  if (blocked) log(`  ${blocked} candidate(s) skipped: embedding disabled by the channel`);
  const limited = videos.filter((v) => v.embeddable && (v.allow || v.block)).length;
  if (limited) log(`  ${limited} candidate(s) are limited to some countries (kept, filtered per visitor)`);
  return videos;
}

/**
 * Re-check every stored highlight: refresh its country restrictions and drop videos
 * that were deleted, made private or had embedding switched off since we found them.
 * ~1 quota unit per 50 videos.
 */
async function refreshStored(comp, built, YT) {
  const ids = [...new Set(built.files.flatMap((f) => f.matches.flatMap((m) => m.highlights.map((h) => h.videoId))))];
  if (!ids.length) return built;
  const details = await videoDetails(ids, YT);
  const byId = new Map(ids.map((id, k) => [id, details[k]]));
  let dropped = 0;
  for (const f of built.files) {
    for (const m of f.matches) {
      m.highlights = m.highlights.filter((h) => {
        const d = byId.get(h.videoId);
        if (!d || !d.embeddable) { dropped++; return false; }
        delete h.allow; delete h.block;
        if (d.allow) h.allow = d.allow;
        if (d.block) h.block = d.block;
        return true;
      });
    }
  }
  if (dropped) log(`  removed ${dropped} video(s) that are no longer available`);
  let files = built.files;
  if (comp.source === 'videos') {
    // Discovered matches only exist through their videos.
    files = files.map((f) => ({ ...f, matches: f.matches.filter((m) => m.highlights.length) })).filter((f) => f.matches.length);
  }
  return { files, index: indexFor(comp, built.index.season, files) };
}

async function main() {
  await loadEnv();
  const FD = process.env.FOOTBALL_DATA_KEY;
  const YT = process.env.YOUTUBE_API_KEY;
  if (!FD || !YT) {
    console.error('Missing FOOTBALL_DATA_KEY or YOUTUBE_API_KEY. Add them to .env (see .env.example).');
    process.exit(1);
  }

  const defaultSeason = Number(args.season ?? currentSeason());
  const only = args.only ? String(args.only).split(',').map((s) => s.trim().toUpperCase()) : null;
  const globalSince = args.since ? Date.parse(String(args.since)) : Date.now() - DEFAULT_LOOKBACK_DAYS * 86400e3;
  // Backfills (--since) may need to page further back through busy channels.
  const pagesFor = (comp) => Number(args.pages ?? (args.since ? 60 : comp.maxPages ?? MAX_PAGES_PER_CHANNEL));
  const published = await readIndex(ROOT);
  const has = (code) => published?.competitions?.some((c) => c.code === code && c.source === 'live');

  const comps = COMPETITIONS.filter((c) => {
    if (only) return only.includes(c.code);
    if (c.archive && has(c.code)) return false; // finished tournament already ingested
    return true;
  });

  log(`Rondo ingest: ${comps.map((c) => c.code).join(', ')} · uploads since ${new Date(globalSince).toISOString().slice(0, 10)}`);
  const results = [];
  const knownTeams = new Map(); // for video-first competitions
  let fdCalls = 0;

  // Fixture competitions first (they also teach us club names for the video-first ones).
  for (const comp of comps.filter((c) => c.source === 'fixtures')) {
    const season = comp.season ?? defaultSeason;
    if (fdCalls++ > 0) await sleep(6500); // stay under football-data's 10 req/min
    log(`\n▸ ${comp.name} (${comp.code}) ${season}`);
    let fixtures;
    try {
      fixtures = await fetchFixtures(comp.code, season, FD);
    } catch (e) {
      if (e.status === 403 || e.status === 404) { log(`  not available on this football-data.org plan, skipped`); continue; }
      throw e;
    }
    log(`  ${fixtures.length} fixtures`);
    for (const f of fixtures) for (const t of [f.homeTeam, f.awayTeam]) if (t?.id) knownTeams.set(t.id, t);
    if (!fixtures.length) continue;

    const sinceMs = comp.since && !args.since ? Date.parse(comp.since) : globalSince;
    const videos = await collectCandidates(comp, sinceMs, YT, pagesFor(comp));
    const highlights = matchVideosToFixtures(fixtures, videos, { windowHours: MATCH_WINDOW_HOURS });
    const previous = await readPrevious(ROOT, comp.code, season);
    const built = await refreshStored(comp, buildCompetition(comp, season, fixtures, highlights, previous), YT);
    const cur = built.index.rounds.find((r) => r.key === built.index.currentRound);
    log(`  matched ${highlights.size} matches · current: ${cur?.label ?? '-'} (${cur?.withHighlights ?? 0}/${cur?.matches ?? 0} with highlights)`);
    results.push(built);
  }

  // Video-first competitions (Europa League, Nations League).
  const canonical = makeRegistry([...knownTeams.values()]);
  for (const comp of comps.filter((c) => c.source === 'videos')) {
    const season = comp.season ?? defaultSeason;
    log(`\n▸ ${comp.name} (${comp.code}) ${season} · discovered from highlight titles`);
    const sinceMs = comp.since && !args.since ? Date.parse(comp.since) : globalSince;
    const videos = await collectCandidates(comp, sinceMs, YT, pagesFor(comp));
    const previous = await readPrevious(ROOT, comp.code, season);
    const built = await refreshStored(comp, buildFromVideos(comp, season, videos, canonical, previous), YT);
    const n = built.files.reduce((a, f) => a + f.matches.length, 0);
    log(`  ${n} matches in ${built.files.length} rounds`);
    results.push(built);
  }

  log(`\nYouTube quota used: ~${quota} units (daily limit 10,000)`);
  if (args.dry) { log('Dry run: nothing written.'); return; }
  await writeDataset(ROOT, results, { source: 'live', merge: true });
  log('Wrote public/data/.');
}

main().catch((e) => {
  const hint = e.message === 'fetch failed' ? ' — network error: can this machine reach api.football-data.org and www.googleapis.com?' : '';
  console.error(`\n✖ ${e.message}${hint}`);
  process.exit(1);
});
