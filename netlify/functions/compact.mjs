// Hourly: fold the hits the collector saved into each day's totals (netlify/lib/store.mjs).
// Scheduled functions only run on the published site; /api/stats adds in hits that
// haven't been folded yet, so the stats page is current between runs.

import { analyticsStore, compact } from '../lib/store.mjs';

export default async () => {
  const { folded, days } = await compact(analyticsStore());
  if (folded) console.log(`analytics: folded ${folded} hits into ${days.join(', ')}`);
};

export const config = { schedule: '@hourly' };
