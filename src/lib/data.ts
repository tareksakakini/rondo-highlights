import type { DataIndex, RoundFile } from '../types';

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

declare global {
  interface Window { __rondoIndex?: Promise<DataIndex> }
}

let active = 0; // index into BASES that last worked
let rev: string | null = null; // data-branch commit named by index.json
const cache = new Map<string, Promise<unknown>>();

const baseAt = (i: number, ref: string) => BASES[i].replace('{ref}', ref);
const pinnedRef = () => rev ?? 'data';

async function fetchFrom<T>(path: string, ref: string, pinned: boolean): Promise<T> {
  let lastError: unknown;
  for (let i = active; i < BASES.length; i++) {
    try {
      const r = await fetch(`${baseAt(i, ref)}/${path}`, { cache: pinned ? 'default' : 'no-cache' });
      if (!r.ok) throw new Error(`${r.status} loading ${path}`);
      const json = (await r.json()) as T;
      active = i;
      return json;
    } catch (e) {
      lastError = e;
    }
  }
  throw lastError;
}

function memo<T>(key: string, load: () => Promise<T>): Promise<T> {
  if (!cache.has(key)) {
    cache.set(key, load().catch((e) => { cache.delete(key); throw e; }));
  }
  return cache.get(key) as Promise<T>;
}

function adoptIndex(idx: DataIndex): DataIndex {
  rev = typeof idx.rev === 'string' && /^[0-9a-f]{40}$/.test(idx.rev) ? idx.rev : null;
  return idx;
}

export const fetchIndex = () =>
  memo('index.json', async () => {
    // Started by an inline script in index.html while the page was still loading.
    const early = window.__rondoIndex;
    window.__rondoIndex = undefined;
    if (early) {
      try { return adoptIndex(await early); } catch { /* fall back to the normal path */ }
    }
    return adoptIndex(await fetchFrom<DataIndex>('index.json', 'data', false));
  });

export const fetchRound = (code: string, key: string) => {
  const ref = pinnedRef();
  return memo(`${ref}/${code}/${key}.json`, () => fetchFrom<RoundFile>(`${code}/${key}.json`, ref, rev != null));
};

/** URL for a file stored alongside the data (e.g. `crests/1a2b….webp`); absolute URLs pass through. */
export function dataAsset(path: string): string {
  return /^(https?:)?\/\//.test(path) ? path : `${baseAt(active, pinnedRef())}/${path}`;
}
