// Which matches this browser has watched, and how far: kept in localStorage
// (rondo:watched) so the cards can show it, also on later visits. Never sent anywhere.
//
// The player reports progress every couple of seconds while a video plays, when it
// pauses, and when it stops (moved on, closed, ended, page left), so a reload or a closed
// tab loses at most a couple of seconds. Each report is saved straight away (not in a
// React effect, which never runs while the page is unloading).

export interface Watched {
  /** furthest share of the cut reached, 0–1 */
  f: number;
  /** played to the end at least once */
  e?: 1;
  /** last watched (ms since epoch) */
  t: number;
}
export type WatchedMap = Record<string, Watched>;

const KEY = 'rondo:watched';
/** At most this many matches are remembered; the ones watched longest ago go first. */
const MAX = 800;

/** Shown as watched (not just started): ended, or played this far. */
export const isDone = (w: Watched | undefined) => !!w && (w.e === 1 || w.f >= 0.9);

/** What the player reports: seconds played so far, where the video is, how long it is, whether it ended. */
export interface Progress { played: number; pos: number; dur: number; ended: boolean }

/**
 * How far into the cut `p` is. A full video: its position in the video, as on YouTube's own
 * bar (seeking ahead counts, watching a bit twice doesn't). An auto-condensed cut jumps
 * between moments, so there it's the time played over the cut's length `len`.
 */
export function shareOf(p: Progress, len: number, condensed: boolean): number {
  if (p.ended) return 1;
  const s = !condensed && p.dur > 0 ? p.pos / p.dur : len > 0 ? p.played / len : 0;
  return Math.min(1, Math.max(0, s));
}

/**
 * `map` with match `id` at `share` (kept if it's further than before), as a new object; the
 * same `map` when nothing visible changed (under 1%), so callers can skip re-rendering.
 */
export function addProgress(map: WatchedMap, id: string, share: number, ended: boolean, now = Date.now()): WatchedMap {
  const was = map[id];
  const f = Math.round(Math.max(was?.f ?? 0, share) * 100) / 100;
  const e = ended || was?.e === 1;
  if (was && f - was.f < 0.01 && e === (was.e === 1)) return map;
  if (!was && f < 0.01 && !e) return map;
  const next: WatchedMap = { ...map, [id]: { f, t: now, ...(e ? { e: 1 as const } : {}) } };
  const keys = Object.keys(next);
  if (keys.length > MAX) {
    keys.sort((a, b) => next[a].t - next[b].t).slice(0, keys.length - MAX).forEach((k) => delete next[k]);
  }
  return next;
}

/** Save at once (also while the page is unloading). */
export function saveWatched(map: WatchedMap) {
  try { localStorage.setItem(KEY, JSON.stringify(map)); } catch { /* full or unavailable */ }
}
