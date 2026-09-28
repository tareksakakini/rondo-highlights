#!/usr/bin/env node
// Builds public/data from scripts/sample/seed.json — an offline snapshot of real
// fixtures and YouTube uploads — using exactly the same pipeline as `npm run ingest`.
// Lets the site run with zero API keys.

import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { COMPETITIONS, MATCH_WINDOW_HOURS } from './config.mjs';
import { matchVideosToFixtures, buildCompetition, looksLikeMatchHighlight, detectComps } from './lib/match.mjs';
import { makeRegistry, buildFromVideos } from './lib/videos.mjs';
import { writeDataset } from './lib/output.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const seed = JSON.parse(await fs.readFile(path.join(ROOT, 'scripts/sample/seed.json'), 'utf8'));

/** Same channel filtering + priority as the live ingest (collectCandidates). */
export function candidatesFor(comp, videos) {
  const out = [];
  for (const [priority, ch] of comp.channels.entries()) {
    const must = ch.mustMatch ? new RegExp(ch.mustMatch, 'i') : null;
    for (const v of videos) {
      if (v.handle.toLowerCase() !== ch.handle.toLowerCase()) continue;
      if (!looksLikeMatchHighlight(v.title) || (must && !must.test(v.title))) continue;
      const hints = detectComps(v.title);
      if (hints.size && !hints.has(comp.code)) continue;
      out.push({ ...v, priority, tier: ch.tier });
    }
  }
  return out;
}

const results = [];
const known = [];
for (const comp of COMPETITIONS.filter((c) => c.source === 'fixtures')) {
  const fixtures = seed.competitions[comp.code];
  if (!fixtures) continue;
  for (const f of fixtures) known.push(f.homeTeam, f.awayTeam);
  const highlights = matchVideosToFixtures(fixtures, candidatesFor(comp, seed.videos), { windowHours: MATCH_WINDOW_HOURS });
  results.push(buildCompetition(comp, seed.season, fixtures, highlights));
  console.log(`${comp.code.padEnd(4)} ${fixtures.length} fixtures · ${highlights.size} with highlights`);
}
const canonical = makeRegistry(known);
for (const comp of COMPETITIONS.filter((c) => c.source === 'videos')) {
  const built = buildFromVideos(comp, seed.season, candidatesFor(comp, seed.videos), canonical);
  if (!built.files.length) continue;
  results.push(built);
  console.log(`${comp.code.padEnd(4)} ${built.files.reduce((a, f) => a + f.matches.length, 0)} matches discovered from titles`);
}
await writeDataset(ROOT, results, { source: 'sample', merge: false });
console.log('Wrote sample data to public/data/.');
