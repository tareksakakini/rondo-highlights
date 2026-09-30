import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {
  normalize, teamAliases, mentions, fuzzyMentions, looksLikeMatchHighlight, classify, matchVideosToFixtures, roundOf,
} from '../scripts/lib/match.mjs';
import { COMPETITIONS } from '../scripts/config.mjs';
import { NATIONS } from '../scripts/lib/teams.mjs';

const seed = JSON.parse(fs.readFileSync(new URL('../scripts/sample/seed.json', import.meta.url)));

test('normalize strips accents, punctuation and odd letters', () => {
  assert.equal(normalize('Bayern vs. Bodø/Glimt').trim(), 'bayern vs bodo glimt');
  assert.equal(normalize("BORUSSIA M'GLADBACH").trim(), 'borussia mgladbach');
  assert.equal(normalize('Fenerbahçe').trim(), 'fenerbahce');
});

test('aliases derived from football-data names', () => {
  const a = teamAliases({ name: 'Club Atlético de Madrid', shortName: 'Atleti', tla: 'ATM' });
  assert.ok(a.includes('atletico madrid'));
  const u = teamAliases({ name: '1. FC Union Berlin', shortName: 'Union Berlin', tla: 'FCU' });
  assert.ok(u.includes('union berlin'));
  const m = teamAliases({ name: '1. FSV Mainz 05', shortName: 'Mainz', tla: 'M05' });
  assert.ok(mentions(normalize('BORUSSIA MGLADBACH - MAINZ 05 | Highlights'), m));
});

test('whole-word matching: "villa" does not match Villarreal', () => {
  const villa = teamAliases({ name: 'Aston Villa FC', shortName: 'Aston Villa', tla: 'AVL' });
  assert.equal(mentions(normalize('Dortmund vs. Villarreal: Extended Highlights'), villa), '');
});

test('typo-tolerant fallback: one letter off in long words only', () => {
  assert.equal(fuzzyMentions(normalize('Olympiacos vs. Jagiellonia: Extended Highlights'), ['olympiakos piraeus', 'olympiakos']), 'olympiakos');
  assert.equal(fuzzyMentions(normalize('Celtic vs. Ferencváros: Highlights'), ['ferencvarosi tc', 'ferencvarosi']), 'ferencvarosi');
  assert.equal(fuzzyMentions(normalize('Lens vs Lyon highlights'), ['leon']), ''); // short words stay exact
  assert.equal(fuzzyMentions(normalize('Braga vs Brage'), ['sporting braga']), '');
});

test('title filter drops federation extras: pressers, other angles, vlogs, reactions, youth', () => {
  assert.ok(!looksLikeMatchHighlight('LIGA NACIJA | SRBIJA - HOLANDIJA 1:2  KONFERENCIJA ZA MEDIJE (27.09.2026)'));
  assert.ok(!looksLikeMatchHighlight('LIGA NACIJA | SRBIJA - HOLANDIJA 1:2  IZ DRUGOG UGLA (27.09.2026)'));
  assert.ok(!looksLikeMatchHighlight('„NIE WYGRYWASZ, TO NIE PRZEGRAJ” | Vlogowe kulisy meczu POLSKA – BOŚNIA I HERCEGOWINA (0:0)'));
  assert.ok(!looksLikeMatchHighlight('Turquie-France : les réactions (0-1)'));
  assert.ok(!looksLikeMatchHighlight('Highlights P18/08 | Sverige-Finland 2-2'));
  assert.ok(!looksLikeMatchHighlight('Highlights: Italia-Inghilterra 1-3  | Under 20 | La Nucía Tournament'));
  assert.ok(looksLikeMatchHighlight('ČEŠKA - HRVATSKA | SAŽECI | HIGHLIGHTS (26.9.2026.)'));
});

test('national teams are recognised in federation languages', () => {
  const nl = teamAliases({ name: 'Netherlands', national: true, ...NATIONS.find((n) => n.tla === 'NED') });
  assert.ok(mentions(normalize('MEXX MEERDINK\'S FIRST GOALS! | Highlights Serbia - Nederland'), nl));
  const cz = teamAliases(NATIONS.find((n) => n.tla === 'CZE'));
  assert.ok(mentions(normalize('ČEŠKA - HRVATSKA | SAŽECI | HIGHLIGHTS'), cz));
  const fr = teamAliases(NATIONS.find((n) => n.tla === 'FRA'));
  assert.ok(mentions(normalize('Maç Özeti | Türkiye 0-1 Fransa | UEFA Uluslar A Ligi'), fr));
  const md = teamAliases(NATIONS.find((n) => n.tla === 'MDA'));
  assert.ok(mentions(normalize('ZOSTRIH GÓLOV I Slovensko 2:0 Moldavsko (Liga Národov 2026/2027)'), md));
});

test('title filter keeps match highlights, drops compilations, women, cups', () => {
  assert.ok(looksLikeMatchHighlight('Brighton v. Arsenal | PREMIER LEAGUE HIGHLIGHTS | 9/19/2026'));
  assert.ok(!looksLikeMatchHighlight('Every Premier League goal from Matchweek 5'));
  assert.ok(!looksLikeMatchHighlight('Highlights: Man City 4-2 Liverpool FC Women | WSL'));
  assert.ok(!looksLikeMatchHighlight('Liverpool 3-1 Spurs | Carabao Cup Highlights'));
  assert.ok(!looksLikeMatchHighlight('ALL HIGHLIGHTS | BUNDESLIGA | MATCHDAY 04'));
});

test('classify: explicit/long = extended; relative split when both are short-ish', () => {
  const k = classify([
    { title: 'X v Y | Highlights', durationSec: 61 },
    { title: 'X v Y | Highlights', durationSec: 244 },
  ]).map((v) => v.kind);
  assert.deepEqual(k, ['short', 'extended']);
  assert.equal(classify([{ title: 'A v B | EXTENDED Highlights', durationSec: 316 }])[0].kind, 'extended');
  assert.equal(classify([{ title: 'A v B | Highlights', durationSec: 824 }])[0].kind, 'extended');
  assert.equal(classify([{ title: 'A v B | Highlights', durationSec: 178 }])[0].kind, 'short');
});

test('round labels', () => {
  assert.equal(roundOf({ stage: 'REGULAR_SEASON', matchday: 5 }).label, 'Matchweek 5');
  assert.equal(roundOf({ stage: 'LEAGUE_STAGE', matchday: 1 }).label, 'League phase · MD 1');
  assert.equal(roundOf({ stage: 'QUARTER_FINALS' }).key, 'quarter-finals');
});

function runSeed(code) {
  const comp = COMPETITIONS.find((c) => c.code === code);
  const videos = [];
  comp.channels.forEach((ch, priority) => {
    const must = ch.mustMatch ? new RegExp(ch.mustMatch, 'i') : null;
    for (const v of seed.videos) if (v.handle === ch.handle && (!must || must.test(v.title))) videos.push({ ...v, priority });
  });
  return { fixtures: seed.competitions[code], res: matchVideosToFixtures(seed.competitions[code], videos) };
}

test('seed: every PL MW5 match gets highlights; non-embeddable videos are excluded', () => {
  const { fixtures, res } = runSeed('PL');
  for (const f of fixtures) assert.ok(res.get(f.id)?.length, `${f.homeTeam.name} v ${f.awayTeam.name}`);
  const all = [...res.values()].flat().map((h) => h.videoId);
  for (const bad of ['_f5-6jdNP58', 'r4GJDImO_8Y', 'S5IB_FvVOU0', '964lPbGqzpY', '03I3Hwu-KQM', '1u-v_MfP6fE']) {
    assert.ok(!all.includes(bad), bad);
  }
  // NBC (priority 0) is the preferred extended cut
  const brentford = res.get(fixtures.find((f) => f.homeTeam.tla === 'BRE').id);
  assert.equal(brentford.find((h) => h.kind === 'extended').channel, 'NBC Sports');
  assert.equal(brentford.find((h) => h.kind === 'short').videoId, 'gwrydB4FO_Y');
});

test('seed: all 9 Bundesliga and 18 UCL fixtures matched, no cross-talk', () => {
  for (const code of ['BL1', 'CL']) {
    const { fixtures, res } = runSeed(code);
    for (const f of fixtures) assert.ok(res.get(f.id)?.length, `${code} ${f.homeTeam.name} v ${f.awayTeam.name}`);
    const ids = [...res.values()].flat().map((h) => h.videoId);
    assert.equal(new Set(ids).size, ids.length, 'a video was attached to two matches');
  }
  const { res } = runSeed('CL');
  assert.ok(![...res.values()].flat().some((h) => h.videoId === '3R39ogBkDDk'), 'Serie A video leaked into UCL');
});

test('embed blocks merge into country lists', async () => {
  const { withEmbedBlocks } = await import('../scripts/lib/match.mjs');
  const t = { F: ['US'] };
  assert.deepEqual(withEmbedBlocks({ videoId: 'a' }, 'F', t).block, ['US']);
  assert.deepEqual(withEmbedBlocks({ block: ['DE'] }, 'F', t).block, ['DE', 'US']);
  assert.deepEqual(withEmbedBlocks({ allow: ['CA', 'US'] }, 'F', t).allow, ['CA']);
  assert.deepEqual(withEmbedBlocks({ allow: ['US'] }, 'F', t).allow, ['ZZ']);
  assert.equal(withEmbedBlocks({ videoId: 'a' }, 'other', t).block, undefined);
});

test('Nations League MD2 titles: TUDN (Spanish or English), Italian and Slovenian federations', () => {
  const unl = COMPETITIONS.find((c) => c.code === 'UNL');
  const rule = (handle) => new RegExp(unl.channels.find((c) => c.handle === handle).mustMatch, 'i');
  const tudn = rule('@tudn_usa');
  const nation = (name) => NATIONS.find((n) => n.name === name);
  const pairs = [['Germany', 'Greece'], ['Slovakia', 'Kazakhstan'], ['Turkey', 'Italy'], ['Moldova', 'Faroe Islands'],
    ['Northern Ireland', 'Hungary'], ['Slovenia', 'Scotland'], ['Norway', 'Portugal']];
  const fixtures = pairs.map(([h, a], i) => ({ id: i + 1, utcDate: '2026-09-27T18:45:00Z', homeTeam: nation(h), awayTeam: nation(a) }));
  const video = (videoId, title, durationSec) => ({ videoId, title, durationSec, publishedAt: '2026-09-28T09:00:00Z', embeddable: true });
  const tudnTitles = [
    video('t1', 'HIGHLIGHTS - Alemania vs Grecia | UEFA Nations League - Jornada 2 2026-27 | TUDN', 917),
    video('t2', 'SUPER EXTENDED HIGHLIGTS - Eslovaquia vs Kazajistán | UEFA Nations League - Jornada 2 2026-27 | TUDN', 1432),
    video('t3', 'HIGHLIGHTS - Moldavia vs Islas Feroe | UEFA Nations League - Jornada 2 2026-27 | TUDN', 913),
    video('t4', 'HIGHLIGHTS - Irlanda del Norte vs Hungría | UEFA Nations League - Jornada 2 2026-27 | TUDN', 916),
    video('t5', 'SUPER EXTENDED HIGHLIGHTS - Norway vs Portugal | UEFA Nations League - Matchday 2 2026-27 | TUDN', 1499),
  ];
  for (const v of tudnTitles) assert.ok(tudn.test(v.title), v.title);
  assert.ok(!tudn.test('ITALY GOAL! | Turkey vs Italy | UEFA Nations League - Matchday 2 2026-27 | TUDN'), 'goal clips are not highlights');
  assert.ok(!tudn.test('HIGHLIGHTS - América vs Toluca | Liga MX Apertura 2026 | TUDN'), 'other competitions stay out');
  assert.ok(!tudn.test('HIGHLIGHTS - México vs Panamá | Concacaf Nations League 2026-27 | TUDN'), 'CONCACAF stays out');

  const res = matchVideosToFixtures(fixtures, [
    ...tudnTitles,
    video('f1', 'Highlights: Turchia-Italia 1-4 | Nations League 2026/27', 240),
    video('s1', 'Slovenija - Škotska | #NationsLeague | Vrhunci', 117),
  ]);
  const got = Object.fromEntries([...res].map(([id, hs]) => [pairs[id - 1].join(' v '), hs.map((h) => h.videoId).sort()]));
  assert.deepEqual(got, {
    'Germany v Greece': ['t1'], 'Slovakia v Kazakhstan': ['t2'], 'Moldova v Faroe Islands': ['t3'],
    'Northern Ireland v Hungary': ['t4'], 'Norway v Portugal': ['t5'], 'Turkey v Italy': ['f1'], 'Slovenia v Scotland': ['s1'],
  });
  assert.ok(looksLikeMatchHighlight('Belgium vs. France, 0-1: All the key moments (Nations League)'));
});
