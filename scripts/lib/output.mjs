import fs from 'node:fs/promises';
import path from 'node:path';
import { COMPETITIONS } from '../config.mjs';

const dataDir = (root) => path.join(root, 'public', 'data');

async function readJson(p) {
  try { return JSON.parse(await fs.readFile(p, 'utf8')); } catch { return null; }
}

/** Previously written live round files for a competition (so old highlights survive a short lookback). */
export async function readPrevious(root, code, season) {
  const map = new Map();
  const index = await readJson(path.join(dataDir(root), 'index.json'));
  const comp = index?.competitions?.find((c) => c.code === code);
  if (!comp || comp.source !== 'live' || comp.season !== season) return map;
  for (const r of comp.rounds) {
    const file = await readJson(path.join(dataDir(root), code, `${r.key}.json`));
    if (file) map.set(r.key, file);
  }
  return map;
}

/** The currently published index.json (or null). */
export async function readIndex(root) {
  return readJson(path.join(dataDir(root), 'index.json'));
}

/**
 * Write index.json + one file per round.
 * Competitions without a single highlight are left out of the index (e.g. the Euros between tournaments).
 * merge=true keeps competitions from the existing index that weren't rebuilt this run.
 */
export async function writeDataset(root, results, { source, merge }) {
  const dir = dataDir(root);
  await fs.mkdir(dir, { recursive: true });
  const existing = merge ? await readJson(path.join(dir, 'index.json')) : null;

  results = results.filter((r) => r.index.rounds.some((x) => x.withHighlights > 0));
  for (const { index, files } of results) {
    const compDir = path.join(dir, index.code);
    await fs.rm(compDir, { recursive: true, force: true });
    await fs.mkdir(compDir, { recursive: true });
    for (const f of files) {
      await fs.writeFile(path.join(compDir, `${f.round.key}.json`), JSON.stringify(f));
    }
  }

  const rebuilt = new Set(results.map((r) => r.index.code));
  const kept = (existing?.competitions ?? []).filter((c) => !rebuilt.has(c.code));
  const order = COMPETITIONS.map((c) => c.code);
  const competitions = [...kept, ...results.map((r) => ({ ...r.index, source }))]
    .sort((a, b) => order.indexOf(a.code) - order.indexOf(b.code));
  const sources = new Set(competitions.map((c) => c.source));
  const previous = await readJson(path.join(dir, 'index.json'));
  const index = {
    generatedAt: new Date().toISOString(),
    source: sources.size === 1 ? [...sources][0] : 'mixed',
    // The data-branch commit holding the round files. Kept as is here; the refresh
    // workflow re-stamps it (scripts/stamp-rev.mjs) when round files or crests change.
    rev: previous?.rev,
    competitions,
  };
  // Keep the old timestamp when nothing changed, so scheduled runs don't create empty commits/deploys.
  if (previous && JSON.stringify({ ...previous, generatedAt: 0 }) === JSON.stringify({ ...index, generatedAt: 0 })) {
    index.generatedAt = previous.generatedAt;
  }
  await fs.writeFile(path.join(dir, 'index.json'), JSON.stringify(index, null, 1));
  return index;
}
