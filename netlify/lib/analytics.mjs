// Visitor analytics: what the collector (netlify/functions/collect.mjs) adds to a day's
// totals and what the stats endpoint (netlify/functions/stats.mjs) reads back.
//
// Pure functions only (no Netlify imports), so tests run them directly.
//
// One JSON record per day (UTC, or the STATS_TZ time zone), `days/<YYYY-MM-DD>` in the
// "analytics" blob store:
//   views                     page views
//   v      { id: [views, plays, videos] }   per visitor; `id` is a hash of a daily salt,
//                             the IP and the user agent, so the same person is one visitor
//                             within a day and can't be followed from one day to the next
//   pages, entries, refs      page views by path, landings by path, landings by referrer host
//   countries, devices        visitors by country code and by mobile/tablet/desktop
//   events { name: { n, by: { prop: { value: n } } } }

/** Events the site sends (src/lib/track.ts); anything else is dropped. */
export const EVENTS = ['play', 'video', 'finish', 'queue', 'setting'];

/** Most distinct keys kept in one day's map; the rest are counted under OTHER. */
const MAX_KEYS = 500;
const OTHER = '(other)';
/** Hits a visitor can add in a day: past this they're dropped (a script, not a person). */
const MAX_HITS = 2000;

const BOT = /bot|crawl|spider|slurp|scrap|headless|lighthouse|pagespeed|preview|monitor|python|curl|wget|httpclient|okhttp|java\/|go-http|axios|node-fetch|undici|phantom|puppeteer|playwright|selenium/i;

/** Crawlers and scripts; real browsers that run our JS rarely say any of this. */
export const isBot = (ua) => !ua || BOT.test(ua);

export function device(ua = '') {
  if (/iPad|Tablet|Android(?!.*Mobile)/i.test(ua)) return 'tablet';
  if (/Mobi|iPhone|iPod|Android/i.test(ua)) return 'mobile';
  return 'desktop';
}

/**
 * The calendar day (YYYY-MM-DD) of `d` in time zone `tz` (STATS_TZ, an IANA name like
 * America/Los_Angeles), or UTC when it's unset or unknown.
 */
export function dayKey(d = new Date(), tz) {
  if (tz) {
    try {
      return new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit' }).format(d);
    } catch { /* unknown zone: UTC */ }
  }
  return d.toISOString().slice(0, 10);
}

const PATH = /^\/[\w\-./]{0,120}$/;
const HOST = /^[a-z0-9.-]{1,100}$/;
const PROP_KEY = /^[a-z]{1,12}$/;
const PROP_VAL = /^[\w .:-]{1,40}$/;

/**
 * A hit as the site sent it, checked and trimmed, or null if it isn't one.
 *   { t: 'view', p: '/premier-league/', l: 1, r: 'google.com' }   (l, r: landing only)
 *   { t: 'event', n: 'play', p: '/', d: { from: 'all', comp: 'PL' } }
 */
export function parseHit(body) {
  if (!body || typeof body !== 'object') return null;
  const path = typeof body.p === 'string' && PATH.test(body.p) ? body.p : OTHER;
  if (body.t === 'view') {
    const hit = { type: 'view', path, landing: body.l === 1 };
    if (hit.landing && typeof body.r === 'string') {
      const host = body.r.toLowerCase().replace(/^www\./, '');
      if (HOST.test(host)) hit.ref = host;
    }
    return hit;
  }
  if (body.t === 'event' && EVENTS.includes(body.n)) {
    const props = {};
    if (body.d && typeof body.d === 'object') {
      for (const [k, v] of Object.entries(body.d).slice(0, 4)) {
        if (PROP_KEY.test(k) && typeof v === 'string' && PROP_VAL.test(v)) props[k] = v;
      }
    }
    return { type: 'event', name: body.n, path, props };
  }
  return null;
}

export const emptyDay = () => ({ views: 0, v: {}, pages: {}, entries: {}, refs: {}, countries: {}, devices: {}, events: {} });

function bump(map, key, by = 1) {
  if (!(key in map) && Object.keys(map).length >= MAX_KEYS) key = OTHER;
  map[key] = (map[key] ?? 0) + by;
}

/**
 * Add one hit to a day's record (changed in place and returned).
 * `who`: { id, country, device } for the visitor who sent it.
 */
export function addHit(day, hit, who) {
  let me = day.v[who.id];
  if (!me) {
    if (Object.keys(day.v).length >= 100 * MAX_KEYS) return day;
    me = day.v[who.id] = [0, 0, 0];
    bump(day.countries, who.country || '??');
    bump(day.devices, who.device);
  }
  if (me[0] + me[1] + me[2] >= MAX_HITS) return day;
  if (hit.type === 'view') {
    me[0]++;
    day.views++;
    bump(day.pages, hit.path);
    if (hit.landing) {
      bump(day.entries, hit.path);
      if (hit.ref) bump(day.refs, hit.ref);
    }
    return day;
  }
  if (hit.name === 'play') me[1]++;
  if (hit.name === 'video') me[2]++;
  const ev = (day.events[hit.name] ??= { n: 0, by: {} });
  ev.n++;
  for (const [k, val] of Object.entries(hit.props)) bump((ev.by[k] ??= {}), val);
  return day;
}

/** The last `n` days up to and including the one `to` falls on in `tz`, oldest first. */
export function lastDays(n, to = new Date(), tz) {
  // Step back through calendar dates, not 24-hour periods, so a DST change can't skip a day.
  const last = Date.parse(`${dayKey(to, tz)}T00:00:00Z`);
  const out = [];
  for (let i = n - 1; i >= 0; i--) out.push(new Date(last - i * 864e5).toISOString().slice(0, 10));
  return out;
}

const merge = (into, map) => { for (const [k, n] of Object.entries(map ?? {})) into[k] = (into[k] ?? 0) + n; };
const top = (map, n = 25) => Object.entries(map).sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).slice(0, n);

/**
 * What the stats page shows for a run of days: `records` is [dayKey, record | null] pairs,
 * oldest first. Visitors can't be matched across days (the salt changes daily), so
 * multi-day visitor totals add up each day's visitors.
 */
export function summarize(records) {
  const daily = [];
  const sums = { pages: {}, entries: {}, refs: {}, countries: {}, devices: {} };
  const events = {};
  const totals = { views: 0, visitors: 0, watchers: 0, plays: 0, videos: 0, oneView: 0 };
  for (const [day, rec] of records) {
    const r = rec ?? emptyDay();
    const people = Object.values(r.v);
    const row = {
      day,
      views: r.views,
      visitors: people.length,
      watchers: people.filter((p) => p[2] > 0).length,
      videos: r.events.video?.n ?? 0,
    };
    daily.push(row);
    totals.views += row.views;
    totals.visitors += row.visitors;
    totals.watchers += row.watchers;
    totals.videos += row.videos;
    totals.plays += r.events.play?.n ?? 0;
    totals.oneView += people.filter((p) => p[0] <= 1 && p[1] === 0 && p[2] === 0).length;
    for (const k of Object.keys(sums)) merge(sums[k], r[k]);
    for (const [name, ev] of Object.entries(r.events)) {
      const into = (events[name] ??= { n: 0, by: {} });
      into.n += ev.n;
      for (const [prop, vals] of Object.entries(ev.by)) merge((into.by[prop] ??= {}), vals);
    }
  }
  return {
    from: records[0]?.[0] ?? null,
    to: records.at(-1)?.[0] ?? null,
    totals,
    daily,
    pages: top(sums.pages, 30),
    entries: top(sums.entries),
    refs: top(sums.refs),
    countries: top(sums.countries, 30),
    devices: top(sums.devices),
    events: Object.fromEntries(Object.entries(events).map(([name, ev]) => [name, {
      n: ev.n,
      by: Object.fromEntries(Object.entries(ev.by).map(([prop, vals]) => [prop, top(vals, 30)])),
    }])),
  };
}
