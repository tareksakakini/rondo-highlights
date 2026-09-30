import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { parseChapters, momentsFor, isActionChapter, goalsIn, PRE_SEC, POST_SEC } from '../scripts/lib/condense.mjs';
import { main, needsFetch } from '../scripts/condense.mjs';

// Automatic chapters of real Premier League 2026/27 MD5 extended cuts (checked by hand
// against the commentary: every goal lands within ~2 s before to ~10 s after a start).
const BRIGHTON_ARSENAL = { dur: 824, goals: 3, ch: [[0, 'Match buildup and opening'], [165, 'Pascal Gross opens scoring'], [282, 'Kostoulas doubles the lead'], [444, 'Chema adds a third goal'], [584, "Arsenal's missed chances"], [774, 'Match conclusion']] };
const NEWCASTLE_HULL = { dur: 735, goals: 3, ch: [[0, 'Match preview and kickoff'], [83, 'Early Newcastle dominance'], [171, 'Extending the lead'], [247, 'Penalty drama and saves'], [349, 'Tactical battle continues'], [457, "Hull City's response"], [627, 'Final minutes and review']] };
const CITY_SUNDERLAND = { dur: 831, goals: 8, ch: [[0, 'Match preview and setup'], [70, 'Early goals and intensity'], [213, 'Tactical exchanges'], [384, 'High-scoring battle'], [561, 'Decisive moments'], [808, 'Match conclusion']] };
const SPURS_VILLA = { dur: 922, goals: 5, ch: [[0, 'Match preview and early play'], [304, 'Aston Villa takes the lead'], [431, 'Spurs goal ruled offside'], [549, 'Villa extends their lead'], [692, 'Tottenham attempts a comeback'], [883, 'Post-match analysis']] };
const LFC_BOURNEMOUTH = { dur: 596, goals: 1, ch: [[0, 'Match preview'], [22, 'Team lineup announcements'], [68, 'First half action'], [286, 'Isak breaks the deadlock'], [371, 'Defending the lead'], [566, 'Post-match reflection']] };
const chapters = (v) => v.ch.map(([start, title]) => ({ start, title }));

test('action chapters vs framing chapters', () => {
  for (const t of ['Pascal Gross opens scoring', 'Extending the lead', 'Late United equalizer', 'Isak breaks the deadlock', 'Early Newcastle dominance', 'A high-scoring first half'])
    assert.ok(isActionChapter(t), t);
  for (const t of ['Match preview and setup', 'Team lineup announcements', 'First half action', 'Post-match reflection', 'Match conclusion', 'Final minutes and review', 'Studio sign-off'])
    assert.ok(!isActionChapter(t), t);
});

test('each action chapter becomes a padded moment', () => {
  const r = momentsFor(chapters(BRIGHTON_ARSENAL), BRIGHTON_ARSENAL.dur, BRIGHTON_ARSENAL.goals);
  assert.deepEqual(r.m, [165, 282, 444, 584].map((s) => [s - PRE_SEC, s + POST_SEC]));
  assert.equal(r.s, 4 * (PRE_SEC + POST_SEC));
  const n = momentsFor(chapters(NEWCASTLE_HULL), NEWCASTLE_HULL.dur, NEWCASTLE_HULL.goals);
  assert.equal(n.m.length, 5);
  const l = momentsFor(chapters(LFC_BOURNEMOUTH), LFC_BOURNEMOUTH.dur, LFC_BOURNEMOUTH.goals);
  assert.deepEqual(l.m, [[266, 311], [351, 396]]);
});

test('fewer action chapters than goals: no condensed cut', () => {
  assert.equal(momentsFor(chapters(CITY_SUNDERLAND), CITY_SUNDERLAND.dur, CITY_SUNDERLAND.goals), null);
  assert.equal(momentsFor(chapters(SPURS_VILLA), SPURS_VILLA.dur, SPURS_VILLA.goals), null);
});

test('close moments merge; edges clamp; no saving means no cut', () => {
  const r = momentsFor([{ start: 10, title: 'Goal' }, { start: 60, title: 'Goal' }, { start: 300, title: 'Goal' }], 320, 3);
  assert.deepEqual(r.m, [[0, 85], [280, 320]]);
  assert.equal(momentsFor([{ start: 30, title: 'Goal' }], 55, 1), null); // would keep the whole video
  assert.equal(momentsFor([], 600, 0), null);
  assert.equal(momentsFor([{ start: 100, title: 'Goal' }], 13482, 1), null); // a 3-hour show
});

test('videos that are not match highlights are left alone', () => {
  const pressConference = [[0, 'Analyzing the victory'], [68, 'Tactical match breakdown'], [149, 'Strength in player commitment'], [251, 'Maintaining league ambition'], [291, 'Managing the international break']];
  assert.equal(momentsFor(pressConference.map(([start, title]) => ({ start, title })), 568, 3), null);
  const inside = [[0, 'Match preview and analysis'], [166, 'Match highlights'], [726, 'Post-match reactions']];
  assert.equal(momentsFor(inside.map(([start, title]) => ({ start, title })), 877, 1), null);
});

test('unknown score: no goal gate', () => {
  assert.ok(momentsFor(chapters(CITY_SUNDERLAND), CITY_SUNDERLAND.dur, null));
  assert.equal(goalsIn({ score: { home: 2, away: 1 } }), 3);
  assert.equal(goalsIn({ score: { home: null, away: null } }), null);
});

test('parseChapters reads ytInitialData markers; null without page data', () => {
  const data = { playerOverlays: { decoratedPlayerBarRenderer: { playerBar: { multiMarkersPlayerBarRenderer: { markersMap: [
    { key: 'AUTO_CHAPTERS', value: { chapters: [
      { chapterRenderer: { title: { simpleText: 'Match preview' }, timeRangeStartMillis: 0 } },
      { chapterRenderer: { title: { simpleText: 'Isak breaks the deadlock' }, timeRangeStartMillis: 286400 } },
    ] } },
  ] } } } } };
  const html = `<html><script>var ytInitialData = ${JSON.stringify(data)};</script></html>`;
  assert.deepEqual(parseChapters(html), [{ start: 0, title: 'Match preview' }, { start: 286, title: 'Isak breaks the deadlock' }]);
  assert.deepEqual(parseChapters('<script>var ytInitialData = {"contents":{}};</script>'), []);
  assert.equal(parseChapters('<html>Before you continue to YouTube</html>'), null);
});

test('needsFetch: once when chapters exist, a few retries when not', () => {
  const now = Date.parse('2026-10-01T12:00:00Z');
  assert.equal(needsFetch(undefined, now), true);
  assert.equal(needsFetch({ at: '2026-09-01T00:00:00Z', ch: [[0, 'x']] }, now), false);
  assert.equal(needsFetch({ at: '2026-10-01T10:00:00Z', ch: null, n: 1 }, now), false);
  assert.equal(needsFetch({ at: '2026-10-01T01:00:00Z', ch: null, n: 1 }, now), true);
  assert.equal(needsFetch({ at: '2026-09-01T00:00:00Z', ch: null, n: 4 }, now), false);
});

test('main: writes condensed.json + cache, stops reading pages after repeated failures', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'condense-'));
  await fs.mkdir(path.join(dir, 'PL'));
  const hl = (videoId, durationSec, kind = 'extended') => ({ videoId, durationSec, kind, publishedAt: '2026-09-20T12:00:00Z', title: '', channel: '' });
  await fs.writeFile(path.join(dir, 'PL', 'md-5.json'), JSON.stringify({ matches: [
    { score: { home: 3, away: 0 }, highlights: [hl('short1', 180, 'short'), hl('bha', 824)] },
    { score: { home: 5, away: 3 }, highlights: [hl('mci', 831)] },
  ] }));
  const pages = { bha: BRIGHTON_ARSENAL, mci: CITY_SUNDERLAND };
  const seen = [];
  const fetchPage = async (id) => { seen.push(id); return { ok: true, chapters: chapters(pages[id]) }; };
  const r = await main(dir, { fetchPage, gapMs: 0, log: () => {} });
  assert.deepEqual(seen.sort(), ['bha', 'mci']); // short cuts are never read
  assert.equal(r.condensed, 1);
  const out = JSON.parse(await fs.readFile(path.join(dir, 'condensed.json'), 'utf8'));
  assert.deepEqual(Object.keys(out), ['bha']);

  // Second run: everything cached, nothing fetched.
  seen.length = 0;
  await main(dir, { fetchPage, gapMs: 0, log: () => {} });
  assert.equal(seen.length, 0);

  // Bot wall: stop after 3 failures in a row, keep what's cached.
  await fs.rm(path.join(dir, 'cache'), { recursive: true });
  const many = Array.from({ length: 6 }, (_, i) => hl(`v${i}`, 600));
  await fs.writeFile(path.join(dir, 'PL', 'md-6.json'), JSON.stringify({ matches: [{ score: { home: 1, away: 0 }, highlights: many }] }));
  let calls = 0;
  const r2 = await main(dir, { fetchPage: async () => { calls++; return { ok: false, why: 'bot check' }; }, gapMs: 0, log: () => {} });
  assert.equal(calls, 3);
  assert.equal(r2.stopped, 'bot check');
  await fs.rm(dir, { recursive: true });
});
