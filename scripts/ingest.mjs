#!/usr/bin/env node
// Rondo Highlights data ingestion.
//
//   npm run ingest                         # every competition, last ~10 days of uploads
//   npm run ingest -- --only=PL,CL         # subset (also forces archive competitions like WC)
//   npm run ingest -- --since=2026-08-15   # backfill further back (reads up to 60 pages per channel)
//   npm run ingest -- --pages=20           # override how many upload pages to read per channel
//   npm run ingest -- --fresh=EL,UNL       # rebuild competitions from scratch (forget earlier matches)
//   npm run ingest -- --dry                # print a summary, write nothing
//
//   npm run ingest -- --refresh-fixtures   # re-download Highlightly fixtures now (normally once a day)
//   npm run ingest -- --quick --only=PL,PD # a quick run while matches finish (see "Quick runs" below)
//
// Quick runs (--quick) are what the refresh clock (scripts/refresh-clock.mjs) starts every
// ~10 minutes while matches finish. They read each channel only from a little before its
// last read (club and federation channels at most every CLUB_EVERY_MIN), re-check only
// recently published highlights, and refresh Highlightly scores at most every
// HL_DATES_EVERY_MIN. A full run (the default, about once a day) reads DEFAULT_LOOKBACK_DAYS
// of uploads from every channel and re-checks every stored highlight, which also picks up
// anything quick runs missed and re-matches recent videos after a matcher fix.
//
// Reads FOOTBALL_DATA_KEY, YOUTUBE_API_KEY and HIGHLIGHTLY_API_KEY from .env (or the environment).
// Writes public/data/index.json and public/data/<CODE>/<round>.json, plus public/data/cache/
// (Highlightly fixture cache, and unmatched.json: highlight-looking videos no fixture claimed).
//
// Global audience: every embeddable video is kept with its YouTube country
// restrictions (allow/block lists); the site picks what plays in each visitor's country.
//
// Quota: football-data.org free tier = 10 req/min (one call per fixture competition).
// Highlightly free plan = 100 req/day: a full fixture download (~5 requests for EL + UNL)
// once a day, then only the dates with unfinished recent matches (0-2 requests a run).
// YouTube Data API = 10,000 units/day. A full run uses ~150 units, a quick run ~5-60
// (playlistItems.list 1u/page, videos.list 1u/50 ids, channels.list 1u per channel but only
// about once a week: ids are kept in cache/channels.json). No search.list.

import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { COMPETITIONS, MATCH_WINDOW_HOURS, DEFAULT_LOOKBACK_DAYS, MAX_PAGES_PER_CHANNEL } from './config.mjs';
import { withEmbedBlocks, looksLikeMatchHighlight, highlightLength, matchVideosToFixtures, buildCompetition, detectComps, indexFor } from './lib/match.mjs';
import { makeRegistry, buildFromVideos } from './lib/videos.mjs';
import { writeDataset, readPrevious, readIndex } from './lib/output.mjs';
import { toFixtures } from './lib/highlightly.mjs';

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
const quick = Boolean(args.quick);
const runStart = Date.now();

// Quick runs (see the top of this file).
const QUICK_LOOKBACK_HOURS = 36; // never read further back than this in a quick run
const QUICK_OVERLAP_HOURS = 3; // re-read this much before a channel's last read
const QUICK_RECHECK_DAYS = 3; // re-check stored highlights published this recently
const CLUB_EVERY_MIN = 30; // club and federation channels: at most this often in quick runs
const HL_DATES_EVERY_MIN = 30; // Highlightly score refreshes: at most this often in quick runs

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

// ---------- Highlightly (Europa League, Nations League) ----------
const HL_BASE = 'https://soccer.highlightly.net';
const HL_FULL_EVERY_HOURS = 20; // full re-download at most about once a day
let hlCalls = 0;

async function hlFetch(pathname, params, key) {
  const u = new URL(pathname, HL_BASE);
  for (const [k, v] of Object.entries(params)) u.searchParams.set(k, v);
  const res = await fetch(u, { headers: { 'x-rapidapi-key': key } });
  hlCalls += 1;
  if (!res.ok) {
    const err = new Error(`Highlightly ${res.status}: ${(await res.text()).slice(0, 200)}`);
    err.status = res.status;
    throw err;
  }
  return res.json();
}

/** Every match of a league-season (100 per page). */
async function hlAllMatches(leagueId, season, key) {
  const out = [];
  for (let offset = 0; offset < 2000; offset += 100) {
    const data = await hlFetch('/matches', { leagueId, season, limit: 100, offset }, key);
    const page = data.data ?? [];
    out.push(...page);
    const total = data.pagination?.totalCount ?? 0;
    if (page.length < 100 || out.length >= total) break;
  }
  return out;
}

const cachePath = (code, season) => path.join(ROOT, 'public', 'data', 'cache', `highlightly-${code}-${season}.json`);
const FINAL = /finished|after extra time|after penalties|postponed|cancel|abandon/i;

/**
 * Raw Highlightly matches for a competition, kept in a cache file on the data branch so the
 * free plan's 100 requests/day go a long way: full download when the cache is ~a day old,
 * otherwise only re-fetch the dates of recent matches that aren't marked finished yet.
 * Falls back to the cache (however old) if Highlightly is unreachable.
 */
async function highlightlyMatches(comp, season, key, { dry }) {
  const file = cachePath(comp.code, season);
  let cache = null;
  try { cache = JSON.parse(await fs.readFile(file, 'utf8')); } catch { /* first run */ }
  const before = cache ? JSON.stringify(cache) : null;
  const now = Date.now();
  try {
    const stale = !cache || now - Date.parse(cache.fetchedAt) > HL_FULL_EVERY_HOURS * 3600e3;
    if (stale || args['refresh-fixtures']) {
      const matches = await hlAllMatches(comp.highlightly, season, key);
      if (!matches.length && cache?.matches?.length) throw new Error('empty response, keeping the cached fixtures');
      cache = { leagueId: comp.highlightly, season, fetchedAt: new Date(now).toISOString(), matches };
      log(`  Highlightly: downloaded ${matches.length} matches`);
    } else {
      let dates = [...new Set(cache.matches
        .filter((m) => { const k = Date.parse(m.date); return k <= now && k >= now - 36 * 3600e3 && !FINAL.test(m.state?.description ?? ''); })
        .map((m) => m.date.slice(0, 10)))];
      // Quick runs come every ~10 minutes on match nights: refresh scores less often than that.
      if (quick && cache.datesAt && now - Date.parse(cache.datesAt) < HL_DATES_EVERY_MIN * 60e3) dates = [];
      if (dates.length) cache.datesAt = new Date(now).toISOString();
      for (const date of dates.slice(0, 3)) {
        const data = await hlFetch('/matches', { leagueId: comp.highlightly, season, date, limit: 100 }, key);
        const fresh = new Map((data.data ?? []).map((m) => [m.id, m]));
        cache.matches = cache.matches.map((m) => fresh.get(m.id) ?? m);
        for (const m of fresh.values()) if (!cache.matches.some((x) => x.id === m.id)) cache.matches.push(m);
      }
      log(`  Highlightly: cached fixtures from ${cache.fetchedAt.slice(0, 16)}Z${dates.length ? `, refreshed ${dates.join(', ')}` : ''}`);
    }
  } catch (e) {
    if (!cache) throw e;
    log(`  ! Highlightly: ${e.message} — using cached fixtures from ${cache.fetchedAt.slice(0, 16)}Z`);
  }
  if (!dry && JSON.stringify(cache) !== before) {
    await fs.mkdir(path.dirname(file), { recursive: true });
    await fs.writeFile(file, JSON.stringify(cache));
  }
  return cache.matches;
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

// Channel ids and upload playlists never change, so they're kept on the data branch in
// cache/channels.json ({ handle: { id, title, uploads, at, read } }) and looked up again
// only every CHANNEL_RECHECK_DAYS (titles can change). `read` is when the channel's
// uploads were last read: quick runs carry on from there.
const CHANNELS_FILE = path.join(ROOT, 'public', 'data', 'cache', 'channels.json');
const CHANNEL_RECHECK_DAYS = 7;
let channelStore = {};
const readThisRun = new Set(); // handles whose uploads this run read

async function loadChannelStore() {
  try { channelStore = JSON.parse(await fs.readFile(CHANNELS_FILE, 'utf8')); } catch { channelStore = {}; }
}

async function saveChannelStore() {
  const at = new Date(runStart).toISOString();
  for (const h of readThisRun) if (channelStore[h]) channelStore[h].read = at;
  const sorted = Object.fromEntries(Object.keys(channelStore).sort().map((k) => [k, channelStore[k]]));
  await fs.mkdir(path.dirname(CHANNELS_FILE), { recursive: true });
  await fs.writeFile(CHANNELS_FILE, JSON.stringify(sorted, null, 1));
}

const channelCache = new Map();
async function resolveChannel(handle, key) {
  if (channelCache.has(handle)) return channelCache.get(handle);
  const stored = channelStore[handle];
  let info = stored?.id && Date.now() - Date.parse(stored.at) < CHANNEL_RECHECK_DAYS * 86400e3 ? stored : null;
  if (!info) {
    try {
      const data = await yt('channels', { part: 'snippet,contentDetails', forHandle: handle }, key);
      const item = data.items?.[0];
      info = item
        ? { id: item.id, title: item.snippet.title, uploads: item.contentDetails.relatedPlaylists.uploads, at: new Date().toISOString() }
        : null;
    } catch (e) {
      if (!stored?.id) throw e;
      info = stored; // YouTube hiccup: the stored id is still good
    }
    if (info) channelStore[handle] = { ...stored, ...info };
    else delete channelStore[handle];
  }
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
  let rested = 0;
  for (const [priority, ch] of comp.channels.entries()) {
    // Quick runs: club and federation channels post after the broadcasters and the league,
    // so they're read at most every CLUB_EVERY_MIN; every channel carries on from its last read.
    let since = sinceMs;
    if (quick) {
      const last = Date.parse(channelStore[ch.handle]?.read ?? '');
      if (Number.isFinite(last)) {
        if (ch.tier !== 'broadcaster' && runStart - last < CLUB_EVERY_MIN * 60e3) { rested++; continue; }
        since = Math.max(sinceMs, last - QUICK_OVERLAP_HOURS * 3600e3);
      }
    }
    let info;
    try { info = await resolveChannel(ch.handle, YT); } catch (e) { log(`  ! ${ch.handle}: ${e.message}`); continue; }
    if (!info) { log(`  ! ${ch.handle}: handle not found, skipped`); continue; }
    const uploads = await recentUploads(info, since, YT, maxPages);
    readThisRun.add(ch.handle);
    const must = ch.mustMatch ? new RegExp(ch.mustMatch, 'i') : null;
    const keep = uploads.filter((u) => {
      if (!looksLikeMatchHighlight(u.title, { fixtures: comp.source !== 'videos' }) || (must && !must.test(u.title))) return false;
      const hints = detectComps(u.title);
      return !hints.size || hints.has(comp.code);
    });
    if (keep.length) log(`  ${info.title.slice(0, 30).padEnd(30)} ${String(uploads.length).padStart(4)} uploads → ${keep.length} candidates`);
    for (const u of keep) candidates.push({ ...u, channel: info.title, channelId: info.id, priority, tier: ch.tier });
  }
  if (rested) log(`  ${rested} club/federation channel(s) read in the last ${CLUB_EVERY_MIN} min, not read again yet`);
  const ids = [...new Set(candidates.map((c) => c.videoId))];
  const details = await videoDetails(ids, YT);
  const byId = new Map(ids.map((id, k) => [id, details[k]]));
  const videos = candidates
    .map((c) => withEmbedBlocks({ ...c, ...(byId.get(c.videoId) ?? { durationSec: 0, embeddable: false }) }, c.channelId))
    .filter((v) => !v.live);
  const blocked = videos.filter((v) => !v.embeddable).length;
  if (blocked) log(`  ${blocked} candidate(s) skipped: embedding disabled by the channel`);
  const limited = videos.filter((v) => v.embeddable && (v.allow || v.block)).length;
  if (limited) log(`  ${limited} candidate(s) are limited to some countries (kept, filtered per visitor)`);
  return videos;
}

/**
 * Re-check stored highlights: refresh their country restrictions and drop videos
 * that were deleted, made private or had embedding switched off since we found them.
 * ~1 quota unit per 50 videos. Quick runs only re-check those published in the last
 * QUICK_RECHECK_DAYS (the daily full run re-checks the rest).
 */
async function refreshStored(comp, built, YT) {
  const recheckSince = quick ? runStart - QUICK_RECHECK_DAYS * 86400e3 : -Infinity;
  const ids = [...new Set(built.files.flatMap((f) => f.matches.flatMap((m) => m.highlights
    .filter((h) => !(Date.parse(h.publishedAt) < recheckSince))
    .map((h) => h.videoId))))];
  if (!ids.length) return built;
  const details = await videoDetails(ids, YT);
  const byId = new Map(ids.map((id, k) => [id, details[k]]));
  let dropped = 0;
  for (const f of built.files) {
    for (const m of f.matches) {
      m.highlights = m.highlights.filter((h) => {
        if (!byId.has(h.videoId)) return true; // not re-checked this run
        const d = byId.get(h.videoId);
        if (!d || !d.embeddable) { dropped++; return false; }
        delete h.allow; delete h.block;
        const r = withEmbedBlocks({ allow: d.allow, block: d.block }, h.channelId);
        if (r.allow) h.allow = r.allow;
        if (r.block) h.block = r.block;
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
  const HL = process.env.HIGHLIGHTLY_API_KEY;
  if (!FD || !YT) {
    console.error('Missing FOOTBALL_DATA_KEY or YOUTUBE_API_KEY. Add them to .env (see .env.example).');
    process.exit(1);
  }
  if (!HL) log('HIGHLIGHTLY_API_KEY not set: Europa League and Nations League are left as published.');

  const defaultSeason = Number(args.season ?? currentSeason());
  const only = args.only ? String(args.only).split(',').map((s) => s.trim().toUpperCase()) : null;
  const lookbackHours = quick ? QUICK_LOOKBACK_HOURS : DEFAULT_LOOKBACK_DAYS * 24;
  const globalSince = args.since ? Date.parse(String(args.since)) : runStart - lookbackHours * 3600e3;
  // Backfills (--since) may need to page further back through busy channels.
  const pagesFor = (comp) => Number(args.pages ?? Math.max(args.since ? 60 : 0, comp.maxPages ?? MAX_PAGES_PER_CHANNEL));
  const published = await readIndex(ROOT);
  const has = (code) => published?.competitions?.some((c) => c.code === code && c.source === 'live');

  const comps = COMPETITIONS.filter((c) => {
    if (only) return only.includes(c.code);
    if (c.archive && has(c.code)) return false; // finished tournament already ingested
    return true;
  });

  const sinceLabel = new Date(globalSince).toISOString().slice(0, quick ? 16 : 10).replace('T', ' ');
  log(`Rondo ingest${quick ? ' (quick)' : ''}: ${comps.map((c) => c.code).join(', ')} · uploads since ${sinceLabel}${quick ? ' UTC at the earliest' : ''}`);
  await loadChannelStore();
  const results = [];
  const knownTeams = new Map(); // clubs from football-data, lent to Highlightly and video-first competitions
  let fdCalls = 0;
  const newMatches = []; // "PL: Man United v Tottenham", for the run summary

  const unmatched = {};
  // Quick runs read only the latest uploads, so keep earlier misses around for DEFAULT_LOOKBACK_DAYS.
  const prevUnmatched = quick ? await readUnmatched() : {};
  const keepMissesSince = runStart - DEFAULT_LOOKBACK_DAYS * 86400e3;

  // Fixture competitions first (they also teach us club names for the video-first ones).
  // football-data.org ones come before Highlightly ones (config order), so EL can borrow
  // club names and crests from the leagues.
  for (const comp of comps.filter((c) => c.source === 'fixtures')) {
    const season = comp.season ?? defaultSeason;
    let fixtures;
    if (comp.highlightly) {
      log(`\n▸ ${comp.name} (${comp.code}) ${season} · fixtures from Highlightly`);
      if (!HL) { log('  no HIGHLIGHTLY_API_KEY, skipped'); continue; }
      try {
        const raw = await highlightlyMatches(comp, season, HL, { dry: args.dry });
        fixtures = toFixtures(raw, { season, national: comp.group === 'national', knownTeams: [...knownTeams.values()] });
      } catch (e) {
        log(`  ! Highlightly unavailable (${e.message}), skipped: the published data stays as it is`);
        continue;
      }
    } else {
      if (fdCalls++ > 0) await sleep(6500); // stay under football-data's 10 req/min
      log(`\n▸ ${comp.name} (${comp.code}) ${season}`);
      try {
        fixtures = await fetchFixtures(comp.code, season, FD);
      } catch (e) {
        if (e.status === 403 || e.status === 404) { log(`  not available on this football-data.org plan, skipped`); continue; }
        throw e;
      }
    }
    log(`  ${fixtures.length} fixtures`);
    for (const f of fixtures) for (const t of [f.homeTeam, f.awayTeam]) if (t?.id) knownTeams.set(t.id, t);
    if (!fixtures.length) continue;

    const sinceMs = comp.since && !quick ? Math.min(Date.parse(comp.since), globalSince) : globalSince;
    const videos = await collectCandidates(comp, sinceMs, YT, pagesFor(comp));
    const skipped = new Set(); // goal clips and the like: they named a fixture, so they aren't misses
    const highlights = matchVideosToFixtures(fixtures, videos, { windowHours: MATCH_WINDOW_HOURS, skipped });
    const claimed = new Set([...highlights.values()].flat().map((h) => h.videoId).concat([...skipped]));
    const missed = videos
      .filter((v) => v.embeddable && highlightLength(v.durationSec) && !claimed.has(v.videoId) && looksLikeMatchHighlight(v.title, { fixtures: true }))
      .map(({ videoId, title, channel, publishedAt }) => ({ videoId, title, channel, publishedAt }));
    const missedIds = new Set(missed.map((v) => v.videoId));
    for (const v of prevUnmatched[comp.code] ?? []) {
      if (!missedIds.has(v.videoId) && !claimed.has(v.videoId) && Date.parse(v.publishedAt) >= keepMissesSince) missed.push(v);
    }
    unmatched[comp.code] = missed.sort((a, b) => Date.parse(b.publishedAt) - Date.parse(a.publishedAt));
    // --fresh=EL,UNL drops highlights kept from earlier runs (after matching or filter fixes).
    const fresh = String(args.fresh ?? '').toUpperCase().split(',').includes(comp.code);
    const previous = fresh ? new Map() : await readPrevious(ROOT, comp.code, season);
    const built = await refreshStored(comp, buildCompetition(comp, season, fixtures, highlights, previous), YT);
    const cur = built.index.rounds.find((r) => r.key === built.index.currentRound);
    log(`  matched ${highlights.size} matches · current: ${cur?.label ?? '-'} (${cur?.withHighlights ?? 0}/${cur?.matches ?? 0} with highlights)`);
    const named = newlyCovered(previous, built);
    if (named.length) log(`  new highlights: ${named.join(', ')}`);
    newMatches.push(...named.map((n) => `${comp.code}: ${n}`));
    results.push(built);
  }

  // Video-first competitions (none at the moment).
  for (const comp of comps.filter((c) => c.source === 'videos')) {
    const national = comp.group === 'national';
    const canonical = makeRegistry([...knownTeams.values()], { nations: national, clubs: !national });
    const season = comp.season ?? defaultSeason;
    log(`\n▸ ${comp.name} (${comp.code}) ${season} · discovered from highlight titles`);
    const sinceMs = comp.since && !quick ? Math.min(Date.parse(comp.since), globalSince) : globalSince;
    const videos = await collectCandidates(comp, sinceMs, YT, pagesFor(comp));
    // --fresh=EL,UNL rebuilds discovered competitions from scratch (after matching fixes).
    const fresh = String(args.fresh ?? '').toUpperCase().split(',').includes(comp.code);
    const previous = fresh ? new Map() : await readPrevious(ROOT, comp.code, season);
    const built = await refreshStored(comp, buildFromVideos(comp, season, videos, canonical, previous), YT);
    const n = built.files.reduce((a, f) => a + f.matches.length, 0);
    log(`  ${n} matches in ${built.files.length} rounds`);
    results.push(built);
  }

  // Club channels post every competition, so a video one competition skipped is usually
  // another's. Only report videos that no competition claimed.
  const claimedAnywhere = new Set(results.flatMap((r) => r.files.flatMap((f) => f.matches.flatMap((m) => m.highlights.map((h) => h.videoId)))));
  for (const code of Object.keys(unmatched)) {
    unmatched[code] = unmatched[code].filter((v) => !claimedAnywhere.has(v.videoId));
    if (!unmatched[code].length) { delete unmatched[code]; continue; }
    log(`\n${code}: ${unmatched[code].length} highlight-looking video(s) matched no fixture, e.g.:`);
    for (const v of unmatched[code].slice(0, 5)) log(`  - ${v.title}  [${v.channel}]`);
  }

  log(`\nYouTube quota used: ~${quota} units (daily limit 10,000)`);
  if (hlCalls) log(`Highlightly requests: ${hlCalls} (free plan: 100/day)`);
  const summary = newMatches.length
    ? `New highlights for ${newMatches.length} match(es): ${newMatches.join('; ')}`
    : 'No new highlights.';
  log(summary);
  if (process.env.GITHUB_STEP_SUMMARY) {
    await fs.appendFile(process.env.GITHUB_STEP_SUMMARY, `${summary}\n\nYouTube quota used: ~${quota} units.\n`).catch(() => {});
  }
  if (args.dry) { log('Dry run: nothing written.'); return; }
  await writeDataset(ROOT, results, { source: 'live', merge: true });
  await writeUnmatched(unmatched, new Set(results.map((r) => r.index.code)));
  await saveChannelStore();
  log('Wrote public/data/.');
}

/** Matches that had no highlight this run didn't already know of: "Man United v Tottenham". */
function newlyCovered(previous, built) {
  const known = new Set([...previous.values()].flatMap((f) => f.matches.flatMap((m) => m.highlights.map((h) => h.videoId))));
  return built.files.flatMap((f) => f.matches)
    .filter((m) => m.highlights.length && !m.highlights.some((h) => known.has(h.videoId)))
    .map((m) => `${m.home?.short ?? m.home?.name} v ${m.away?.short ?? m.away?.name}`);
}

const UNMATCHED_FILE = path.join(ROOT, 'public', 'data', 'cache', 'unmatched.json');

async function readUnmatched() {
  try { return JSON.parse(await fs.readFile(UNMATCHED_FILE, 'utf8')); } catch { return {}; }
}

/** public/data/cache/unmatched.json: per competition, videos that looked like highlights but fit no fixture. */
async function writeUnmatched(found, rebuilt) {
  const file = UNMATCHED_FILE;
  const prev = await readUnmatched();
  const next = { ...prev };
  for (const code of rebuilt) delete next[code];
  Object.assign(next, found);
  const sorted = Object.fromEntries(Object.keys(next).sort().map((k) => [k, next[k]]));
  await fs.mkdir(path.dirname(file), { recursive: true });
  await fs.writeFile(file, JSON.stringify(sorted, null, 1));
}

main().catch((e) => {
  const hint = e.message === 'fetch failed' ? ' — network error: can this machine reach api.football-data.org, soccer.highlightly.net and www.googleapis.com?' : '';
  console.error(`\n✖ ${e.message}${hint}`);
  process.exit(1);
});
