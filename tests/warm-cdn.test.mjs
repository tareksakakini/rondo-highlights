import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { plan, checkIndex, warm } from '../scripts/warm-cdn.mjs';

const REV = 'a'.repeat(40);
const CRESTS = 'b'.repeat(40);

async function setup({ crestsRev = CRESTS, condensed = true } = {}) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'warm-'));
  const index = {
    rev: REV,
    ...(crestsRev ? { crestsRev } : {}),
    competitions: [
      { code: 'PL', currentRound: 'md-2', rounds: [{ key: 'md-1' }, { key: 'md-2' }, { key: 'md-3' }] },
      { code: 'CL', currentRound: 'md-1', rounds: [{ key: 'md-1' }] },
    ],
  };
  const round = (crests) => JSON.stringify({ matches: crests.map(([h, a]) => ({ home: { crest: h }, away: { crest: a } })) });
  await fs.mkdir(path.join(dir, 'PL'));
  await fs.mkdir(path.join(dir, 'CL'));
  await fs.mkdir(path.join(dir, 'crests'));
  await fs.writeFile(path.join(dir, 'index.json'), JSON.stringify(index));
  await fs.writeFile(path.join(dir, 'PL', 'md-1.json'), round([['crests/x.webp', 'crests/y.webp']]));
  await fs.writeFile(path.join(dir, 'PL', 'md-2.json'), round([['crests/b.webp', 'https://elsewhere/z.png'], ['crests/a.webp', null]]));
  // md-3 has no file (a round without fixtures yet): skipped
  await fs.writeFile(path.join(dir, 'CL', 'md-1.json'), round([['crests/a.webp', 'crests/c.webp']]));
  if (condensed) await fs.writeFile(path.join(dir, 'condensed.json'), '{}');
  for (const f of ['a', 'b', 'c', 'x', 'y']) await fs.writeFile(path.join(dir, 'crests', `${f}.webp`), '');
  await fs.writeFile(path.join(dir, 'crests', 'notes.txt'), '');
  return dir;
}

test('plan: current rounds, condensed.json and their crests first, then the other rounds (no other crests)', async () => {
  const files = await plan(await setup());
  assert.deepEqual(files.map((f) => `${f.first ? '1' : '2'} ${f.ref === REV ? 'rev' : f.ref === CRESTS ? 'crests' : f.ref} ${f.path}`), [
    '1 rev PL/md-2.json',
    '1 rev CL/md-1.json',
    '1 rev condensed.json',
    '1 crests crests/a.webp',
    '1 crests crests/b.webp',
    '1 crests crests/c.webp',
    '2 rev PL/md-1.json',
  ]);
});

test('plan: crests at rev when the index has no crestsRev; no condensed.json, none asked for', async () => {
  const files = await plan(await setup({ crestsRev: null, condensed: false }));
  assert.ok(files.every((f) => f.ref === REV));
  assert.ok(!files.some((f) => f.path === 'condensed.json'));
});

test('plan: an index without a rev is an error', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'warm-'));
  await fs.writeFile(path.join(dir, 'index.json'), '{"competitions":[]}');
  await assert.rejects(plan(dir), /no rev/);
});

function json(body) {
  return { ok: true, status: 200, json: async () => body, arrayBuffer: async () => new ArrayBuffer(0) };
}

test('checkIndex: re-purges until jsDelivr serves the new index', async () => {
  const local = { rev: REV, competitions: [] };
  const old = { rev: 'c'.repeat(40), competitions: [] };
  const calls = [];
  let served = 0;
  const fetch = async (url) => {
    calls.push(url);
    if (url.startsWith('https://purge')) return json({ status: 'finished' });
    return json(served++ < 2 ? old : local);
  };
  const tries = await checkIndex('https://cdn/gh/o/r', 'https://purge/gh/o/r', local, { fetch, wait: async () => {} });
  assert.equal(tries, 3);
  assert.deepEqual(calls, [
    'https://cdn/gh/o/r@data/index.json', 'https://purge/gh/o/r@data/index.json',
    'https://cdn/gh/o/r@data/index.json', 'https://purge/gh/o/r@data/index.json',
    'https://cdn/gh/o/r@data/index.json',
  ]);
});

test('checkIndex: gives up (0) after the last try; errors and HTTP failures count as stale', async () => {
  let n = 0;
  const fetch = async (url) => {
    if (url.startsWith('https://purge')) throw new Error('down');
    n++;
    if (n === 1) throw new Error('reset');
    return { ok: false, status: 503 };
  };
  const tries = await checkIndex('https://cdn/x', 'https://purge/x', { rev: REV }, { fetch, wait: async () => {}, delays: [0, 0, 0] });
  assert.equal(tries, 0);
  assert.equal(n, 3);
});

test('warm: retries a failure after each delay, keeps the order', async () => {
  const seen = [];
  const waits = [];
  const fetch = async (url) => {
    seen.push(url);
    if (url === 'u2' && seen.filter((u) => u === 'u2').length === 1) throw new Error('reset');
    if (url === 'u3') return { ok: false, status: 404, arrayBuffer: async () => new ArrayBuffer(0) };
    return { ok: true, status: 200, arrayBuffer: async () => new ArrayBuffer(0) };
  };
  const res = await warm(['u1', 'u2', 'u3', 'u4'], { fetch, concurrency: 2, retryDelays: [5, 7], wait: async (ms) => { waits.push(ms); } });
  assert.deepEqual(res.map((r) => [r.url, r.ok, r.status, r.retries ?? 0]), [
    ['u1', true, 200, 0],
    ['u2', true, 200, 1],
    ['u3', false, 404, 2],
    ['u4', true, 200, 0],
  ]);
  assert.equal(seen.length, 7); // u1, u2 x2, u3 x3, u4
  assert.deepEqual(waits.sort(), [5, 5, 7]);
});
