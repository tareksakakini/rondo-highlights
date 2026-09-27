import fs from 'node:fs/promises';
import path from 'node:path';

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

/**
 * Write index.json + one file per round.
 * merge=true keeps competitions from the existing index that weren't rebuilt this run.
 */
export async function writeDataset(root, results, { source, merge }) {
  const dir = dataDir(root);
  await fs.mkdir(dir, { recursive: true });
  const existing = merge ? await readJson(path.join(dir, 'index.json')) : null;
  const rebuilt = new Set(results.map((r) => r.index.code));

  for (const { index, files } of results) {
    const compDir = path.join(dir, index.code);
    await fs.rm(compDir, { recursive: true, force: true });
    await fs.mkdir(compDir, { recursive: true });
    for (const f of files) {
      await fs.writeFile(path.join(compDir, `${f.round.key}.json`), JSON.stringify(f));
    }
  }

  const kept = (existing?.competitions ?? []).filter((c) => !rebuilt.has(c.code));
  const order = ['PL', 'PD', 'SA', 'BL1', 'FL1', 'CL'];
  const competitions = [...kept, ...results.map((r) => ({ ...r.index, source }))]
    .sort((a, b) => order.indexOf(a.code) - order.indexOf(b.code));
  const sources = new Set(competitions.map((c) => c.source));
  const index = {
    generatedAt: new Date().toISOString(),
    source: sources.size === 1 ? [...sources][0] : 'mixed',
    competitions,
  };
  // Keep the old timestamp when nothing changed, so scheduled runs don't create empty commits/deploys.
  const previous = await readJson(path.join(dir, 'index.json'));
  if (previous && JSON.stringify({ ...previous, generatedAt: 0 }) === JSON.stringify({ ...index, generatedAt: 0 })) {
    index.generatedAt = previous.generatedAt;
  }
  await fs.writeFile(path.join(dir, 'index.json'), JSON.stringify(index, null, 1));
  return index;
}
