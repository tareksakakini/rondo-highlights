import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { parseTeams, roundFromTitle, makeRegistry, buildFromVideos } from '../scripts/lib/videos.mjs';
import { detectComps, looksLikeMatchHighlight, teamAliases, mentions, normalize, slimHighlight } from '../scripts/lib/match.mjs';
import { COMPETITIONS } from '../scripts/config.mjs';

const seed = JSON.parse(fs.readFileSync(new URL('../scripts/sample/seed.json', import.meta.url)));
const comp = (code) => COMPETITIONS.find((c) => c.code === code);

test('parseTeams handles the title styles we see', () => {
  const cases = [
    ['Juventus vs. NEC Nijmegen: Extended Highlights | UEL League Phase MD1 | CBS Sports Golazo', 'Juventus', 'NEC Nijmegen'],
    ['England defeated at home | England v Spain | Nations League 2026 Highlights', 'England', 'Spain'],
    ['England vs Spain Highlights ⚽ UEFA Nations League', 'England', 'Spain'],
    ['WATKINS WINNER Seals First Leg Victory 🤩 | LOSC Lille 0-1 Aston Villa | Europa League Highlights', 'LOSC Lille', 'Aston Villa'],
    ['VILLA INTO THE SEMI-FINAL | Aston Villa 4-0 Bologna (Agg. 7-1) | UEFA Europa League Highlights', 'Aston Villa', 'Bologna'],
    ['Newcastle United 2 Hull City 1 | Premier League Highlights', 'Newcastle United', 'Hull City'],
    ['Ararat-Armenia vs. Sparta Praha: Extended Highlights | UEL League Phase MD1 | CBS Sports', 'Ararat-Armenia', 'Sparta Praha'],
  ];
  for (const [title, h, a] of cases) {
    const p = parseTeams(title);
    assert.deepEqual([p?.home, p?.away], [h, a], title);
  }
  assert.deepEqual(parseTeams('Highlights | Spain 1-0 Argentina | FIFA World Cup 2026™ FINAL').score, [1, 0]);
});

test('round hints from titles', () => {
  assert.deepEqual(roundFromTitle('X vs. Y: Extended Highlights | UEL League Phase MD1'), { md: 1 });
  assert.deepEqual(roundFromTitle('Highlights | Spain 1-0 Argentina | FIFA World Cup 2026™ FINAL'), { stage: 'FINAL' });
  assert.deepEqual(roundFromTitle('England v Spain | Nations League 2026 Highlights'), {});
});

test('competition hints keep shared club/nation channels in the right competition', () => {
  assert.deepEqual([...detectComps('FENERBAHCE 1-1 ROMA | UCL HIGHLIGHTS 2026-27')], ['CL']);
  assert.deepEqual([...detectComps('ROMA 2-2 INTER | SERIE A HIGHLIGHTS 2026-27')], ['SA']);
  assert.deepEqual([...detectComps('England v Spain | Nations League 2026 Highlights')], ['UNL']);
  assert.deepEqual([...detectComps('Aston Villa 3-2 RB Salzburg | UEFA Europa League Highlights')], ['EL']);
  assert.ok(detectComps('Spain 2-1 Germany | EURO 2024 Quarter-Final').has('EC'));
  assert.ok(!detectComps('Europa League Final Highlights').has('EC'));
});

test('excluded: classics, youth/qualifiers, friendlies, tunnel cams', () => {
  assert.ok(!looksLikeMatchHighlight('England v Spain | Classic Nations League Highlights'));
  assert.ok(!looksLikeMatchHighlight('RESUMEN I Finlandia 2-1 España I Clasificación Europeo sub-21 | Jornada 8'));
  assert.ok(!looksLikeMatchHighlight('Brunner dazzles on debut | Latvia vs Germany | U-21 EURO Qualifier Highlights'));
  assert.ok(!looksLikeMatchHighlight('RESUMEN | Italia 1-5 España | Partido internacional amistoso sub-16'));
  assert.ok(looksLikeMatchHighlight('England defeated at home | England v Spain | Nations League 2026 Highlights'));
});

test('national-team aliases across languages', () => {
  const eng = teamAliases({ name: 'England', tla: 'ENG' });
  assert.ok(mentions(normalize('HIGHLIGHTS - Inglaterra vs España'), eng));
  const kor = teamAliases({ name: 'Korea Republic', tla: 'KOR' });
  assert.ok(mentions(normalize('South Korea vs Brazil Highlights'), kor));
});

test('registry canonicalises clubs across channels', () => {
  const canonical = makeRegistry([{ id: 1044, name: 'AFC Bournemouth', shortName: 'Bournemouth', tla: 'BOU' }]);
  assert.equal(canonical('AFC Bournemouth').key, canonical('Bournemouth').key);
  assert.equal(canonical('Inglaterra').key, canonical('England').key);
  assert.equal(canonical('Levski Sofia').name, 'Levski Sofia');
});

function candidates(c) {
  const out = [];
  c.channels.forEach((ch, priority) => {
    for (const v of seed.videos) if (v.handle === ch.handle) out.push({ ...v, priority, tier: ch.tier });
  });
  return out;
}

test('Europa League MD1 discovered from CBS titles', () => {
  const known = Object.values(seed.competitions).flat().flatMap((f) => [f.homeTeam, f.awayTeam]);
  const built = buildFromVideos(comp('EL'), 2026, candidates(comp('EL')), makeRegistry(known));
  assert.equal(built.files.length, 1);
  assert.equal(built.files[0].round.label, 'League phase · MD 1');
  assert.equal(built.files[0].matches.length, 18);
  const m = built.files[0].matches.find((x) => x.home.name.includes('Real Sociedad'));
  assert.ok(m.away.name.includes('Bournemouth'));
  assert.deepEqual(m.highlights[0].allow, ['US']);
});

test('Nations League: FOX + federation channel merge into one match; tunnel cam ignored', () => {
  const built = buildFromVideos(comp('UNL'), 2026, candidates(comp('UNL')), makeRegistry([]));
  const all = built.files.flatMap((f) => f.matches);
  const engEsp = all.filter((m) => m.home.name === 'England' && m.away.name === 'Spain');
  assert.equal(engEsp.length, 1);
  const ids = engEsp[0].highlights.map((h) => h.videoId).sort();
  assert.deepEqual(ids, ['704E4qdUcQI', 'oewyeR5F7TM'].sort());
  // worldwide federation cut is the short one; FOX (US + territories) the extended
  assert.equal(engEsp[0].highlights.find((h) => h.videoId === 'oewyeR5F7TM').kind, 'short');
  assert.equal(all.length, 4);
  assert.match(built.files[0].round.label, /Sep/);
});

test('slimHighlight keeps country lists only when present', () => {
  assert.equal('allow' in slimHighlight({ videoId: 'x', allow: undefined }), false);
  assert.deepEqual(slimHighlight({ videoId: 'x', block: ['DE'] }).block, ['DE']);
});

test('club competitions never resolve to national teams', () => {
  const clubs = makeRegistry([{ id: 1, name: 'AC Sparta Praha', shortName: 'Sparta Praha', tla: 'SPA' }], { nations: false });
  assert.notEqual(clubs('Ararat-Armenia').key, clubs('Armenia').key.replace('x:', 'n:'));
  assert.equal(clubs('Ararat-Armenia').name, 'Ararat-Armenia');
  const nations = makeRegistry([], { clubs: false });
  assert.equal(nations('Italia').key, 'n:ITA');
  assert.equal(nations('Sverige').key, 'n:SWE');
});

test('the same fixture spelled differently by two channels merges into one match', () => {
  const c = COMPETITIONS.find((x) => x.code === 'EL');
  const canonical = makeRegistry([{ id: 71, name: 'Sunderland AFC', shortName: 'Sunderland', tla: 'SUN' }, { id: 109, name: 'Juventus FC', shortName: 'Juventus', tla: 'JUV' }], { nations: false });
  const v = (videoId, title, channel, priority, tier, publishedAt, durationSec = 600) => ({ videoId, title, channel, priority, tier, publishedAt, durationSec, embeddable: true });
  const built = buildFromVideos(c, 2026, [
    v('a', 'Sunderland vs. AZ Alkmaar: Extended Highlights | UEL League Phase MD1 | CBS Sports Golazo', 'CBS', 0, 'broadcaster', '2026-09-16T21:29:06Z'),
    v('b', 'Sunderland 2-0 Alkmaar | Europa League Highlights', 'TNT Sports', 1, 'broadcaster', '2026-09-16T22:10:00Z', 180),
    v('c', 'Juventus vs. NEC Nijmegen: Extended Highlights | UEL League Phase MD1 | CBS Sports Golazo', 'CBS', 0, 'broadcaster', '2026-09-17T21:16:34Z'),
    v('d', 'JUVENTUS-NEC 3-1 | HIGHLIGHTS | UEFA Europa League', 'Juventus', 5, 'club', '2026-09-18T08:00:00Z', 150),
  ], canonical);
  const ms = built.files.flatMap((f) => f.matches);
  assert.equal(ms.length, 2);
  assert.ok(ms.every((m) => m.highlights.length === 2));
  assert.equal(ms.find((m) => m.home.name.startsWith('Juventus')).away.name, 'NEC Nijmegen');
});

test('localized federation titles', () => {
  assert.deepEqual(parseTeams('Italia-Belgio 2-1 | Highlights | UEFA Nations League 2026/27'), { home: 'Italia', away: 'Belgio', score: [2, 1] });
  assert.ok(detectComps('Polska - Szwecja 1:1 | Skrót meczu | Liga Narodów').has('UNL'));
  assert.ok(looksLikeMatchHighlight('Hrvatska - Portugal 2:1 | Sažetak | Liga nacija'));
});

test('scoreline titles without the word "highlights" count; filler does not', () => {
  const yes = [
    "OLYMPIQUE DE MARSEILLE - PARIS SAINT-GERMAIN (1-2) | Week 5 - Ligue 1 McDonald's 26/27",
    'Historic week ends in defeat at Vitality Stadium | AFC Bournemouth 0-1 Liverpool',
    'EAGLES BIGGEST EUROPEAN WIN | Crystal Palace 4-0 Lech Poznań | UEFA Europa League',
  ];
  for (const t of yes) assert.ok(looksLikeMatchHighlight(t), t);
  const no = [
    "Highlights Week 5 | Ligue 1 McDonald's 26/27 ", // no teams: fine to pass the filter, but check filler below
    'Newcastle United 2-1 Hull City | Sergej Jakirović\'s Post Match Reaction',
    'Kluivert and Tavernier goals and celebrations from unique views | Alt Angle',
    'Narrow Defeat In Game of Two Halves | Behind the Tigers Vs Newcastle United',
    'Seven games unbeaten as Blues celebrate! | IN HD: Everton v Ipswich Town',
    "All goals Week 5 | Ligue 1 McDonald's 26/27",
    'TOP SAVES From the Serie A Round 5 | 2026/27',
  ].slice(1);
  for (const t of no) assert.ok(!looksLikeMatchHighlight(t), t);
});

test('"classic" is only trusted where a real fixture backs the video', () => {
  const t = 'EXTENDED HIGHLIGHTS | Man City 5-3 Sunderland | A Premier League Classic at the Etihad!';
  assert.ok(looksLikeMatchHighlight(t, { fixtures: true }));
  assert.ok(!looksLikeMatchHighlight(t));
  assert.ok(!looksLikeMatchHighlight('England v Spain | Classic Nations League Highlights'));
});

test('Ligue 1 official titles resolve to both teams', () => {
  const t = normalize("OLYMPIQUE DE MARSEILLE - PARIS SAINT-GERMAIN (1-2) | Week 5 - Ligue 1 McDonald's 26/27");
  assert.ok(mentions(t, teamAliases({ name: 'Olympique de Marseille', shortName: 'Marseille', tla: 'MAR' })));
  assert.ok(mentions(t, teamAliases({ name: 'Paris Saint-Germain FC', shortName: 'PSG', tla: 'PSG' })));
  const b = normalize("AJ AUXERRE - STADE BRESTOIS 29 (2-1) | Week 5 - Ligue 1 McDonald's 26/27");
  assert.ok(mentions(b, teamAliases({ name: 'Stade Brestois 29', shortName: 'Brest', tla: 'SB2' })));
  assert.ok(mentions(b, teamAliases({ name: 'AJ Auxerre', shortName: 'Auxerre', tla: 'AUX' })));
  const h = normalize("TOULOUSE FC - HAVRE AC (3-2) | Week 5 - Ligue 1 McDonald's 26/27");
  assert.ok(mentions(h, teamAliases({ name: 'Le Havre AC', tla: 'HAC' })));
  for (const [title, name, tla] of [
    ['ANGERS SCO - ESTAC TROYES (2-0)', 'ES Troyes AC', 'ETR'], ['AS MONACO - RC LENS (2-1)', 'Racing Club de Lens', 'RCL'],
    ['AS MONACO - RC LENS (2-1)', 'AS Monaco FC', 'ASM'], ['OGC NICE - LOSC LILLE (2-1)', 'Lille OSC', 'LIL'],
    ['OLYMPIQUE LYONNAIS - STADE RENNAIS (4-0)', 'Stade Rennais FC 1901', 'REN'], ['PARIS FC - RC STRASBOURG ALSACE (2-1)', 'RC Strasbourg Alsace', 'RC '],
  ]) assert.ok(mentions(normalize(title + ' |'), teamAliases({ name, tla })), `${name} in ${title}`);
});
