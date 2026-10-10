// GET /api/stats?days=7: the totals the /stats page shows (netlify/lib/analytics.mjs): each
// day's folded totals plus the hits still waiting for compact.mjs. Read-only.
// Needs `Authorization: Bearer <STATS_KEY>`, the key set in Netlify's environment variables.
// Days follow STATS_TZ (an IANA time zone, e.g. America/Los_Angeles) when it's set, else UTC.

import { createHash, timingSafeEqual } from 'node:crypto';
import { lastDays, summarize } from '../lib/analytics.mjs';
import { analyticsStore, foldHits, pendingKeys, readHits } from '../lib/store.mjs';

const json = (body, status = 200) => Response.json(body, { status, headers: { 'Cache-Control': 'no-store' } });
const digest = (s) => createHash('sha256').update(s).digest();

export default async (req) => {
  const key = process.env.STATS_KEY;
  if (!key) return json({ error: 'STATS_KEY is not set in Netlify environment variables.' }, 503);
  const given = (req.headers.get('authorization') ?? '').replace(/^Bearer\s+/i, '');
  if (!timingSafeEqual(digest(given), digest(key))) return json({ error: 'Wrong key.' }, 401);

  const n = Math.min(Math.max(Number(new URL(req.url).searchParams.get('days')) || 7, 1), 90);
  const tz = process.env.STATS_TZ || null;
  const days = lastDays(n, new Date(), tz);
  const store = analyticsStore();
  const [records, pending] = await Promise.all([
    Promise.all(days.map(async (d) => [d, await store.get(`days/${d}`, { type: 'json' })])).then(Object.fromEntries),
    pendingKeys(store, 5000).then((keys) => readHits(store, keys.filter((k) => days.includes(k.day)))),
  ]);
  foldHits(records, pending.hits);
  return json({ ...summarize(days.map((d) => [d, records[d]])), tz });
};

export const config = { path: '/api/stats' };
