import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {
  normalize, teamAliases, mentions, looksLikeMatchHighlight, classify, matchVideosToFixtures, roundOf,
} from '../scripts/lib/match.mjs';
import { COMPETITIONS } from '../scripts/config.mjs';

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
