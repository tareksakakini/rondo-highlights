import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildModel, fingerprint, loadModelFromRepo } from '../scripts/lib/pages.mjs';

const team = (short) => ({ name: `${short} FC`, short, tla: short.slice(0, 3).toUpperCase(), crest: null });
const match = (id, h, a, extra = {}) => ({
  id, utcDate: '2026-09-19T14:00:00Z', status: 'FINISHED', home: team(h), away: team(a),
  score: { home: 1, away: 0 }, highlights: [], ...extra,
});
const index = {
  competitions: [
    { code: 'PL', name: 'Premier League', group: 'league', color: '#3d195b', seasonLabel: '2026/27',
      rounds: [{ key: 'md-1', label: 'Matchweek 1', matches: 2 }, { key: 'md-2', label: 'Matchweek 2', matches: 0 }] },
  ],
};
const files = (matches) => ({ 'PL/md-1': { matches } });
const model = (matches) => buildModel(index, async (c, k) => files(matches)[`${c}/${k}`] ?? null);

test('pages list rounds with fixtures, home v away by short name', async () => {
  const m = await model([match(1, 'Arsenal', 'Chelsea'), match(2, 'Leeds', 'Fulham')]);
  assert.equal(m.competitions.length, 1);
  const t = (short) => ({ name: `${short} FC`, short, tla: short.slice(0, 3).toUpperCase(), crest: null });
  assert.deepEqual(m.competitions[0].rounds, [{
    key: 'md-1', label: 'Matchweek 1', fixtures: ['Arsenal v Chelsea', 'Leeds v Fulham'],
    matches: [{ home: t('Arsenal'), away: t('Chelsea'), hl: false }, { home: t('Leeds'), away: t('Fulham'), hl: false }],
  }]);
});

test('fingerprint ignores scores, dates, highlights and fixture order', async () => {
  const a = await model([match(1, 'Arsenal', 'Chelsea'), match(2, 'Leeds', 'Fulham')]);
  const b = await model([
    match(2, 'Leeds', 'Fulham', { utcDate: '2026-09-21T19:00:00Z', score: { home: 3, away: 3 } }),
    match(1, 'Arsenal', 'Chelsea', { highlights: [{ videoId: 'x' }] }),
  ]);
  assert.equal(fingerprint(a), fingerprint(b));
});

test('fingerprint changes when who plays whom changes', async () => {
  const a = await model([match(1, 'Arsenal', 'Chelsea')]);
  const b = await model([match(1, 'Arsenal', 'Spurs')]);
  assert.notEqual(fingerprint(a), fingerprint(b));
});

test('repo loader reads the index at the given commit and rounds at its rev', async () => {
  const rev = 'a'.repeat(40);
  const hookRef = 'b'.repeat(40);
  const seen = [];
  const fetchImpl = async (url) => {
    seen.push(url);
    const body = url.includes('/index.json') ? { ...index, rev } : url.endsWith('/PL/md-1.json') ? files([match(1, 'Arsenal', 'Chelsea')])['PL/md-1'] : null;
    return { ok: body != null, status: body ? 200 : 404, json: async () => body };
  };
  const m = await loadModelFromRepo('me/repo', { fetchImpl, indexRef: hookRef });
  assert.ok(seen[0].startsWith(`https://raw.githubusercontent.com/me/repo/${hookRef}/index.json`));
  assert.ok(seen.includes(`https://raw.githubusercontent.com/me/repo/${rev}/PL/md-1.json`));
  assert.equal(m.competitions[0].rounds[0].fixtures[0], 'Arsenal v Chelsea');
});

test('the model lists the self-hosted crests its rounds use, once each, sorted; the fingerprint ignores them', async () => {
  const withCrest = (id, h, a, hc, ac) => {
    const m = match(id, h, a);
    m.home.crest = hc; m.away.crest = ac;
    return m;
  };
  const a = await model([
    withCrest(1, 'Arsenal', 'Chelsea', 'crests/bbbbbbbbbbbb.webp', 'crests/aaaaaaaaaaaa.webp'),
    withCrest(2, 'Leeds', 'Fulham', 'https://crests.example/x.png', 'crests/aaaaaaaaaaaa.webp'),
  ]);
  assert.deepEqual(a.crests, ['crests/aaaaaaaaaaaa.webp', 'crests/bbbbbbbbbbbb.webp']);
  const b = await model([withCrest(1, 'Arsenal', 'Chelsea', null, null), withCrest(2, 'Leeds', 'Fulham', null, null)]);
  assert.equal(fingerprint(a), fingerprint(b));
});

test('repo loader reads crests at crestsRev when the index names one, else at rev', async () => {
  const rev = 'a'.repeat(40);
  const crestsRev = 'c'.repeat(40);
  const make = (idx) => async (url) => {
    const body = url.includes('/index.json') ? idx : url.endsWith('/PL/md-1.json') ? files([match(1, 'Arsenal', 'Chelsea')])['PL/md-1'] : null;
    return { ok: body != null, status: body ? 200 : 404, json: async () => body };
  };
  const m1 = await loadModelFromRepo('me/repo', { fetchImpl: make({ ...index, rev, crestsRev }) });
  assert.equal(m1.crestSource.base, `https://raw.githubusercontent.com/me/repo/${crestsRev}/`);
  const m2 = await loadModelFromRepo('me/repo', { fetchImpl: make({ ...index, rev }) });
  assert.equal(m2.crestSource.base, `https://raw.githubusercontent.com/me/repo/${rev}/`);
});
