import { test } from 'node:test';
import assert from 'node:assert/strict';
import { isExcludedMatch, isExcludedTeam } from '../scripts/lib/excluded.mjs';
import { buildCompetition } from '../scripts/lib/match.mjs';
import { buildModel } from '../scripts/lib/pages.mjs';

const fd = (name, tla, shortName = name) => ({ name, shortName, tla });

test('Israel and Israeli clubs are excluded; look-alike names are not', () => {
  for (const t of [fd('Israel', 'ISR'), fd('Hapoel Beer Sheva', 'HAP'), fd('Maccabi Tel Aviv', 'MTA'), fd('Maccabi Haifa', 'MHA'),
    fd('Beitar Jerusalem', 'BEI'), fd('Hapoel Tel-Aviv FC', 'HTA'), fd('Bnei Sakhnin', 'BSA'), fd('Ironi Kiryat Shmona', 'IKS'),
    { name: 'Israël', short: 'Israël', tla: 'ISR' }]) {
    assert.ok(isExcludedTeam(t), t.name);
  }
  for (const t of [fd('Republic of Ireland', 'IRL'), fd('Northern Ireland', 'NIR'), fd('Iceland', 'ISL'), fd('Real Sociedad', 'RSO'),
    fd('Austria', 'AUT'), fd('Kosovo', 'KOS'), fd('Dinamo Zagreb', 'DZG'), fd('Ajax', 'AJA')]) {
    assert.ok(!isExcludedTeam(t), t.name);
  }
});

test('excluded matches are never built into rounds, upcoming ones included', () => {
  const fx = (id, home, away, status = 'TIMED', matchday = 1) => ({
    id, utcDate: `2026-10-0${id}T18:45:00Z`, status, matchday, homeTeam: fd(...home), awayTeam: fd(...away), score: { fullTime: {} },
  });
  const fixtures = [
    fx(1, ['Austria', 'AUT'], ['Israel', 'ISR'], 'FINISHED'),
    fx(2, ['Republic of Ireland', 'IRL'], ['Kosovo', 'KOS']),
    fx(3, ['Hapoel Beer Sheva', 'HAP'], ['Juventus', 'JUV']),
    fx(4, ['Israel', 'ISR'], ['Kosovo', 'KOS'], 'TIMED', 2),
  ];
  assert.ok(isExcludedMatch(fixtures[0]) && !isExcludedMatch(fixtures[1]));
  const { files, index } = buildCompetition({ code: 'UNL', name: 'Nations League' }, 2026, fixtures, new Map());
  assert.deepEqual(files.flatMap((f) => f.matches.map((m) => m.id)), [2]);
  assert.equal(files.length, 1, 'a round made only of excluded matches disappears');
  assert.deepEqual(index.rounds.map((r) => r.matches), [1]);
});

test('prerendered pages skip excluded matches already in stored data', async () => {
  const team = (name, tla) => ({ name, short: name, tla, crest: null });
  const idx = { competitions: [{ code: 'UNL', name: 'Nations League', color: '#000', seasonLabel: '2026/27', rounds: [{ key: 'md-1', label: 'Matchday 1', matches: 2 }] }] };
  const m = await buildModel(idx, async () => ({ matches: [
    { id: 1, home: team('Austria', 'AUT'), away: team('Israel', 'ISR') },
    { id: 2, home: team('Kosovo', 'KOS'), away: team('Republic of Ireland', 'IRL') },
  ] }));
  assert.deepEqual(m.competitions[0].rounds[0].fixtures, ['Kosovo v Republic of Ireland']);
});
