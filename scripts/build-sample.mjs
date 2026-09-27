#!/usr/bin/env node
// Builds public/data from scripts/sample/seed.json — an offline snapshot of real
// fixtures and YouTube uploads — using exactly the same matching pipeline as
// `npm run ingest`. Lets the site run with zero API keys.

import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { COMPETITIONS, MATCH_WINDOW_HOURS } from './config.mjs';
import { matchVideosToFixtures, buildCompetition } from './lib/match.mjs';
import { writeDataset } from './lib/output.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const seed = JSON.parse(await fs.readFile(path.join(ROOT, 'scripts/sample/seed.json'), 'utf8'));

const results = [];
for (const comp of COMPETITIONS) {
  const fixtures = seed.competitions[comp.code];
  if (!fixtures) continue;
  // Same channel filtering + priority as the live ingest.
  const videos = [];
  for (const [priority, ch] of comp.channels.entries()) {
    const must = ch.mustMatch ? new RegExp(ch.mustMatch, 'i') : null;
    for (const v of seed.videos) {
      if (v.handle.toLowerCase() !== ch.handle.toLowerCase()) continue;
      if (must && !must.test(v.title)) continue;
      videos.push({ ...v, priority });
    }
  }
  const highlights = matchVideosToFixtures(fixtures, videos, { windowHours: MATCH_WINDOW_HOURS });
  const built = buildCompetition(comp, seed.season, fixtures, highlights);
  results.push(built);
  const n = [...highlights.values()].flat();
  console.log(`${comp.code.padEnd(4)} ${fixtures.length} fixtures · ${highlights.size} with highlights · ${n.filter((h) => h.kind === 'short').length} short / ${n.filter((h) => h.kind === 'extended').length} extended`);
}
await writeDataset(ROOT, results, { source: 'sample', merge: false });
console.log('Wrote sample data to public/data/.');
