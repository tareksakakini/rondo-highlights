// End-to-end check of scripts/ingest.mjs against mocked football-data.org, Highlightly
// and YouTube APIs built from scripts/sample/seed.json. Run: node tests/ingest.mock.mjs <tmpdir>
// (copies the scripts into <tmpdir> so it never touches your real public/data).
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const repo = path.resolve(here, '..');
const tmp = process.argv[2];
if (!tmp) throw new Error('usage: node tests/ingest.mock.mjs <tmpdir>');
if (!process.env.KEEP) fs.rmSync(tmp, { recursive: true, force: true });
fs.mkdirSync(tmp, { recursive: true });
fs.cpSync(path.join(repo, 'scripts'), path.join(tmp, 'scripts'), { recursive: true });
fs.writeFileSync(path.join(tmp, 'package.json'), '{"type":"module"}');

const seed = JSON.parse(fs.readFileSync(path.join(repo, 'scripts/sample/seed.json'), 'utf8'));
const byHandle = new Map();
for (const v of seed.videos) {
  if (!byHandle.has(v.handle.toLowerCase())) byHandle.set(v.handle.toLowerCase(), { title: v.channel, videos: [] });
  byHandle.get(v.handle.toLowerCase()).videos.push(v);
}
const videosById = new Map(seed.videos.map((v) => [v.videoId, v]));
const iso = (s) => `PT${Math.floor(s / 60)}M${s % 60}S`;
const json = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
const calls = { fd: 0, yt: 0, hl: 0 };
const HL_LEAGUES = { 3337: 'EL', 5039: 'UNL' };

globalThis.fetch = async (input, init) => {
  const u = new URL(typeof input === 'string' || input instanceof URL ? String(input) : input.url);
  if (u.hostname === 'api.football-data.org') {
    calls.fd++;
    const code = u.pathname.split('/')[3];
    if (code === 'EC') return json({ message: 'restricted' }, 403);
    return json({ matches: seed.competitions[code] ?? [] });
  }
  if (u.hostname === 'soccer.highlightly.net') {
    calls.hl++;
    if (process.env.HL_DOWN) return json({ message: 'down' }, 503);
    const all = seed.highlightly[HL_LEAGUES[u.searchParams.get('leagueId')]] ?? [];
    const date = u.searchParams.get('date');
    const rows = date ? all.filter((m) => m.date.startsWith(date)) : all;
    const limit = Number(u.searchParams.get('limit') ?? 100);
    const offset = Number(u.searchParams.get('offset') ?? 0);
    return json({ data: rows.slice(offset, offset + limit), pagination: { totalCount: rows.length, offset, limit } });
  }
  if (u.hostname === 'www.googleapis.com') {
    calls.yt++;
    const ep = u.pathname.split('/').pop();
    if (ep === 'channels') {
      const h = u.searchParams.get('forHandle').toLowerCase();
      const c = byHandle.get(h);
      return json({ items: c ? [{ id: `UC_${h}`, snippet: { title: c.title }, contentDetails: { relatedPlaylists: { uploads: `UU_${h}` } } }] : [] });
    }
    if (ep === 'playlistItems') {
      const h = u.searchParams.get('playlistId').slice(3);
      const c = byHandle.get(h);
      return json({ items: (c?.videos ?? []).map((v) => ({ snippet: { title: v.title, publishedAt: v.publishedAt }, contentDetails: { videoId: v.videoId, videoPublishedAt: v.publishedAt } })) });
    }
    if (ep === 'videos') {
      const items = u.searchParams.get('id').split(',').map((id) => videosById.get(id)).filter(Boolean).map((v) => ({
        id: v.videoId,
        contentDetails: { duration: iso(v.durationSec), ...(v.allow || v.block ? { regionRestriction: { ...(v.allow ? { allowed: v.allow } : {}), ...(v.block ? { blocked: v.block } : {}) } } : {}) },
        status: { embeddable: v.embeddable !== false, privacyStatus: 'public' },
        snippet: { liveBroadcastContent: 'none' },
      }));
      return json({ items });
    }
  }
  throw new Error(`unexpected fetch ${u}`);
};

// football-data rate-limit pauses would make this slow; skip them.
const realSetTimeout = globalThis.setTimeout;
globalThis.setTimeout = (fn, ms, ...a) => realSetTimeout(fn, Math.min(ms, 5), ...a);

process.env.FOOTBALL_DATA_KEY = 'x';
process.env.YOUTUBE_API_KEY = 'y';
process.env.HIGHLIGHTLY_API_KEY = 'z';
process.argv = [process.argv[0], 'ingest', '--since=2026-09-01'];
await import(path.join(tmp, 'scripts/ingest.mjs'));
await new Promise((r) => realSetTimeout(r, 500));

const index = JSON.parse(fs.readFileSync(path.join(tmp, 'public/data/index.json'), 'utf8'));
console.log('\nRESULT', JSON.stringify(index.competitions.map((c) => [c.code, c.currentRound, c.rounds.reduce((a, r) => a + r.withHighlights, 0)])), calls);
