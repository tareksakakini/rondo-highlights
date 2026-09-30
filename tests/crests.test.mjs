import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import sharp from 'sharp';
import { crestPath, localizeCrests, CREST_PX } from '../scripts/crests.mjs';

const PNG = 'https://crests.example/64.png';
const SVG = 'https://crests.example/760.svg';
const BROKEN = 'https://crests.example/404.png';

async function setup() {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'crests-'));
  await fs.mkdir(path.join(dir, 'PL'));
  await fs.mkdir(path.join(dir, 'cache'));
  const round = {
    competition: 'PL', season: 2026, round: { key: 'md-1', label: 'Matchweek 1' },
    matches: [
      { id: 1, home: { name: 'A', crest: PNG }, away: { name: 'B', crest: SVG }, highlights: [] },
      { id: 2, home: { name: 'C', crest: BROKEN }, away: { name: 'D', crest: null }, highlights: [] },
    ],
  };
  await fs.writeFile(path.join(dir, 'PL', 'md-1.json'), JSON.stringify(round));
  await fs.writeFile(path.join(dir, 'index.json'), '{"competitions":[]}');
  await fs.writeFile(path.join(dir, 'cache', 'x.json'), JSON.stringify({ crest: PNG }));
  return dir;
}

const png = await sharp({ create: { width: 200, height: 200, channels: 4, background: { r: 200, g: 20, b: 20, alpha: 1 } } }).png().toBuffer();
const svg = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 30 20"><rect width="30" height="20" fill="#08f"/></svg>');

function fakeFetch() {
  const calls = [];
  const impl = async (url) => {
    calls.push(url);
    const body = url === PNG ? png : url === SVG ? svg : null;
    return body
      ? { ok: true, status: 200, arrayBuffer: async () => body }
      : { ok: false, status: 404 };
  };
  return { impl, calls };
}

test('downloads, shrinks and rewrites crests; keeps failures remote', async () => {
  const dir = await setup();
  const f = fakeFetch();
  const stats = await localizeCrests(dir, { fetchImpl: f.impl, log: () => {} });
  assert.deepEqual(stats, { files: 1, crests: 3, downloaded: 2, failed: 1 });

  const round = JSON.parse(await fs.readFile(path.join(dir, 'PL', 'md-1.json'), 'utf8'));
  assert.equal(round.matches[0].home.crest, crestPath(PNG));
  assert.equal(round.matches[0].away.crest, crestPath(SVG));
  assert.equal(round.matches[1].home.crest, BROKEN);
  assert.equal(round.matches[1].away.crest, null);

  for (const u of [PNG, SVG]) {
    const meta = await sharp(path.join(dir, crestPath(u))).metadata();
    assert.equal(meta.format, 'webp');
    assert.equal(meta.width, CREST_PX);
    assert.equal(meta.height, CREST_PX);
  }
  // cache/ files are internal and must not be touched
  assert.equal(JSON.parse(await fs.readFile(path.join(dir, 'cache', 'x.json'), 'utf8')).crest, PNG);
});

test('second run is a no-op except retrying failures', async () => {
  const dir = await setup();
  await localizeCrests(dir, { fetchImpl: fakeFetch().impl, log: () => {} });
  const f = fakeFetch();
  const stats = await localizeCrests(dir, { fetchImpl: f.impl, log: () => {} });
  assert.deepEqual(f.calls, [BROKEN]);
  assert.deepEqual(stats, { files: 0, crests: 1, downloaded: 0, failed: 1 });
});

test('a fresh ingest that restores remote URLs reuses crests on disk', async () => {
  const dir = await setup();
  await localizeCrests(dir, { fetchImpl: fakeFetch().impl, log: () => {} });
  // ingest rewrites round files from the API, with remote URLs again
  const file = path.join(dir, 'PL', 'md-1.json');
  const round = JSON.parse(await fs.readFile(file, 'utf8'));
  round.matches[0].home.crest = PNG;
  await fs.writeFile(file, JSON.stringify(round));

  const f = fakeFetch();
  await localizeCrests(dir, { fetchImpl: f.impl, log: () => {} });
  assert.ok(!f.calls.includes(PNG));
  assert.equal(JSON.parse(await fs.readFile(file, 'utf8')).matches[0].home.crest, crestPath(PNG));
});

test('crest paths are stable and distinct', () => {
  assert.equal(crestPath(PNG), crestPath(PNG));
  assert.notEqual(crestPath(PNG), crestPath(SVG));
  assert.match(crestPath(PNG), /^crests\/[0-9a-f]{12}\.webp$/);
});
