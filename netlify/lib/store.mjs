// The "analytics" blob store, shared by the functions in netlify/functions.
//
//   hits/<day>/<time>-<random>   one hit as the collector got it: { hit, who }. Each hit is
//                                its own entry, so hits arriving together never overwrite
//                                each other.
//   days/<day>                   the day's totals (netlify/lib/analytics.mjs). Only compact()
//                                writes these: it folds the hits in and deletes them, hourly
//                                (netlify/functions/compact.mjs).
//   salt/<day>                   today's salt for visitor hashes (collect.mjs)

import { getStore } from '@netlify/blobs';
import { addHit, emptyDay } from './analytics.mjs';

export const analyticsStore = () => getStore({ name: 'analytics', consistency: 'strong' });

/** Run `fn` over `items`, `size` at a time. */
async function inBatches(items, size, fn) {
  const out = [];
  for (let i = 0; i < items.length; i += size) out.push(...(await Promise.all(items.slice(i, i + size).map(fn))));
  return out;
}

/** Keys of hits not folded into their day yet (up to `limit`), with their day. */
export async function pendingKeys(store, limit = Infinity) {
  const keys = [];
  for await (const page of store.list({ prefix: 'hits/', paginate: true })) {
    for (const b of page.blobs) {
      const day = b.key.split('/')[1];
      if (/^\d{4}-\d{2}-\d{2}$/.test(day)) keys.push({ key: b.key, day });
      if (keys.length >= limit) return keys;
    }
  }
  return keys;
}

/**
 * The hits behind `keys`: { hits: [{ key, day, hit, who }], failed: Set of keys that
 * couldn't be read this time }. Entries that are gone or malformed are in neither.
 */
export async function readHits(store, keys) {
  const failed = new Set();
  const got = await inBatches(keys, 25, async ({ key, day }) => {
    try {
      const v = await store.get(key, { type: 'json' });
      return v?.hit && v?.who ? { key, day, hit: v.hit, who: v.who } : null;
    } catch {
      failed.add(key);
      return null;
    }
  });
  return { hits: got.filter(Boolean), failed };
}

/** Fold `hits` into `records` ({ day: record | null }), in place; days not in `records` are skipped. */
export function foldHits(records, hits) {
  for (const h of hits) {
    if (!(h.day in records)) continue;
    records[h.day] ??= emptyDay();
    addHit(records[h.day], h.hit, h.who);
  }
  return records;
}

/**
 * Fold waiting hits into their days' totals, then delete them. One run handles up to
 * `limit` hits; any beyond that wait for the next run. Only this writes `days/…`, and runs
 * don't overlap (hourly, each well under a minute), so totals are never written twice at once.
 */
export async function compact(store, limit = 3000) {
  const keys = await pendingKeys(store, limit);
  if (!keys.length) return { folded: 0, days: [] };
  const { hits, failed } = await readHits(store, keys);
  const days = [...new Set(hits.map((h) => h.day))];
  const records = Object.fromEntries(await Promise.all(days.map(async (d) => [d, await store.get(`days/${d}`, { type: 'json' })])));
  foldHits(records, hits);
  // Totals first, then delete: a run that stops in between counts those hits again next
  // time, rather than losing them.
  await Promise.all(days.map((d) => store.setJSON(`days/${d}`, records[d] ?? emptyDay())));
  await inBatches(keys.filter(({ key }) => !failed.has(key)), 25, ({ key }) => store.delete(key).catch(() => {}));
  return { folded: hits.length, days };
}
