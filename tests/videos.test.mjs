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
