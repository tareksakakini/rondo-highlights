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

/** Can this video play in `region`? (YouTube country restrictions recorded at ingest.) */
export function availableIn(h: Highlight, region: string | null) {
  if (!region) return true;
  if (h.allow) return h.allow.includes(region);
  if (h.block) return !h.block.includes(region);
  return true;
}

/**
 * Pick the video to play for a match: the pinned/preferred length first,
 * falling back to the other length, among cuts that play in the viewer's country.
 * `exclude` holds videos that already failed. Unknown region: prefer unrestricted cuts.
 * `avoid` holds channels whose embeds refused to play for this viewer: their cuts are used
 * only when nothing else is left (FIFA's World Cup uploads play on youtube.com in the US
 * but refuse embeds there, and the Data API doesn't say so).
 */
export function pickHighlight(
  match: Match, want: Kind, exclude: string[] = [], region: string | null = null, avoid: string[] = [],
): Highlight | null {
  const ok = match.highlights.filter((h) => !exclude.includes(h.videoId) && availableIn(h, region));
  const ranked = region ? ok : [...ok.filter((h) => !h.allow && !h.block), ...ok.filter((h) => h.allow || h.block)];
  const trusted = ranked.filter((h) => !h.channelId || !avoid.includes(h.channelId));
  const pool = trusted.length ? trusted : ranked;
  return pool.find((h) => h.kind === want) ?? pool[0] ?? null;
}

export const resolveItem = (item: PlayItem, pref: Kind, exclude: string[] = [], region: string | null = null, avoid: string[] = []) =>
  pickHighlight(item.match, item.kind ?? pref, exclude, region, avoid);

/** Does the match have any cut that plays in `region`? */
export const playableIn = (m: Match, region: string | null) => m.highlights.some((h) => availableIn(h, region));

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
