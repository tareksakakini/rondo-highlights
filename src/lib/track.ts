// Our own visitor analytics: page views and a few events go to /api/r
// (netlify/functions/collect.mjs), which keeps daily totals; /stats shows them.
// No cookies. Only production builds send anything, and a browser that has opened
// /stats with the key is left out (it sets rondo:notrack), so your own visits don't count.
// To tell new visitors from returning ones, the browser keeps the time of its first visit
// (rondo:first) and a landing view sends the hours since then, never the time itself.
// A link tagged with utm_source (an ad) names its campaign; the browser keeps the last one
// it arrived by (rondo:camp) and every landing view sends it, so the stats page can tell
// whether visitors from a campaign come back. The tags are then taken out of the address.

export type TrackEvent = 'play' | 'video' | 'finish' | 'queue' | 'setting' | 'watch';

/** Watches of this many minutes or more share the last bin (netlify/lib/analytics.mjs WATCH_MAX). */
export const WATCH_MAX = 20;

const enabled = (() => {
  if (!import.meta.env.PROD) return false;
  try { return localStorage.getItem('rondo:notrack') !== '1'; } catch { return true; }
})();

function send(body: object) {
  if (!enabled) return;
  const data = JSON.stringify(body);
  try {
    if (navigator.sendBeacon?.('/api/r', data)) return;
  } catch { /* fall through */ }
  fetch('/api/r', { method: 'POST', body: data, keepalive: true }).catch(() => {});
}

/**
 * Whole hours since this browser's first visit; -1 if it visited before we kept track
 * (it already has our settings saved), undefined if storage is unavailable. Read before
 * the app runs, since the app saves its settings as soon as it starts.
 */
const hoursSinceFirst = (() => {
  if (!enabled) return undefined;
  try {
    const now = Date.now();
    const kept = localStorage.getItem('rondo:first');
    if (kept === null) {
      const before = Object.keys(localStorage).some((k) => k.startsWith('rondo:'));
      localStorage.setItem('rondo:first', before ? '0' : String(now));
      return before ? -1 : 0;
    }
    const first = Number(kept);
    return first > 0 ? Math.max(0, Math.floor((now - first) / 36e5)) : -1;
  } catch { return undefined; }
})();

const UTM = ['utm_source', 'utm_medium', 'utm_campaign', 'utm_content', 'utm_term'];
/** Google Ads' own click ids, there when auto-tagging is on. */
const CLICK_IDS = ['gclid', 'gbraid', 'wbraid'];
const tagPart = (v: string | null) => (v ?? '').toLowerCase().replace(/[^a-z0-9_.-]+/g, '-').slice(0, 30);

/**
 * The campaign this browser last arrived by, as "source/campaign/content"
 * (?utm_source=youtube&utm_campaign=test-1&utm_content=hook-a → "youtube/test-1/hook-a"),
 * or "google-ads" for an ad click with no utm tags. Read after hoursSinceFirst, which
 * takes any rondo: key as a sign of an earlier visit.
 */
const campaign = (() => {
  let url: URL;
  try { url = new URL(location.href); } catch { return undefined; }
  const q = url.searchParams;
  const source = tagPart(q.get('utm_source'));
  const tag = source
    ? [source, tagPart(q.get('utm_campaign')), tagPart(q.get('utm_content'))].join('/').replace(/\/+$/, '')
    : CLICK_IDS.some((k) => q.has(k)) ? 'google-ads' : undefined;
  if ([...UTM, ...CLICK_IDS].some((k) => q.has(k))) {
    // Out of the address, so a shared or bookmarked link doesn't count as the ad again.
    for (const k of [...UTM, ...CLICK_IDS]) q.delete(k);
    try { history.replaceState(history.state, '', url.pathname + url.search + url.hash); } catch { /* keep it */ }
  }
  if (!enabled) return tag;
  try {
    if (tag) localStorage.setItem('rondo:camp', tag);
    return tag ?? localStorage.getItem('rondo:camp') ?? undefined;
  } catch { return tag; }
})();

/** Where the visitor came from, if it was another site. */
function referrer() {
  try {
    const host = new URL(document.referrer).hostname;
    return host && host !== location.hostname ? host : undefined;
  } catch { return undefined; }
}

let lastPath: string | null = null;

/** A page view; the same path again (history entries for the player) isn't a new one. */
export function trackView(path: string) {
  if (path === lastPath) return;
  const landing = lastPath === null;
  lastPath = path;
  send(landing ? { t: 'view', p: path, l: 1, r: referrer(), a: hoursSinceFirst, c: campaign } : { t: 'view', p: path });
}

export function track(name: TrackEvent, props: Record<string, string | undefined> = {}) {
  send({ t: 'event', n: name, p: location.pathname, d: props });
}

/**
 * How long a highlight played (pauses and buffering left out), in whole minutes, sent as
 * `min: "<cut>:<minutes>:<1 if it played to the end, else 0>"`, so the stats page can
 * draw minutes by cut and by finished or not.
 */
export function trackWatch(seconds: number, ended: boolean, tag: { comp?: string; cut?: string }) {
  if (!tag.cut) return;
  const minutes = Math.min(WATCH_MAX, Math.floor(seconds / 60));
  track('watch', { comp: tag.comp, cut: tag.cut, min: `${tag.cut}:${minutes}:${ended ? 1 : 0}` });
}
