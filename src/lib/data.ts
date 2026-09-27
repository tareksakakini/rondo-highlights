import type { DataIndex, RoundFile } from '../types';

const base = `${import.meta.env.BASE_URL}data`;
const cache = new Map<string, Promise<unknown>>();

function getJson<T>(url: string): Promise<T> {
  if (!cache.has(url)) {
    cache.set(
      url,
      fetch(url, { cache: 'no-cache' }).then((r) => {
        if (!r.ok) throw new Error(`${r.status} loading ${url}`);
        return r.json();
      }).catch((e) => { cache.delete(url); throw e; }),
    );
  }
  return cache.get(url) as Promise<T>;
}

export const fetchIndex = () => getJson<DataIndex>(`${base}/index.json`);
export const fetchRound = (code: string, key: string) => getJson<RoundFile>(`${base}/${code}/${key}.json`);
