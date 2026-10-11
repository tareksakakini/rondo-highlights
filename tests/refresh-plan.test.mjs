import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  planRefresh, matchesFrom, HOT_FROM_MIN, HOT_EVERY_MIN, IDLE_EVERY_H, FULL_EVERY_H, FULL_RETRY_H, LATE_EVERY_MIN, LATER_EVERY_H,
} from '../scripts/lib/refresh-plan.mjs';

const MIN = 60e3;
const HOUR = 3600e3;
const NOW = Date.parse('2026-10-10T18:40:00Z');
const at = (ms) => new Date(ms).toISOString();
const match = (comp, label, koAgo, extra = {}) => ({ comp, label, utcDate: at(NOW - koAgo), status: 'FINISHED', covered: false, ...extra });
const recentFull = NOW - HOUR;

test('a full run is due when there has never been one, and once a day after that', () => {
  assert.equal(planRefresh({ now: NOW, matches: [], lastRun: NOW - 5 * MIN, lastFull: null }).mode, 'full');
  const p = planRefresh({ now: NOW, matches: [], lastRun: NOW - 5 * MIN, lastFull: NOW - FULL_EVERY_H * HOUR });
  assert.deepEqual([p.due, p.mode, p.only], [true, 'full', null]);
  assert.equal(planRefresh({ now: NOW, matches: [], lastRun: NOW - 5 * MIN, lastFull: recentFull }).due, false);
});

test('a failed full run is retried after FULL_RETRY_H, not on every tick', () => {
  const failed = (ago) => planRefresh({ now: NOW, matches: [], lastRun: NOW - ago, lastFull: NOW - 30 * HOUR, lastFullFailed: NOW - ago });
  assert.equal(failed(20 * MIN).due, false);
  assert.equal(failed(20 * MIN).nextAt, NOW - 20 * MIN + FULL_RETRY_H * HOUR);
  assert.equal(failed(FULL_RETRY_H * HOUR).mode, 'full');
  assert.equal(planRefresh({ now: NOW, matches: [], lastRun: NOW - 20 * MIN, lastFull: null, lastFullFailed: NOW - 20 * MIN }).due, false);
});

test('matches that just finished: a quick run of their competitions every HOT_EVERY_MIN', () => {
  const matches = [
    match('PL', 'Man United v Tottenham', 130 * MIN),
    match('PD', 'Barça v Getafe', 125 * MIN, { covered: true }), // still hot: more cuts come
    match('SA', 'Napoli v Frosinone', 60 * MIN, { status: 'IN_PLAY' }), // not over yet
  ];
  const soon = planRefresh({ now: NOW, matches, lastRun: NOW - 4 * MIN, lastFull: recentFull });
  assert.equal(soon.due, false);
  assert.equal(soon.nextAt, NOW - 4 * MIN + HOT_EVERY_MIN * MIN);
  const p = planRefresh({ now: NOW, matches, lastRun: NOW - HOT_EVERY_MIN * MIN, lastFull: recentFull });
  assert.deepEqual([p.due, p.mode, p.only], [true, 'quick', ['PL', 'PD']]);
  assert.equal(p.reason, 'just finished: Man United v Tottenham, Barça v Getafe');
});

test('a match turns hot HOT_FROM_MIN after kick-off, and the plan wakes up for it', () => {
  const kickoff = NOW + 30 * MIN;
  const p = planRefresh({ now: NOW, matches: [match('FL1', 'Brest v Angers', -30 * MIN, { status: 'TIMED' })], lastRun: NOW - HOUR, lastFull: recentFull });
  assert.equal(p.due, false);
  assert.equal(p.nextAt, kickoff + HOT_FROM_MIN * MIN);
});

test('finished matches still without highlights: hourly at first, then every few hours, then never', () => {
  const plan = (koAgo, lastRunAgo, extra) => planRefresh({ now: NOW, matches: [match('BL1', 'Mainz v Leverkusen', koAgo, extra)], lastRun: NOW - lastRunAgo, lastFull: recentFull });
  assert.equal(plan(5 * HOUR, 30 * MIN).due, false);
  const p = plan(5 * HOUR, LATE_EVERY_MIN * MIN);
  assert.deepEqual([p.due, p.only, p.reason], [true, ['BL1'], 'still no highlights: Mainz v Leverkusen']);
  assert.equal(plan(20 * HOUR, 2 * HOUR).due, false, 'past LATE_SOON_H: every LATER_EVERY_H');
  assert.equal(plan(20 * HOUR, LATER_EVERY_H * HOUR).due, true);
  assert.equal(plan(60 * HOUR, 5 * HOUR).due, false, 'given up after LATE_UNTIL_H');
  assert.equal(plan(5 * HOUR, 2 * HOUR, { covered: true }).due, false, 'covered matches need nothing');
  assert.equal(plan(5 * HOUR, 2 * HOUR, { status: 'POSTPONED' }).due, false, 'postponed matches are skipped');
});

test('otherwise a quick run of everything every IDLE_EVERY_H', () => {
  const p = planRefresh({ now: NOW, matches: [], lastRun: NOW - IDLE_EVERY_H * HOUR, lastFull: recentFull });
  assert.deepEqual([p.due, p.mode, p.only, p.reason], [true, 'quick', null, 'routine check']);
  const q = planRefresh({ now: NOW, matches: [], lastRun: NOW - HOUR, lastFull: recentFull });
  assert.equal(q.nextAt, NOW - HOUR + IDLE_EVERY_H * HOUR);
});

test('matchesFrom reads the current round and recent ones of live competitions', async () => {
  const index = { competitions: [
    { code: 'PL', source: 'live', currentRound: 'md-6', rounds: [
      { key: 'md-1', firstDate: '2026-08-21T19:00:00Z' },
      { key: 'md-5', firstDate: '2026-10-04T14:00:00Z' },
      { key: 'md-6', firstDate: '2026-10-10T11:30:00Z' },
      { key: 'md-7', firstDate: '2026-10-17T11:30:00Z' },
    ] },
    { code: 'XX', source: 'sample', currentRound: 'md-1', rounds: [{ key: 'md-1', firstDate: '2026-10-10T11:30:00Z' }] },
  ] };
  const read = [];
  const out = await matchesFrom(index, async (code, key) => {
    read.push(`${code}/${key}`);
    return { matches: [{ utcDate: '2026-10-10T16:30:00Z', status: 'FINISHED', home: { short: 'Man United' }, away: { short: 'Tottenham' }, highlights: [{}] }] };
  }, NOW);
  assert.deepEqual(read, ['PL/md-5', 'PL/md-6']);
  assert.deepEqual(out[0], { comp: 'PL', label: 'Man United v Tottenham', utcDate: '2026-10-10T16:30:00Z', status: 'FINISHED', covered: true });
});
