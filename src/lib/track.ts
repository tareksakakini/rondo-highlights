// Our own visitor analytics: page views and a few events go to /api/r
// (netlify/functions/collect.mjs), which keeps daily totals; /stats shows them.
// No cookies. Only production builds send anything, and a browser that has opened
// /stats with the key is left out (it sets rondo:notrack), so your own visits don't count.

export type TrackEvent = 'play' | 'video' | 'finish' | 'queue' | 'setting';

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
  send(landing ? { t: 'view', p: path, l: 1, r: referrer() } : { t: 'view', p: path });
}

export function track(name: TrackEvent, props: Record<string, string | undefined> = {}) {
  send({ t: 'event', n: name, p: location.pathname, d: props });
}
