import type { Highlight, Kind, Match, PlayItem } from '../types';

export function fmtDuration(sec: number) {
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  const s = Math.floor(sec % 60);
  return h ? `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}` : `${m}:${String(s).padStart(2, '0')}`;
}

export function fmtTotal(sec: number) {
  const h = Math.floor(sec / 3600);
  const m = Math.round((sec % 3600) / 60);
  return h ? `${h}h ${m}m` : `${m} min`;
}

export function fmtDay(iso: string) {
  return new Date(iso).toLocaleDateString(undefined, { weekday: 'short', day: 'numeric', month: 'short' });
}

export const kindLabel = (k: Kind) => (k === 'short' ? 'Short' : 'Extended');

/**
 * Pick the video to play for a match: the pinned/preferred length first,
 * falling back to the other length. `exclude` holds videos that already failed.
 */
export function pickHighlight(match: Match, want: Kind, exclude: string[] = []): Highlight | null {
  const ok = match.highlights.filter((h) => !exclude.includes(h.videoId));
  return ok.find((h) => h.kind === want) ?? ok[0] ?? null;
}

export const resolveItem = (item: PlayItem, pref: Kind, exclude: string[] = []) =>
  pickHighlight(item.match, item.kind ?? pref, exclude);

export function matchTitle(m: Match) {
  return `${m.home.short} v ${m.away.short}`;
}

/** Hide scorelines like "3-0", "2 Hull City 1", "(1-1)" for spoiler-free mode. */
export function scrubScore(title: string) {
  return title
    .replace(/\b\d{1,2}\s*[-–:]\s*\d{1,2}\b/g, '•–•')
    .replace(/(\p{L})\s+\d{1,2}\s+(\p{L}[\p{L} .'-]*?)\s+\d{1,2}\b/gu, '$1 $2');
}

let n = 0;
export const uid = () => `${Date.now().toString(36)}-${(n++).toString(36)}`;
