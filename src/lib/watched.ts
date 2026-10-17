// Which matches this browser has watched, and how far: kept in localStorage
// (rondo:watched) so the cards can show it on later visits. Never sent anywhere.

export interface Watched {
  /** furthest share of the cut played, 0–1 */
  f: number;
  /** played to the end at least once */
  e?: 1;
  /** last watched (ms since epoch) */
  t: number;
}
export type WatchedMap = Record<string, Watched>;

/** At most this many matches are remembered; the ones watched longest ago go first. */
const MAX = 800;

/** Shown as watched (not just started): ended, or played this far. */
export const isDone = (w: Watched | undefined) => !!w && (w.e === 1 || w.f >= 0.9);

/** `map` with a watch of `seconds` of a `len`-second cut added for match `id` (a new object). */
export function addWatch(map: WatchedMap, id: string, seconds: number, len: number, ended: boolean, now = Date.now()): WatchedMap {
  const was = map[id];
  const f = Math.min(1, Math.max(was?.f ?? 0, ended ? 1 : len > 0 ? seconds / len : 0));
  const next: WatchedMap = { ...map, [id]: { f: Math.round(f * 100) / 100, t: now, ...(ended || was?.e ? { e: 1 as const } : {}) } };
  const keys = Object.keys(next);
  if (keys.length > MAX) {
    keys.sort((a, b) => next[a].t - next[b].t).slice(0, keys.length - MAX).forEach((k) => delete next[k]);
  }
  return next;
}
