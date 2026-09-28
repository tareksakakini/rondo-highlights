import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { parseRound, parseStatus, parseScore, toTeam, toFixtures } from '../scripts/lib/highlightly.mjs';
import { matchVideosToFixtures, roundOf } from '../scripts/lib/match.mjs';

const seed = JSON.parse(fs.readFileSync(new URL('../scripts/sample/seed.json', import.meta.url)));
const clubs = Object.values(seed.competitions).flat().flatMap((f) => [f.homeTeam, f.awayTeam]);

test('rounds: league phase matchdays, knockouts, qualifiers dropped', () => {
  assert.deepEqual(parseRound('League Stage - 8', '2027-01-28T20:00:00.000Z', 2026), { stage: 'LEAGUE_STAGE', matchday: 8 });
  assert.deepEqual(parseRound('League B - 6', '2026-11-17T19:45:00.000Z', 2026), { stage: 'LEAGUE_STAGE', matchday: 6 });
  assert.equal(parseRound('3rd Qualifying Round', '2026-08-06T18:00:00.000Z', 2026), null);
  assert.equal(parseRound('Play-offs', '2026-08-21T18:00:00.000Z', 2026), null); // qualifying play-off (August)
  assert.deepEqual(parseRound('Play-offs', '2027-02-18T20:00:00.000Z', 2026), { stage: 'PLAYOFFS' });
  assert.deepEqual(parseRound('Quarter-finals', '2027-04-08T19:00:00.000Z', 2026), { stage: 'QUARTER_FINALS' });
  assert.deepEqual(parseRound('Semi-finals', '2027-06-02T19:00:00.000Z', 2026), { stage: 'SEMI_FINALS' });
  assert.deepEqual(parseRound('Final', '2027-05-26T19:00:00.000Z', 2026), { stage: 'FINAL' });
  assert.deepEqual(roundOf({ stage: 'LEAGUE_STAGE', matchday: 3 }, 'Matchday'), { key: 'md-3', label: 'League phase · MD 3', matchday: 3 });
});

test('status and score', () => {
  assert.equal(parseStatus('Not started'), 'TIMED');
  assert.equal(parseStatus('Finished'), 'FINISHED');
  assert.equal(parseStatus('Finished after penalties'), 'FINISHED');
  assert.equal(parseStatus('Postponed'), 'POSTPONED');
  assert.equal(parseStatus('Second half'), 'IN_PLAY');
  assert.deepEqual(parseScore('2 - 1'), { home: 2, away: 1 });
  assert.deepEqual(parseScore(null), { home: null, away: null });
});

test('national teams: "National Team" suffix removed, canonical name and code', () => {
  const k = toTeam({ id: 946245, name: 'Kosovo National Team', logo: 'x.png' }, { national: true });
  assert.equal(k.name, 'Kosovo');
  assert.equal(k.tla, 'KVX');
  assert.equal(k.crest, 'x.png');
  assert.equal(toTeam({ name: 'Czech Republic' }, { national: true }).name, 'Czechia');
  assert.equal(toTeam({ name: 'TBD' }, { national: true }), null);
});

test('clubs borrow football-data identity only when it is really the same club', () => {
  const fixtures = toFixtures([
    { id: 1, round: 'League Stage - 1', date: '2026-09-17T19:00:00.000Z', state: { description: 'Finished', score: { current: '1 - 0' } },
      homeTeam: { id: 10, name: 'Real Sociedad' }, awayTeam: { id: 11, name: 'Bournemouth' } },
  ], { season: 2026, knownTeams: clubs.concat([{ id: 99, name: 'FC Internazionale Milano', shortName: 'Inter', tla: 'INT' }]) });
  assert.equal(fixtures[0].awayTeam.tla, 'BOU');
  const turku = toTeam({ name: 'Inter Turku' }, { national: false, clubRegistry: () => ({ key: 'c:99', name: 'FC Internazionale Milano', short: 'Inter', tla: 'INT' }) });
  assert.equal(turku.shortName, 'Inter Turku');
  assert.ok(!turku.extraAliases.includes('FC Internazionale Milano'));
});

test('club acronyms become aliases ("Juventus 5-0 NEC"), club-type prefixes do not', () => {
  const nec = toTeam({ name: 'NEC Nijmegen' }, { national: false });
  assert.ok(nec.extraAliases.includes('NEC'));
  const afc = toTeam({ name: 'AFC Bournemouth' }, { national: false });
  assert.ok(!afc.extraAliases.includes('AFC'));
});

test('sample Europa League + Nations League: every highlight lands on its fixture', () => {
  const el = toFixtures(seed.highlightly.EL, { season: 2026, knownTeams: clubs });
  assert.ok(!el.some((f) => f.id === 952 || f.id === 953), 'qualifiers are dropped');
  assert.ok(!el.some((f) => f.id === 951), 'TBD pairings are dropped');
  const elVideos = seed.videos.filter((v) => /UEL/.test(v.title)).map((v) => ({ ...v, priority: 0 }));
  const got = matchVideosToFixtures(el, elVideos, { windowHours: 120 });
  assert.equal(got.size, 18); // incl. "Olympiacos" vs Highlightly's "Olympiakos", "Ferencváros" vs "Ferencvarosi TC"

  const unl = toFixtures(seed.highlightly.UNL, { season: 2026, national: true });
  const unlVideos = seed.videos.filter((v) => /nations league/i.test(v.title)).map((v) => ({ ...v, priority: 0 }));
  const hits = matchVideosToFixtures(unl, unlVideos, { windowHours: 120 });
  const byId = new Map(unl.map((f) => [f.id, f]));
  assert.deepEqual([...hits.keys()].map((id) => `${byId.get(id).homeTeam.name}-${byId.get(id).awayTeam.name}`).sort(),
    ['England-Spain', 'Italy-Belgium', 'Norway-Denmark', 'Portugal-Wales']);
});
