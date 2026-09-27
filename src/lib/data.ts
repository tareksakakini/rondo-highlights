import type { DataIndex, RoundFile } from '../types';

// Where highlight data lives. Set at build time by vite.config.ts:
// - production: the repo's public `data` branch via jsDelivr's CDN, with raw.githubusercontent.com as a fallback
// - local dev:  ./public/data (from `npm run ingest` or `npm run sample`)
// Keeping data out of the site itself means refreshes never need a redeploy.
const BASES: string[] = __DATA_BASES__.map((b) => (b.startsWith('/') ? `${import.meta.env.BASE_URL}${b.slice(1)}` : b));

let active = 0; // index into BASES that last worked
const cache = new Map<string, Promise<unknown>>();

async function fetchFrom<T>(path: string): Promise<T> {
  let lastError: unknown;
  for (let i = active; i < BASES.length; i++) {
    try {
      const r = await fetch(`${BASES[i]}/${path}`, { cache: 'no-cache' });
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

function getJson<T>(path: string): Promise<T> {
  if (!cache.has(path)) {
    cache.set(path, fetchFrom<T>(path).catch((e) => { cache.delete(path); throw e; }));
  }
  return cache.get(path) as Promise<T>;
}

export const fetchIndex = () => getJson<DataIndex>('index.json');
export const fetchRound = (code: string, key: string) => getJson<RoundFile>(`${code}/${key}.json`);
