import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {
  normalize, teamAliases, mentions, fuzzyMentions, looksLikeMatchHighlight, classify, matchVideosToFixtures, roundOf,
  isFirstTeam, stillBelongs, buildCompetition,
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
  assert.ok(!looksLikeMatchHighlight('Roy Keane, Daniel Sturridge & Micah Richards ANALYSE Liverpool 0-3 Man City'));
  assert.ok(!looksLikeMatchHighlight('Every Angle of Igor Jesus\' 88th-Minute Winner! 🤩 | Aston Villa 1-2 Nottingham Forest'));
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

test('first teams only: youth, women and reserve sides are dropped', () => {
  for (const t of [
    'HIGHLIGHTS | BORUSSIA DORTMUND 2-3 VILLARREAL | UYL',
    'UEFA Youth League Highlights | Barcelona 2-1 Bayern',
    'Highlights Primavera | Il Milan batte la Juve e vola in vetta alla classifica | Milan 2-0 Juventus',
    'RESUMEN #U19WEURO | España 2-1 Austria | Fase de grupos (Jornada 3)',
    'Juvenil A | Real Madrid 3-0 Atlético | Resumen',
    'Highlights | Borussia Dortmund II 1-1 Aachen | 3. Liga',
    'RESUMEN | Real Madrid Castilla 2-0 Ceuta',
    'Jong Ajax - Jong PSV (1-2) | Samenvatting',
    'Arsenal 2-2 Chelsea | Premier League 2 Highlights',
    'Man City 3-0 Everton | Women\'s Super League highlights',
  ]) assert.ok(!isFirstTeam(t) && !looksLikeMatchHighlight(t, { fixtures: true }), t);
  for (const t of [
    'HIGHLIGHTS | BORUSSIA DORTMUND 3-2 VILLARREAL | CHAMPIONS LEAGUE',
    'Guirassy Strikes Twice Late On! | Dortmund 3-2 Villarreal | UEFA Champions League Highlights',
    'De Jong stunner! | Barcelona 2-0 Sevilla | LaLiga Highlights',
  ]) assert.ok(isFirstTeam(t) && looksLikeMatchHighlight(t, { fixtures: true }), t);
});

const BVB = { id: 4, name: 'Borussia Dortmund', shortName: 'Dortmund', tla: 'BVB' };
const VIL = { id: 94, name: 'Villarreal CF', shortName: 'Villarreal', tla: 'VIL' };
const bvbVil = { id: 1, utcDate: '2026-09-08T19:00:00Z', status: 'FINISHED', matchday: 1, stage: 'LEAGUE_STAGE',
  homeTeam: BVB, awayTeam: VIL, score: { fullTime: { home: 3, away: 2 } } };
const vid = (videoId, title) => ({ videoId, title, channel: 'Villarreal CF', channelId: 'x', durationSec: 120, publishedAt: '2026-09-09T15:00:00Z', embeddable: true, priority: 26 });

test('a scoreline that is not the final score belongs to another game', () => {
  const got = matchVideosToFixtures([bvbVil], [
    vid('youth', 'HIGHLIGHTS | BORUSSIA DORTMUND 2-3 VILLARREAL'), // no "UYL" tag: caught by the score
    vid('first', 'HIGHLIGHTS | BORUSSIA DORTMUND 3-2 VILLARREAL | CHAMPIONS LEAGUE'),
    vid('away-first', 'Villarreal 2-3 Dortmund | Highlights'), // away team named first
    vid('no-score', 'Dortmund vs. Villarreal: Extended Highlights'),
  ]);
  assert.deepEqual(got.get(1).map((h) => h.videoId).sort(), ['away-first', 'first', 'no-score']);
  // Unfinished fixtures and shoot-outs are never judged by the scoreline.
  const live = { ...bvbVil, status: 'IN_PLAY' };
  assert.equal(matchVideosToFixtures([live], [vid('youth', 'HIGHLIGHTS | BORUSSIA DORTMUND 2-3 VILLARREAL')]).get(1).length, 1);
  const pens = { ...bvbVil, score: { duration: 'PENALTY_SHOOTOUT', fullTime: { home: 7, away: 6 }, penalties: { home: 4, away: 3 } } };
  assert.equal(matchVideosToFixtures([pens], [vid('p', 'Dortmund 3-3 Villarreal | Highlights')]).get(1).length, 1);
});

test('highlights kept from earlier runs are re-checked against today\'s filters', () => {
  const stored = (videoId, title) => ({ ...vid(videoId, title), kind: 'short' });
  const previous = new Map([['md-1', { round: { key: 'md-1' }, matches: [{ id: 1, highlights: [
    stored('uyl', 'HIGHLIGHTS | BORUSSIA DORTMUND 2-3 VILLARREAL | UYL'),
    stored('first', 'HIGHLIGHTS | BORUSSIA DORTMUND 3-2 VILLARREAL | CHAMPIONS LEAGUE'),
  ] }] }]]);
  const { files } = buildCompetition({ code: 'CL', name: 'Champions League' }, 2026, [bvbVil], new Map(), previous);
  assert.deepEqual(files[0].matches[0].highlights.map((h) => h.videoId), ['first']);
  assert.ok(stillBelongs(stored('ok', 'Dortmund 3-2 Villarreal | UCL Highlights'), bvbVil));
});

// Real PL titles from Matchweek 6 (data branch, 2026-10-13).
const ARS = { id: 57, name: 'Arsenal FC', shortName: 'Arsenal', tla: 'ARS' };
const LEE = { id: 341, name: 'Leeds United FC', shortName: 'Leeds United', tla: 'LEE' };
const arsLee = { id: 2, utcDate: '2026-10-10T11:30:00Z', status: 'FINISHED', matchday: 6,
  homeTeam: ARS, awayTeam: LEE, score: { fullTime: { home: 2, away: 1 } } };
const plVid = (videoId, title) => ({ ...vid(videoId, title), publishedAt: '2026-10-10T14:00:00Z' });

test('single-goal clips are not highlights, even when their running score is the final one', () => {
  const skipped = new Set();
  const got = matchVideosToFixtures([arsLee], [
    plVid('nbc-goal', 'Bruno Guimaraes drills Arsenal 2-1 ahead of Leeds | Premier League | NBC Sports'),
    plVid('nbc-goal-2', 'Riccardo Calafiori makes it 1-1 for Arsenal against Leeds | Premier League | NBC Sports'),
    plVid('angles', 'Bukayo Saka\'s winner | Arsenal 2-1 Leeds United | All Angles'),
    plVid('club', 'Arsenal 2-1 Leeds United | Premier League highlights'),
    plVid('score-only', 'Gunners come from behind | Arsenal 2-1 Leeds United'),
    plVid('nbc-full', 'Arsenal v. Leeds United | PREMIER LEAGUE HIGHLIGHTS | 10/10/2026 | NBC Sports'),
  ], { skipped });
  assert.deepEqual(got.get(2).map((h) => h.videoId).sort(), ['club', 'nbc-full', 'score-only']);
  // They named the fixture, so they aren't reported as unmatched misses either.
  assert.deepEqual([...skipped].sort(), ['nbc-goal', 'nbc-goal-2']);
  // Stored clips from before the fix are dropped on the next run.
  assert.ok(!stillBelongs({ ...plVid('nbc-goal', 'Bruno Guimaraes drills Arsenal 2-1 ahead of Leeds | Premier League | NBC Sports'), kind: 'short' }, arsLee));
});

test('a scoreline between the names still counts with club-name noise around it', () => {
  const RSO = { id: 92, name: 'Real Sociedad de Fútbol', shortName: 'Real Sociedad', tla: 'RSO' };
  const BOU = { id: 1044, name: 'AFC Bournemouth', shortName: 'Bournemouth', tla: 'BOU' };
  const f = { ...arsLee, homeTeam: RSO, awayTeam: BOU, score: { fullTime: { home: 1, away: 2 } } };
  const t = 'Kluivert and Rayan on scoresheet in HISTORIC first win in Europe | Real Sociedad 1-2 AFC Bournemouth';
  assert.equal(matchVideosToFixtures([f], [plVid('bou', t)]).get(2).length, 1);
  // Ligue 1's own channel: "A - B (x-y)".
  const OM = { id: 516, name: 'Olympique de Marseille', shortName: 'Marseille', tla: 'MAR' };
  const STR = { id: 576, name: 'RC Strasbourg Alsace', shortName: 'Strasbourg', tla: 'RCS' };
  const l1 = { ...arsLee, homeTeam: OM, awayTeam: STR, score: { fullTime: { home: 4, away: 0 } } };
  const t2 = 'OLYMPIQUE DE MARSEILLE - RC STRASBOURG ALSACE (4-0) | Week 1 - Ligue 1 McDonald\'s 26/27';
  assert.equal(matchVideosToFixtures([l1], [plVid('l1', t2)]).get(2).length, 1);
});

test('interviews, behind-the-scenes and live streams are not highlights', () => {
  for (const t of [
    '“Take the positives into next weekend” | James Justin | Arsenal 2-1 Leeds United',
    '\'I\'m very happy" | Goalscorer Anton Stach | Nottingham Forest 0-1 Leeds United',
    'Sensational night at Elland Road | Uncut exclusive footage | Leeds United 4-1 Newcastle United',
    'Extra Time Show: Nottingham Forest 0-1 Leeds United | Premier League',
    'Inside: Ipswich 0-2 Liverpool | Unseen moments from Friday night win',
    'Fábio\'s PL Return + Jaidon\'s First Goal ❤️ | Inside Brentford | Brentford 3-0 Chelsea',
    'CITY BEAT BOURNEMOUTH! | MATCHDAY LIVE | Man City 2-1 Bournemouth | Premier League',
    'Athletic Club vs. Sevilla [FIRST 15 MINUTES LIVE] | LALIGA Highlights | ESPN FC',
    'Pós-jogo | UEFA Champions League: Sporting CP 3-1 Galatasaray SK',
    'FILIPE LUÍS | CONFÉRENCE D\'APRÈS-MATCH 🇫🇷 | COLETIVA PÓS-JOGO 🇧🇷 | AS MONACO - RC LENS (2-1)',
  ]) assert.ok(!looksLikeMatchHighlight(t, { fixtures: true }), t);
  // A quoted opener is fine when the title says "highlights".
  assert.ok(looksLikeMatchHighlight('"What a goal!" | Arsenal 2-1 Leeds | Premier League Highlights', { fixtures: true }));
  // Over 30 minutes is a stream or a full match, whatever the title says.
  const long = { ...plVid('stream', 'Arsenal 2-1 Leeds United | Premier League highlights'), durationSec: 4 * 3600 };
  assert.equal(matchVideosToFixtures([arsLee], [long]).get(2), undefined);
  assert.ok(!stillBelongs({ ...long, kind: 'extended' }, arsLee));
});

test('a press conference titled with the speaker is not a highlight, however its scoreline sits', () => {
  const LIV = { id: 64, name: 'Liverpool FC', shortName: 'Liverpool', tla: 'LIV' };
  const BHA = { id: 397, name: 'Brighton & Hove Albion FC', shortName: 'Brighton Hove', tla: 'BHA' };
  const f = { ...arsLee, homeTeam: LIV, awayTeam: BHA, score: { fullTime: { home: 2, away: 0 } } };
  const presser = plVid('presser', 'Isak\'s Form, Ronald Araujo, Anfield Win | Liverpool 2-0 Brighton | Andoni Iraola');
  const got = matchVideosToFixtures([f], [
    presser,
    plVid('club', 'Highlights: Liverpool 2-0 Brighton'),
    plVid('score-only', 'Reds hold firm at Anfield | Liverpool 2-0 Brighton | Premier League'),
  ]);
  assert.deepEqual(got.get(2).map((h) => h.videoId).sort(), ['club', 'score-only']);
  // Stored before the fix: dropped on the next run.
  assert.ok(!stillBelongs({ ...presser, kind: 'short' }, f));
  // A segment that is a team's name, or a competition's, isn't a speaker.
  const villa = { ...arsLee, homeTeam: { id: 58, name: 'Aston Villa FC', shortName: 'Aston Villa', tla: 'AVL' } };
  assert.equal(matchVideosToFixtures([villa], [plVid('v', 'Late drama | Aston Villa 2-1 Leeds | Aston Villa')]).get(2).length, 1);
  assert.equal(matchVideosToFixtures([arsLee], [plVid('e', 'Gunners come from behind | Arsenal 2-1 Leeds | Premier League')]).get(2).length, 1);
  // Two capitalised words that aren't a name: Turkish for "match summary".
  assert.equal(matchVideosToFixtures([arsLee], [plVid('tr', 'Maç Özeti | Arsenal 2-1 Leeds')]).get(2).length, 1);
});

test('a possessive still names the team, so its running score is judged too', () => {
  assert.equal(normalize("Liverpool's defense").trim(), 'liverpool defense');
  const LIV = { id: 64, name: 'Liverpool FC', shortName: 'Liverpool', tla: 'LIV' };
  const MCI = { id: 65, name: 'Manchester City FC', shortName: 'Man City', tla: 'MCI' };
  const f = { ...arsLee, homeTeam: LIV, awayTeam: MCI, score: { fullTime: { home: 0, away: 3 } } };
  const t = "Manchester City breach 10-man Liverpool's defense in 3-0 romp | Premier League Update | NBC Sports";
  assert.equal(matchVideosToFixtures([f], [plVid('update', t)]).get(2), undefined);
});

// Real teams and titles that went unmatched in the 2026/27 season (data branch, 2026-10-10).
const club = (id, name, shortName, tla) => ({ id, name, shortName, tla });
const SAN = club(275, 'Real Racing Club de Santander', 'Santander', 'SAN');
const ATL = club(78, 'Club Atlético de Madrid', 'Atleti', 'ATL');
const ALA = club(263, 'Deportivo Alavés', 'Alavés', 'ALA');
const BAR = club(81, 'FC Barcelona', 'Barça', 'FCB');
const BAY = club(5, 'FC Bayern München', 'Bayern', 'FCB');
const fixture = (id, utcDate, homeTeam, awayTeam, home, away) =>
  ({ id, utcDate, status: 'FINISHED', matchday: 1, homeTeam, awayTeam, score: { fullTime: { home, away } } });
const upload = (videoId, title, publishedAt, channel = 'LALIGA EA SPORTS') =>
  ({ videoId, title, channel, channelId: 'x', durationSec: 180, publishedAt, embeddable: true, priority: 1 });
const ids = (res, id) => (res.get(id) ?? []).map((h) => h.videoId).sort();

test('LaLiga titles Racing Santander "R. RACING CLUB"', () => {
  const fixtures = [
    fixture(564687, '2026-09-16T19:30:00Z', BAR, SAN, 7, 2),
    fixture(564694, '2026-09-19T16:30:00Z', club(558, 'RC Celta de Vigo', 'Celta', 'CEL'), SAN, 5, 0),
  ];
  const res = matchVideosToFixtures(fixtures, [
    upload('bar', 'FC BARCELONA 7 - 2 R. RACING CLUB | RESUMEN LALIGA EA SPORTS', '2026-09-16T22:00:00Z'),
    upload('cel', 'CELTA 5 - 0 R. RACING CLUB | RESUMEN LALIGA EA SPORTS', '2026-09-19T19:00:00Z'),
  ]);
  assert.deepEqual(ids(res, 564687), ['bar']);
  assert.deepEqual(ids(res, 564694), ['cel']);
  // No cross-talk with RC Lens ("Racing Club de Lens").
  const san = teamAliases(SAN);
  assert.equal(mentions(normalize('Racing Club de Lens 2-0 Lille | Highlights Ligue 1'), san), '');
});

test('Atlético\'s aliases apply under its current TLA (ATL) and the old one (ATM)', () => {
  const title = 'DEPORTIVO ALAVÉS 1 - 2 ATLÉTICO DE MADRID | RESUMEN LALIGA EA SPORTS';
  for (const tla of ['ATL', 'ATM']) {
    const res = matchVideosToFixtures([fixture(564699, '2026-10-10T14:15:00Z', ALA, { ...ATL, tla }, 1, 2)], [
      upload('laliga', title, '2026-10-10T17:00:00Z'),
      upload('club', 'Alavés 1-2 Atlético de Madrid | ⚽ Grimaldo & Romero | HIGHLIGHTS, LaLiga - MD8', '2026-10-10T18:00:00Z', 'Atlético de Madrid'),
    ]);
    assert.deepEqual(ids(res, 564699), ['club', 'laliga'], tla);
  }
});

test('"Angers SCO" is plain "Angers" in titles', () => {
  const res = matchVideosToFixtures([fixture(559666, '2026-10-10T18:45:00Z', club(512, 'Stade Brestois 29', 'Brest', 'BRE'), club(532, 'Angers SCO', 'Angers SCO', 'ANG'), 5, 1)], [
    upload('bein', 'Stade Brest vs Angers | HIGHLIGHTS Ligue 1 | 10/10/2026 | beIN SPORTS USA', '2026-10-10T22:00:00Z', 'beIN SPORTS USA'),
  ]);
  assert.deepEqual(ids(res, 559666), ['bein']);
});

test('Barcelona and Bayern share the TLA FCB but not their nicknames', () => {
  const bar = teamAliases(BAR);
  const bay = teamAliases(BAY);
  assert.equal(mentions(normalize('Bayern 3-0 Frankfurt | Highlights'), bar), '');
  assert.equal(mentions(normalize('Barça 2-0 Sevilla | Highlights'), bay), '');
  assert.equal(mentions(normalize('Barça 2-0 Sevilla | Highlights'), bar), 'barca');
  assert.equal(mentions(normalize('Bayern Munich 3-0 Frankfurt | Highlights'), bay), 'bayern munich');
});
