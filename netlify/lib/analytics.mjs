// Visitor analytics: what the collector (netlify/functions/collect.mjs) adds to a day's
// totals and what the stats endpoint (netlify/functions/stats.mjs) reads back.
//
// Pure functions only (no Netlify imports), so tests run them directly.
//
// One JSON record per day (UTC, or the STATS_TZ time zone), `days/<YYYY-MM-DD>` in the
// "analytics" blob store:
//   views                     page views
//   v      { id: [views, plays, videos, age?] }   per visitor; `id` is a hash of a daily
//                             salt, the IP and the user agent, so the same person is one
//                             visitor within a day and can't be followed from one day to the
//                             next. `age`: days since the browser's first visit (ageDays), from
//                             its landing view; missing if it sent none
//   pages, entries, refs      page views by path, landings by path, landings by referrer host
//   countries, devices        visitors by country code and by mobile/tablet/desktop
//   events { name: { n, by: { prop: { value: n } } } }
//                             `watch` events (one per highlight played) carry
//                             min: "<cut>:<whole minutes played>:<1 if it ended, else 0>",
//                             which summarize() turns into the watch-length histogram

/** Events the site sends (src/lib/track.ts); anything else is dropped. */
export const EVENTS = ['play', 'video', 'finish', 'queue', 'setting', 'watch'];

/** Watch lengths in whole minutes; WATCH_MAX and over share the last bin (src/lib/track.ts). */
export const WATCH_MAX = 20;
export const CUTS = ['short', 'extended', 'condensed'];
const WATCH = /^(short|extended|condensed):(\d{1,4}):([01])$/;

/** Most distinct keys kept in one day's map; the rest are counted under OTHER. */
const MAX_KEYS = 500;
const OTHER = '(other)';
/** Hits a visitor can add in a day: past this they're dropped (a script, not a person). */
const MAX_HITS = 2000;
/** Ages past this are all stored as MAX_AGE + 1 ("over a month"). */
const MAX_AGE = 30;
/** Day-N retention the stats page shows; the cohort table has a column for each of days 1..7. */
const RETENTION = [1, 7, 30];
const COHORT_DAYS = 7;

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

/**
 * Whole days, by the calendar of `tz`, from a browser's first visit to `now`, given the
 * hours since that visit (sent with its landing view): 0 for a first-day visitor, -1 for
 * one that visited before we started keeping track (`hours` -1), at most MAX_AGE + 1.
 */
export function ageDays(hours, now = new Date(), tz) {
  if (hours < 0) return -1;
  const first = dayKey(new Date(now.getTime() - hours * 36e5), tz);
  const days = Math.round((Date.parse(dayKey(now, tz)) - Date.parse(first)) / 864e5);
  return Math.min(Math.max(days, 0), MAX_AGE + 1);
}

const PATH = /^\/[\w\-./]{0,120}$/;
const HOST = /^[a-z0-9.-]{1,100}$/;
const PROP_KEY = /^[a-z]{1,12}$/;
const PROP_VAL = /^[\w .:-]{1,40}$/;

/**
 * A hit as the site sent it, checked and trimmed, or null if it isn't one.
 *   { t: 'view', p: '/premier-league/', l: 1, r: 'google.com', a: 30 }   (l, r, a: landing only;
 *                                       a: hours since the browser's first visit, -1 if unknown)
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
    if (hit.landing && Number.isInteger(body.a) && body.a >= -1 && body.a <= 1e6) hit.hours = body.a;
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
 * `who`: { id, country, device, age? } for the visitor who sent it (age: ageDays).
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
  if (me[3] === undefined && Number.isInteger(who.age)) me[3] = who.age;
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
 * Day-N retention: of the browsers whose first visit was on day d, how many visited on day
 * d + N. `ages[i]` is the visitors' ages on the i-th day of the run. The last day is today,
 * still counting, so it's left out as a return day.
 */
function retention(days, ages) {
  const last = days.length - 1;
  const count = (i, age) => ages[i].filter((a) => a === age).length;
  const cohorts = days.slice(0, last).map((day, i) => ({
    day,
    size: count(i, 0),
    back: Array.from({ length: COHORT_DAYS }, (_, k) => (i + k + 1 < last ? count(i + k + 1, k + 1) : null)),
  }));
  const rates = Object.fromEntries(RETENTION.map((n) => {
    const from = days.slice(0, Math.max(last - n, 0)).map((_, i) => i);
    return [n, from.length ? { back: from.reduce((t, i) => t + count(i + n, n), 0), of: from.reduce((t, i) => t + count(i, 0), 0) } : null];
  }));
  return { cohorts, rates };
}

/**
 * The watch-length histogram from `watch` events' min values ({ "short:3:1": n, … }):
 * bins[m] is { short: [watches, ended], extended: […], condensed: […] } for watches of m
 * whole minutes (m = WATCH_MAX: that long or longer). Values that don't parse are skipped.
 */
export function watchBins(mins = {}) {
  const bins = Array.from({ length: WATCH_MAX + 1 }, () => Object.fromEntries(CUTS.map((c) => [c, [0, 0]])));
  for (const [key, n] of Object.entries(mins)) {
    const m = WATCH.exec(key);
    if (!m) continue;
    const cell = bins[Math.min(Number(m[2]), WATCH_MAX)][m[1]];
    cell[0] += n;
    if (m[3] === '1') cell[1] += n;
  }
  return bins;
}

/**
 * What the stats page shows for a run of days ending today: `records` is
 * [dayKey, record | null] pairs, oldest first. Visitors can't be matched across days (the
 * salt changes daily), so multi-day visitor totals add up each day's visitors; whether they
 * came back is told by their age (days since their browser's first visit).
 */
export function summarize(records) {
  const daily = [];
  const ages = [];
  const sums = { pages: {}, entries: {}, refs: {}, countries: {}, devices: {} };
  const events = {};
  const totals = { views: 0, visitors: 0, watchers: 0, plays: 0, videos: 0, oneView: 0, fresh: 0, back: 0 };
  for (const [day, rec] of records) {
    const r = rec ?? emptyDay();
    const people = Object.values(r.v);
    const known = people.map((p) => p[3]).filter((a) => a !== undefined);
    ages.push(known);
    const row = {
      day,
      views: r.views,
      visitors: people.length,
      watchers: people.filter((p) => p[2] > 0).length,
      videos: r.events.video?.n ?? 0,
      fresh: known.filter((a) => a === 0).length,
      back: known.filter((a) => a !== 0).length,
    };
    daily.push(row);
    totals.views += row.views;
    totals.visitors += row.visitors;
    totals.watchers += row.watchers;
    totals.videos += row.videos;
    totals.fresh += row.fresh;
    totals.back += row.back;
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
    retention: retention(records.map(([day]) => day), ages),
    watch: { max: WATCH_MAX, bins: watchBins(events.watch?.by.min) },
    events: Object.fromEntries(Object.entries(events).map(([name, ev]) => [name, {
      n: ev.n,
      by: Object.fromEntries(Object.entries(ev.by).map(([prop, vals]) => [prop, top(vals, 30)])),
    }])),
  };
}
