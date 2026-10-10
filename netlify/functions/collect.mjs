// POST /api/r: one page view or event from the site (src/lib/track.ts), saved as its own
// entry under hits/<day>/ in the "analytics" blob store (netlify/lib/store.mjs), to be
// folded into the day's totals by compact.mjs.
//
// No cookies and no IP addresses are stored: a visitor is a hash of today's salt, the IP
// and the user agent. The salt is random, kept only for the day it's used, then deleted,
// so a visitor's hash can't be worked back to their IP or matched with another day's.

import { createHash, randomBytes } from 'node:crypto';
import { dayKey, device, isBot, parseHit } from '../lib/analytics.mjs';
import { analyticsStore } from '../lib/store.mjs';

const nothing = (status = 204) => new Response(null, { status });

export default async (req, context) => {
  if (req.method !== 'POST') return nothing(405);
  const ua = req.headers.get('user-agent') ?? '';
  if (isBot(ua)) return nothing();
  let hit = null;
  try {
    const text = await req.text();
    if (text.length <= 2048) hit = parseHit(JSON.parse(text));
  } catch { /* not JSON */ }
  if (!hit) return nothing(400);

  try {
    const store = analyticsStore();
    const now = new Date();
    const day = dayKey(now, process.env.STATS_TZ);
    const salt = await saltFor(store, day);
    const who = {
      id: createHash('sha256').update(`${salt}|${context.ip}|${ua}`).digest('base64url').slice(0, 12),
      country: context.geo?.country?.code ?? null,
      device: device(ua),
    };
    await store.setJSON(`hits/${day}/${now.getTime().toString(36)}-${randomBytes(6).toString('hex')}`, { hit, who });
  } catch (e) {
    // The visitor's page doesn't wait on this; just note it.
    console.warn(`analytics: ${e.message}`);
  }
  return nothing();
};

export const config = { path: '/api/r' };

/** Today's salt: made by the first hit of the day, which also deletes the old ones. */
async function saltFor(store, day) {
  const key = `salt/${day}`;
  const have = await store.get(key);
  if (have) return have;
  const made = await store.set(key, randomBytes(16).toString('hex'), { onlyIfNew: true });
  if (made.modified) {
    const { blobs } = await store.list({ prefix: 'salt/' });
    await Promise.all(blobs.filter((b) => b.key !== key).map((b) => store.delete(b.key)));
  }
  return store.get(key);
}
