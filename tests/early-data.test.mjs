import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { withRev } from '../scripts/stamp-rev.mjs';

// scripts/early-data.js runs inline in <head> before the app. Run it against a fake page.
const SRC = fs.readFileSync(new URL('../scripts/early-data.js', import.meta.url), 'utf8');
const BASE = 'https://cdn.jsdelivr.net/gh/me/repo@{ref}';
const REV = 'a'.repeat(40);
const OLD = 'b'.repeat(40);
const idx = (rev, current = 'md-5') => ({
  rev,
  competitions: [
    { code: 'PL', currentRound: current, rounds: [] },
    { code: 'SA', currentRound: 'md-4', rounds: [] },
  ],
});

async function run({ route, path = '/', hash = '', stored = {}, session = {}, index = idx(REV) }) {
  const fetched = [];
  const json = (body) => ({ ok: true, json: async () => body });
  const window = {};
  const ctx = {
    window,
    location: { pathname: path, hash },
    document: { querySelector: () => (route == null ? null : { content: route }) },
    localStorage: { getItem: (k) => (k in stored ? JSON.stringify(stored[k]) : null) },
    sessionStorage: { getItem: (k) => session[k] ?? null },
    fetch: (url) => {
      fetched.push(url);
      return Promise.resolve(json(url.endsWith('index.json') ? index : {}));
    },
    Date,
  };
  vm.runInNewContext(SRC.replace('__BASES__', JSON.stringify([BASE])).replace('__MAX_AGE__', String(12 * 3600e3)), ctx);
  await new Promise((r) => setTimeout(r, 10));
  return { fetched: fetched.map((u) => u.replace('https://cdn.jsdelivr.net/gh/me/repo', '')), window };
}

test('a round page loads its round as soon as the index names the commit', async () => {
  const { fetched } = await run({ route: 'SA md-2', path: '/serie-a/matchweek-2/' });
  assert.deepEqual(fetched, ['@data/index.json', '/geo.json', `@${REV}/SA/md-2.json`, `@${REV}/condensed.json`]);
});

test('a competition page loads its current round; home the last competition viewed', async () => {
  assert.ok((await run({ route: 'SA' })).fetched.includes(`@${REV}/SA/md-4.json`));
  assert.ok((await run({ route: '', stored: { 'rondo:comp': 'SA' } })).fetched.includes(`@${REV}/SA/md-4.json`));
  assert.ok((await run({ route: '' })).fetched.includes(`@${REV}/PL/md-5.json`));
  assert.ok((await run({ route: '', stored: { 'rondo:comp': 'XX' } })).fetched.includes(`@${REV}/PL/md-5.json`));
});

test('nothing is guessed for unknown pages, old #/ links or an index without a commit', async () => {
  assert.deepEqual((await run({ route: null, path: '/nope/' })).fetched, ['@data/index.json', '/geo.json']);
  assert.deepEqual((await run({ route: '', hash: '#/PL/md-3' })).fetched, ['@data/index.json', '/geo.json']);
  assert.deepEqual((await run({ route: 'PL', index: idx(undefined) })).fetched, ['@data/index.json', '/geo.json']);
  assert.deepEqual((await run({ route: 'XX' })).fetched, ['@data/index.json', '/geo.json']);
});

test('condensed.json is skipped with auto-condense off, geo.json when the tab knows the country', async () => {
  const { fetched } = await run({ route: 'PL md-1', stored: { 'rondo:autoCondense': false }, session: { 'rondo:netRegion': 'GB' } });
  assert.deepEqual(fetched, ['@data/index.json', `@${REV}/PL/md-1.json`]);
});

test('a recent saved index is offered to the app and its round loads before the network answers', async () => {
  const saved = { t: Date.now() - 3600e3, idx: idx(OLD, 'md-4') };
  const { fetched, window } = await run({ route: 'PL', stored: { 'rondo:indexCache': saved } });
  assert.equal(window.__rondoSavedIndex.rev, OLD);
  // Saved commit first (from the browser cache), then the fresh one's; nothing twice.
  assert.deepEqual(fetched, [
    '@data/index.json', `@${OLD}/PL/md-4.json`, `@${OLD}/condensed.json`, '/geo.json',
    `@${REV}/PL/md-5.json`, `@${REV}/condensed.json`,
  ]);
  const same = await run({ route: 'PL', stored: { 'rondo:indexCache': { t: Date.now(), idx: idx(REV) } } });
  assert.equal(same.fetched.filter((u) => u.endsWith('/PL/md-5.json')).length, 1);
});

test('a saved index older than 12 hours is ignored', async () => {
  const saved = { t: Date.now() - 13 * 3600e3, idx: idx(OLD) };
  const { fetched, window } = await run({ route: 'PL', stored: { 'rondo:indexCache': saved } });
  assert.equal(window.__rondoSavedIndex, undefined);
  assert.ok(!fetched.some((u) => u.includes(OLD)));
});

test('stamp-rev names the crest commit, defaulting to the data commit', () => {
  const index = { generatedAt: 'x', source: 'live', rev: OLD, crestsRev: OLD, competitions: [] };
  assert.deepEqual(Object.keys(withRev(index, REV)), ['generatedAt', 'source', 'rev', 'crestsRev', 'competitions']);
  assert.equal(withRev(index, REV).crestsRev, REV);
  assert.equal(withRev(index, REV, OLD).crestsRev, OLD);
  assert.throws(() => withRev(index, REV, 'nope'));
});
