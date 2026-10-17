import { test } from 'node:test';
import assert from 'node:assert/strict';
import { nextViews, roundViews } from '../scripts/lib/views.mjs';

test('view counts keep 2 significant figures', () => {
  assert.equal(roundViews(7), 7);
  assert.equal(roundViews(99), 99);
  assert.equal(roundViews(1234), 1200);
  assert.equal(roundViews(15_499), 15_000);
  assert.equal(roundViews(1_260_000), 1_300_000);
  assert.equal(roundViews(NaN), null);
  assert.equal(roundViews(-1), null);
});

test('views.json keeps old counts for videos not re-read and drops videos no longer listed', () => {
  const prev = { a: 1200, b: 300, gone: 5 };
  const next = nextViews(prev, ['c', 'b', 'a', 'a'], new Map([['a', 1300], ['c', 40]]));
  assert.deepEqual(next, { a: 1300, b: 300, c: 40 });
  assert.deepEqual(Object.keys(next), ['a', 'b', 'c']);
  assert.deepEqual(nextViews(null, ['x'], new Map()), {});
});
