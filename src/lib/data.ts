import type { DataIndex, RoundFile } from '../types';
import type { CondensedMap } from './moments';
import { isExcludedMatch } from './excluded';

// Where highlight data lives. Set at build time by vite.config.ts:
// - production: the repo's public `data` branch via jsDelivr's CDN, with raw.githubusercontent.com as a fallback
// - local dev:  ./public/data (from `npm run ingest` or `npm run sample`)
// Keeping data out of the site itself means refreshes never need a redeploy.
//
// Remote bases contain `{ref}`. index.json is read from the `data` branch (always
// revalidated). It names the commit (`rev`) holding this dataset, and round files
// and crests are read from that commit: those URLs never change content, so the
// CDN and the browser cache them for good and repeat visits cost no round trips.
const BASES: string[] = __DATA_BASES__.map((b) => (b.startsWith('/') ? `${import.meta.env.BASE_URL}${b.slice(1)}` : b));

// Requests started by scripts/early-data.js (inlined in index.html) before this code arrived.
declare global {
  interface Window {
    __rondoIndex?: Promise<DataIndex>;
    __rondoSavedIndex?: DataIndex;
    __rondoEarly?: Record<string, Promise<unknown>>;
  }
}

let active = 0; // index into BASES that answered last (crest fallbacks are read there)
let rev: string | null = null; // data-branch commit named by index.json
let crestsRev: string | null = null; // where crests are read (see scripts/stamp-rev.mjs)
const cache = new Map<string, Promise<unknown>>();

const baseAt = (i: number, ref: string) => BASES[i].replace('{ref}', ref);
const pinnedRef = () => rev ?? 'data';

/** A request scripts/early-data.js already started for this URL, if any (used once). */
function takeEarly<T>(url: string): Promise<T> | undefined {
  const early = window.__rondoEarly?.[url] as Promise<T> | undefined;
  if (early) delete window.__rondoEarly![url];
  return early;
}

async function get<T>(url: string, pinned: boolean, signal?: AbortSignal): Promise<T> {
  const r = await fetch(url, { cache: pinned ? 'default' : 'no-cache', signal });
  if (!r.ok) throw new Error(`${r.status} loading ${url.split('/').slice(-2).join('/')}`);
  return (await r.json()) as T;
}

/** How long the first base (jsDelivr) gets before the next one is asked too. */
const HEDGE_MS = 200;

/**
 * A data file, as a hedged request (as in scripts/early-data.js): ask jsDelivr; if it
 * hasn't answered within HEDGE_MS or fails, ask raw.githubusercontent too, take the first
 * good answer and cancel the rest. An uncached file took 0.4-11 s on jsDelivr and
 * 0.1-0.35 s on GitHub (2026-10-07); GitHub throttles anonymous downloads, so it backs
 * jsDelivr up rather than replacing it.
 */
function race<T>(path: string, ref: string, pinned: boolean): Promise<T> {
  if (BASES.length === 1) return get<T>(`${baseAt(0, ref)}/${path}`, pinned);
  return new Promise<T>((resolve, reject) => {
    const ctrls: AbortController[] = [];
    let failed = 0;
    let next = 0;
    let done = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const start = () => {
      if (done || next >= BASES.length) return;
      const i = next++;
      ctrls[i] = new AbortController();
      get<T>(`${baseAt(i, ref)}/${path}`, pinned, ctrls[i].signal).then((body) => {
        done = true;
        clearTimeout(timer);
        active = i;
        ctrls.forEach((c, j) => { if (j !== i) c.abort(); });
        resolve(body);
      }, (e: unknown) => {
        if (++failed === BASES.length) reject(e);
        else if (!done) { clearTimeout(timer); start(); }
      });
      timer = setTimeout(start, HEDGE_MS);
    };
    start();
  });
}

/** When an index was published (scripts/stamp-rev.mjs); 0 for one from before the stamp existed. */
const publishedAt = (idx: DataIndex | null | undefined) => Date.parse(idx?.publishedAt ?? '') || 0;
/** The later of two indexes; `b` on a tie. */
const newer = (a: DataIndex | null | undefined, b: DataIndex) => (a && publishedAt(a) > publishedAt(b) ? a : b);

/** How long the other bases get to answer after the first good index.json (as in scripts/early-data.js). */
const INDEX_GRACE_MS = 400;

/**
 * index.json from every base at once, keeping the newest copy that arrives within
 * INDEX_GRACE_MS of the first good answer. It comes from the moving branch, and
 * jsDelivr's copy can lag hours behind (it served a 3-hour-old one through every purge
 * on 2026-10-15), so the first answer isn't necessarily the latest.
 */
function newestIndex(): Promise<DataIndex> {
  if (BASES.length === 1) return get<DataIndex>(`${baseAt(0, 'data')}/index.json`, false);
  return new Promise<DataIndex>((resolve, reject) => {
    const ctrls: (AbortController | null)[] = BASES.map(() => new AbortController());
    let best: { idx: DataIndex; i: number } | null = null;
    let error: unknown;
    let settled = 0;
    let done = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const finish = () => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      ctrls.forEach((c) => c?.abort());
      if (!best) { reject(error); return; }
      active = best.i;
      resolve(best.idx);
    };
    BASES.forEach((_, i) => {
      get<DataIndex>(`${baseAt(i, 'data')}/index.json`, false, ctrls[i]!.signal).then((idx) => {
        if (done) return;
        if (!best) timer = setTimeout(finish, INDEX_GRACE_MS);
        if (!best || newer(idx, best.idx) === idx) best = { idx, i };
      }, (e: unknown) => { error = e; }).finally(() => {
        ctrls[i] = null; // nothing left to cancel
        if (++settled === BASES.length) finish();
      });
    });
  });
}

async function fetchFrom<T>(path: string, ref: string, pinned: boolean): Promise<T> {
  // scripts/early-data.js files its requests (also races) under the first base's URL.
  const early = takeEarly<T>(`${baseAt(0, ref)}/${path}`);
  if (early) {
    try { return await early; } catch { /* fetch it again below */ }
  }
  return race<T>(path, ref, pinned);
}

function memo<T>(key: string, load: () => Promise<T>): Promise<T> {
  if (!cache.has(key)) {
    cache.set(key, load().catch((e) => { cache.delete(key); throw e; }));
  }
  return cache.get(key) as Promise<T>;
}

const sha = (s: unknown) => (typeof s === 'string' && /^[0-9a-f]{40}$/.test(s) ? s : null);
const validRev = (idx: DataIndex) => sha(idx.rev);
function adopt(idx: DataIndex) {
  rev = validRev(idx);
  crestsRev = sha(idx.crestsRev) ?? rev;
}

const SAVED = 'rondo:indexCache';
function save(idx: DataIndex) {
  try { localStorage.setItem(SAVED, JSON.stringify({ t: Date.now(), idx })); } catch { /* full or unavailable */ }
}

/**
 * The index from the network (memoized); round files are read at the commit it names from
 * then on. An index older than `saved` (a CDN still serving an old copy) is ignored, so
 * highlights already seen never disappear again.
 */
const fetchFreshIndex = (saved: DataIndex | null) =>
  memo('index.json', async () => {
    // Started by an inline script in index.html while the page was still loading.
    const early = window.__rondoIndex;
    window.__rondoIndex = undefined;
    let idx: DataIndex | null = null;
    if (early) {
      try { idx = await early; } catch { /* fall back to the normal path */ }
    }
    idx ??= await newestIndex();
    idx = newer(saved, idx);
    adopt(idx);
    if (idx !== saved) save(idx);
    return idx;
  });

export interface IndexLoad {
  /** What to show now: the index saved on the last visit when it is recent, else the network's. */
  first: Promise<DataIndex>;
  /** True when `first` is the saved copy. */
  saved: boolean;
  /** The network's index, or the saved one if that is newer (the same object as `first` when nothing was saved). */
  fresh: Promise<DataIndex>;
}

/**
 * Load the data index. On a repeat visit the copy saved last time (if under 12 hours
 * old, see vite.config.ts) is shown at once: its round files are already in the
 * browser's cache. The caller swaps in `fresh` when it arrives and differs (it is the
 * saved copy itself when the network only had older ones).
 */
export function loadIndex(): IndexLoad {
  let saved = window.__rondoSavedIndex ?? null;
  window.__rondoSavedIndex = undefined;
  if (saved && !(Array.isArray(saved.competitions) && validRev(saved))) saved = null;
  const fresh = fetchFreshIndex(saved);
  if (saved) {
    if (!rev) adopt(saved);
    return { first: Promise.resolve(saved), saved: true, fresh };
  }
  return { first: fresh, saved: false, fresh };
}

export const fetchRound = (code: string, key: string) => {
  const ref = pinnedRef();
  return memo(`${ref}/${code}/${key}.json`, async () => {
    const file = await fetchFrom<RoundFile>(`${code}/${key}.json`, ref, rev != null);
    return { ...file, matches: file.matches.filter((m) => !isExcludedMatch(m)) };
  });
};

/** Key moments of extended cuts, by videoId (experimental "condensed" cuts; see scripts/condense.mjs). */
export const fetchCondensed = () => {
  const ref = pinnedRef();
  return memo(`${ref}/condensed.json`, () => fetchFrom<CondensedMap>('condensed.json', ref, rev != null));
};

/**
 * YouTube view counts by videoId (scripts/views.mjs). Read from the moving branch, like
 * index.json: they change more often than the data commit the round files are read at.
 */
export const fetchViews = () => memo('views.json', () => fetchFrom<Record<string, number>>('views.json', 'data', false));

/**
 * Where a crest loads from. Production builds copy the rounds' crests into the site
 * itself (scripts/lib/site-crests.mjs): same host and connection as the page, cached
 * for good. A crest added to the data after the last build isn't there yet, so the
 * jsDelivr copy is the fallback (TeamBadge switches on a load error).
 */
export function crestSrc(path: string): { src: string; fallback?: string } {
  const remote = dataAsset(path);
  if (!/^crests\//.test(path) || !/^https?:\/\//.test(BASES[0])) return { src: remote };
  return { src: `${import.meta.env.BASE_URL}${path}`, fallback: remote };
}

/** URL for a file stored alongside the data (e.g. `crests/1a2b….webp`); absolute URLs pass through. */
export function dataAsset(path: string): string {
  if (/^(https?:)?\/\//.test(path)) return path;
  return `${baseAt(active, path.startsWith('crests/') ? crestsRev ?? pinnedRef() : pinnedRef())}/${path}`;
}
