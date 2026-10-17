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

// views.json (view counts) is asked for on every page; `views: true` keeps it in `fetched`.
async function run({ route, pre = null, path = '/', hash = '', stored = {}, session = {}, index = idx(REV), bases = [BASE], respond = null, settle = null, views = false }) {
  const fetched = [];
  const classes = [];
  const json = (body) => ({ ok: true, json: async () => body });
  const window = {};
  const ctx = {
    window,
    location: { pathname: path, hash },
    document: {
      querySelector: (sel) => {
        if (sel.includes('rondo-route')) return route == null ? null : { content: route };
        if (sel.includes('rondo-pre')) return pre == null ? null : { content: pre };
        return null;
      },
      documentElement: { classList: { add: (c) => classes.push(c) } },
    },
    localStorage: { getItem: (k) => (k in stored ? JSON.stringify(stored[k]) : null) },
    sessionStorage: { getItem: (k) => session[k] ?? null },
    fetch: (url, init = {}) => {
      fetched.push(url);
      if (respond) return respond(url, init);
      return Promise.resolve(json(url.endsWith('index.json') ? index : {}));
    },
    AbortController,
    setTimeout,
    clearTimeout,
    Date,
  };
  vm.runInNewContext(SRC.replace('__BASES__', JSON.stringify(bases)).replace('__MAX_AGE__', String(12 * 3600e3)), ctx);
  await new Promise((r) => setTimeout(r, settle ?? (respond ? 80 : 10)));
  return {
    fetched: fetched.filter((u) => views || !u.endsWith('/views.json')).map((u) => u.replace('https://cdn.jsdelivr.net/gh/me/repo', '')),
    window, stale: classes.includes('pre-stale'),
  };
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
  assert.deepEqual(Object.keys(withRev(index, REV)), ['generatedAt', 'source', 'rev', 'crestsRev', 'publishedAt', 'competitions']);
  assert.equal(withRev(index, REV).crestsRev, REV);
  assert.equal(withRev(index, REV, OLD).crestsRev, OLD);
  assert.throws(() => withRev(index, REV, 'nope'));
});

test('home and competition pages keep their prerendered round unless it is known to be the wrong one', async () => {
  const savedAt = (current, ageH = 1) => ({ 'rondo:indexCache': { t: Date.now() - ageH * 3600e3, idx: idx(OLD, current) } });
  // First visits: nothing to compare with, so the build's round stays.
  assert.equal((await run({ route: '', pre: 'PL md-5' })).stale, false);
  assert.equal((await run({ route: 'PL', pre: 'PL md-5' })).stale, false);
  // Home opens the competition viewed last.
  assert.equal((await run({ route: '', pre: 'PL md-5', stored: { 'rondo:comp': 'SA' } })).stale, true);
  assert.equal((await run({ route: '', pre: 'PL md-5', stored: { 'rondo:comp': 'PL' } })).stale, false);
  // A competition page always shows its own competition, whatever was viewed last.
  assert.equal((await run({ route: 'PL', pre: 'PL md-5', stored: { 'rondo:comp': 'SA' } })).stale, false);
  // A recent saved index knows the current round.
  assert.equal((await run({ route: 'PL', pre: 'PL md-5', stored: savedAt('md-6') })).stale, true);
  assert.equal((await run({ route: 'PL', pre: 'PL md-5', stored: savedAt('md-5') })).stale, false);
  assert.equal((await run({ route: '', pre: 'PL md-5', stored: savedAt('md-6') })).stale, true);
  // ...but not one older than 12 hours.
  assert.equal((await run({ route: 'PL', pre: 'PL md-5', stored: savedAt('md-6', 13) })).stale, false);
  // Pages without prerendered cards are left alone.
  assert.equal((await run({ route: 'PL', stored: savedAt('md-6') })).stale, false);
});

const RAW = 'https://raw.githubusercontent.com/me/repo/{ref}';
const short = (fetched) => fetched.map((u) => u.replace('https://raw.githubusercontent.com/me/repo', 'RAW'));
function server(delay, status = () => 200, index = () => idx(REV)) {
  const aborted = [];
  const respond = (url, init) => new Promise((resolve, reject) => {
    const t = setTimeout(() => resolve({
      ok: status(url) === 200, status: status(url),
      json: async () => (url.endsWith('index.json') ? index(url) : { from: url }),
    }), delay(url));
    init.signal?.addEventListener('abort', () => { clearTimeout(t); aborted.push(url); reject(new Error('aborted')); });
  });
  return { respond, aborted };
}

test('with two data bases: index.json is asked of both; for other files a quick first base is the only one asked', async () => {
  const { respond } = server(() => 5);
  const { fetched } = await run({ route: 'PL md-1', bases: [BASE, RAW], respond, session: { 'rondo:netRegion': 'GB' }, settle: 400 });
  assert.deepEqual(short(fetched), ['@data/index.json', 'RAW/data/index.json', `@${REV}/PL/md-1.json`, `@${REV}/condensed.json`]);
});

test('with two data bases: a slow first base gets the second asked too; the first answer wins, the other is cancelled', async () => {
  const { respond, aborted } = server((url) => (url.startsWith('https://raw') ? 5 : 2000));
  const { fetched, window } = await run({ route: 'PL md-1', bases: [BASE, RAW], respond, session: { 'rondo:netRegion': 'GB' }, settle: 800 });
  assert.deepEqual(short(fetched), ['@data/index.json', 'RAW/data/index.json', `@${REV}/PL/md-1.json`, `@${REV}/condensed.json`, `RAW/${REV}/PL/md-1.json`, `RAW/${REV}/condensed.json`]);
  // Filed under the first base's URL (where data.ts looks), with GitHub's answer.
  const round = await window.__rondoEarly[`https://cdn.jsdelivr.net/gh/me/repo@${REV}/PL/md-1.json`];
  assert.equal(round.from, `https://raw.githubusercontent.com/me/repo/${REV}/PL/md-1.json`);
  assert.equal(aborted.filter((u) => !u.endsWith('/views.json')).length, 3); // views.json is hedged the same way
  assert.ok(aborted.every((u) => u.startsWith('https://cdn.jsdelivr.net')));
});

test('with two data bases: a failing first base gets the second asked at once; both failing rejects', async () => {
  const { respond } = server(() => 5, (url) => (url.startsWith('https://cdn') ? 503 : 200));
  const t0 = Date.now();
  const { window } = await run({ route: 'PL md-1', bases: [BASE, RAW], respond, session: { 'rondo:netRegion': 'GB' } });
  assert.equal((await window.__rondoIndex).rev, REV);
  assert.ok((await window.__rondoEarly[`https://cdn.jsdelivr.net/gh/me/repo@${REV}/PL/md-1.json`]).from.startsWith('https://raw'));
  assert.ok(Date.now() - t0 < 250, 'no hedge wait after a failure');
  const down = await run({ route: 'PL md-1', bases: [BASE, RAW], respond: server(() => 5, () => 429).respond });
  await assert.rejects(down.window.__rondoIndex);
});

// An index stamped by scripts/stamp-rev.mjs at `at` (UTC hour on 2026-10-15).
const stamped = (rev, at, current) => ({ ...idx(rev, current), publishedAt: `2026-10-15T${at}:00:00.000Z` });
const fromCdn = (url) => url.startsWith('https://cdn');

test('with two data bases: the newer index wins even when it answers second', async () => {
  // jsDelivr answers at once with a copy from 18:00; GitHub a little later with 19:00's.
  const { respond, aborted } = server((url) => (fromCdn(url) ? 5 : 150), () => 200,
    (url) => (fromCdn(url) ? stamped(OLD, 18) : stamped(REV, 19)));
  const { fetched, window } = await run({ route: 'PL md-1', bases: [BASE, RAW], respond, session: { 'rondo:netRegion': 'GB' }, settle: 600 });
  assert.equal((await window.__rondoIndex).rev, REV);
  assert.ok(fetched.includes(`@${REV}/PL/md-1.json`));
  assert.ok(!fetched.some((u) => u.includes(OLD)), 'the older copy names no files to load');
  assert.deepEqual(aborted, [], 'nothing left to cancel');
  // The other way round, the older copy answering second doesn't replace the newer one.
  const swapped = server((url) => (fromCdn(url) ? 150 : 5), () => 200, (url) => (fromCdn(url) ? stamped(OLD, 18) : stamped(REV, 19)));
  assert.equal((await (await run({ route: 'PL md-1', bases: [BASE, RAW], respond: swapped.respond, settle: 600 })).window.__rondoIndex).rev, REV);
});

test('with two data bases: index.json waits for a slow base only briefly after the first answer', async () => {
  const { respond, aborted } = server((url) => (fromCdn(url) ? 3000 : 5), () => 200,
    (url) => (fromCdn(url) ? stamped(OLD, 20) : stamped(REV, 19)));
  const t0 = Date.now();
  const { window } = await run({ route: 'PL md-1', bases: [BASE, RAW], respond, session: { 'rondo:netRegion': 'GB' } });
  assert.equal((await window.__rondoIndex).rev, REV);
  assert.ok(Date.now() - t0 < 1000, 'answered within the grace period');
  assert.ok(aborted.includes('https://cdn.jsdelivr.net/gh/me/repo@data/index.json'));
});

test('a saved index newer than the network\'s keeps its round: an old CDN copy never takes highlights away', async () => {
  const saved = { t: Date.now() - 600e3, idx: stamped(OLD, 19, 'md-6') };
  const { fetched } = await run({ route: 'PL', stored: { 'rondo:indexCache': saved }, index: stamped(REV, 18, 'md-5') });
  assert.ok(fetched.includes(`@${OLD}/PL/md-6.json`));
  assert.ok(!fetched.some((u) => u.includes(REV)), 'nothing loaded at the older commit');
  // A newer network copy still replaces it.
  const newer = await run({ route: 'PL', stored: { 'rondo:indexCache': saved }, index: stamped(REV, 20, 'md-6') });
  assert.ok(newer.fetched.includes(`@${REV}/PL/md-6.json`));
});

test('stamp-rev: publishedAt only goes up, and only moves when something else in the index does', () => {
  const index = { generatedAt: 'x', source: 'live', rev: OLD, crestsRev: OLD, competitions: [] };
  const at = (h) => Date.parse(`2026-10-15T${h}:00:00Z`);
  const first = withRev(index, OLD, OLD, null, at(19));
  assert.equal(first.publishedAt, '2026-10-15T19:00:00.000Z');
  // Nothing changed: same stamp, so index.json (and the data branch) stays as it is.
  assert.deepEqual(withRev({ ...first }, OLD, OLD, first, at(20)), first);
  // A new commit or new competitions: a later stamp, even if this runner's clock is behind.
  const moved = withRev({ ...first }, REV, OLD, first, at(18));
  assert.ok(Date.parse(moved.publishedAt) > Date.parse(first.publishedAt));
  const more = withRev({ ...first, competitions: [{ code: 'PL' }] }, OLD, OLD, first, at(21));
  assert.equal(more.publishedAt, '2026-10-15T21:00:00.000Z');
});

test('stamp-rev compares with the index committed in its folder', async () => {
  const { execFileSync } = await import('node:child_process');
  const os = await import('node:os');
  const path = await import('node:path');
  const { stampRev } = await import('../scripts/stamp-rev.mjs');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'stamp-rev-'));
  const git = (...a) => execFileSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@t', ...a], { cwd: dir, stdio: 'ignore' });
  const file = path.join(dir, 'index.json');
  const write = (o) => fs.writeFileSync(file, JSON.stringify(o));
  const read = () => JSON.parse(fs.readFileSync(file, 'utf8'));
  try {
    git('init', '-q');
    write({ generatedAt: 'x', source: 'live', competitions: [] });
    await stampRev(file, OLD, OLD);
    const first = read();
    git('add', '.'); git('commit', '-qm', 'one');
    // The ingest rewrites it unchanged (carrying publishedAt): the stamp stays.
    write(first);
    await stampRev(file, OLD, OLD);
    assert.equal(read().publishedAt, first.publishedAt);
    // A new rev moves it.
    await stampRev(file, REV, OLD);
    assert.ok(Date.parse(read().publishedAt) > Date.parse(first.publishedAt));
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('view counts load from the moving branch with the index, except in spoiler-free mode', async () => {
  const { fetched, window } = await run({ route: 'PL md-1', views: true });
  assert.deepEqual(fetched.slice(0, 2), ['@data/index.json', '@data/views.json']);
  assert.ok(window.__rondoEarly['https://cdn.jsdelivr.net/gh/me/repo@data/views.json']);
  assert.ok(!(await run({ route: 'PL md-1', views: true, stored: { 'rondo:spoilerFree': true } })).fetched.includes('@data/views.json'));
});
