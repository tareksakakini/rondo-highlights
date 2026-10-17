// YouTube view counts for the cards: public/data/views.json, { "<videoId>": views }.
//
//   node scripts/views.mjs [data-dir] [--quick]
//
// Reads every round file for its highlights and asks the YouTube Data API for their
// counts (videos.list, part=statistics: 1 quota unit per 50 videos; ~35 units for the
// whole season). --quick (the refresh runs while matches finish) re-reads only videos
// published in the last 3 days, which is when counts grow; the others keep their last
// count until the daily full run. Counts are rounded to 2 significant figures.
//
// views.json changes don't move the data commit the site reads round files at (see the
// refresh workflow): the site reads it from the moving `data` branch, and the workflow
// purges it on jsDelivr when it changed. Without YOUTUBE_API_KEY it does nothing.

import fs from 'node:fs/promises';
import path from 'node:path';
import { nextViews, roundViews } from './lib/views.mjs';

const args = process.argv.slice(2);
const quick = args.includes('--quick');
const dir = args.find((a) => !a.startsWith('--')) ?? 'public/data';
const RECENT_DAYS = 3;

async function roundFiles() {
  const out = [];
  for (const d of await fs.readdir(dir, { withFileTypes: true })) {
    if (!d.isDirectory() || !/^[A-Z0-9]+$/.test(d.name)) continue; // competitions (PL, BL1…), not cache/ or crests/
    for (const f of await fs.readdir(path.join(dir, d.name))) {
      if (f.endsWith('.json')) out.push(path.join(dir, d.name, f));
    }
  }
  return out;
}

async function readJSON(file) {
  try { return JSON.parse(await fs.readFile(file, 'utf8')); } catch { return null; }
}

async function main() {
  const key = process.env.YOUTUBE_API_KEY;
  if (!key) { console.log('views: no YOUTUBE_API_KEY, skipped'); return; }
  const now = Date.now();
  const all = [];
  const recheck = [];
  for (const file of await roundFiles()) {
    for (const m of (await readJSON(file))?.matches ?? []) {
      for (const h of m.highlights ?? []) {
        all.push(h.videoId);
        if (!quick || !(now - Date.parse(h.publishedAt) > RECENT_DAYS * 864e5)) recheck.push(h.videoId);
      }
    }
  }
  const ids = [...new Set(recheck)];
  const fresh = new Map();
  let calls = 0;
  for (let i = 0; i < ids.length; i += 50) {
    const u = new URL('https://www.googleapis.com/youtube/v3/videos');
    u.searchParams.set('part', 'statistics');
    u.searchParams.set('id', ids.slice(i, i + 50).join(','));
    u.searchParams.set('key', key);
    const res = await fetch(u);
    calls++;
    if (!res.ok) throw new Error(`YouTube videos ${res.status}: ${(await res.text()).slice(0, 300)}`);
    for (const v of (await res.json()).items ?? []) {
      const n = roundViews(Number(v.statistics?.viewCount)); // missing when the channel hides counts
      if (n != null) fresh.set(v.id, n);
    }
  }
  const file = path.join(dir, 'views.json');
  const before = await readJSON(file);
  const next = JSON.stringify(nextViews(before, all, fresh));
  if (next !== JSON.stringify(before)) await fs.writeFile(file, next);
  console.log(`views: ${fresh.size} of ${ids.length} video(s) re-read${quick ? ` (published in the last ${RECENT_DAYS} days)` : ''}, ${calls} YouTube unit(s); views.json ${next === JSON.stringify(before) ? 'unchanged' : 'updated'}`);
}

main().catch((e) => { console.error(`views: ${e.message}`); process.exit(1); });
