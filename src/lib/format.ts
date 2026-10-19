import type { Highlight, Kind, Match, PlayItem } from '../types';
import type { CondensedEntry, CondensedMap } from './moments';

/** A view count, short: "850", "12K", "1.2M". */
export function fmtCount(n: number) {
  const short = (v: number, unit: string) => `${v >= 10 ? Math.round(v) : Math.round(v * 10) / 10}${unit}`;
  return n >= 1e9 ? short(n / 1e9, 'B') : n >= 1e6 ? short(n / 1e6, 'M') : n >= 1e3 ? short(n / 1e3, 'K') : String(n);
}

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

/** A round's dates, short: "Sep 18 – 20", "Sep 29 – Oct 1", or one day: "Sun, Jul 19". */
export function fmtRange(fromIso: string, toIso: string) {
  const a = new Date(fromIso);
  const b = new Date(toIso);
  if (a.toDateString() === b.toDateString()) return fmtDay(fromIso);
  const f = new Intl.DateTimeFormat(undefined, { day: 'numeric', month: 'short' });
  try {
    return f.formatRange(a, b);
  } catch {
    return `${f.format(a)} – ${f.format(b)}`;
  }
}

export const kindLabel =(k: Kind) => (k === 'short' ? 'Short' : 'Extended');

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
  const pool = poolFor(match, exclude, region, avoid);
  return pool.find((h) => h.kind === want) ?? pool[0] ?? null;
}

function poolFor(match: Match, exclude: string[], region: string | null, avoid: string[]) {
  const ok = match.highlights.filter((h) => !exclude.includes(h.videoId) && availableIn(h, region));
  const ranked = region ? ok : [...ok.filter((h) => !h.allow && !h.block), ...ok.filter((h) => h.allow || h.block)];
  const trusted = ranked.filter((h) => !h.channelId || !avoid.includes(h.channelId));
  return trusted.length ? trusted : ranked;
}

/** What plays for a match: a video, and its key moments when it plays auto-condensed. */
export interface Cut {
  h: Highlight;
  condensed: CondensedEntry | null;
}
export type CutKind = Kind | 'condensed';

export const cutKind = (c: Cut): CutKind => (c.condensed ? 'condensed' : c.h.kind);
export const cutSec = (c: Cut) => c.condensed?.s ?? c.h.durationSec;
export const cutLabel = (k: CutKind) => (k === 'condensed' ? 'Auto-condensed' : kindLabel(k));

/**
 * Like pickHighlight, plus auto-condensing: when "short" is wanted and no short cut
 * plays here, the extended cut's key moments stand in for it (`condensed` = the
 * moments by videoId, or null when the visitor switched Auto-condense off).
 */
export function pickCut(
  match: Match, want: Kind, condensed: CondensedMap | null, exclude: string[] = [], region: string | null = null, avoid: string[] = [],
): Cut | null {
  const pool = poolFor(match, exclude, region, avoid);
  if (want === 'short' && condensed && !pool.some((h) => h.kind === 'short')) {
    const ext = pool.find((h) => h.kind === 'extended' && condensed[h.videoId]);
    if (ext) return { h: ext, condensed: condensed[ext.videoId] };
  }
  const h = pool.find((x) => x.kind === want) ?? pool[0];
  return h ? { h, condensed: null } : null;
}

export const resolveItem = (
  item: PlayItem, pref: Kind, condensed: CondensedMap | null, exclude: string[] = [], region: string | null = null, avoid: string[] = [],
) => pickCut(item.match, item.kind ?? pref, condensed, exclude, region, avoid);

/** Does the match have any cut that plays in `region`? */
export const playableIn = (m: Match, region: string | null) => m.highlights.some((h) => availableIn(h, region));

/**
 * How long after kick-off a match whose videos don't play in the viewer's country still
 * counts as "not out yet" rather than "not available": the first upload is often one
 * broadcaster's (Sky, UK only) and the local one (NBC, US) follows hours later. Matches the
 * refresh plan's LATE_UNTIL_H, which keeps looking for a widely playable cut that long.
 */
export const REGION_WAIT_H = 54;

/** Has videos, none of them play in `region`, and one that does may still come. */
export const awaitingIn = (m: Match, region: string | null, now = Date.now()) =>
  m.highlights.length > 0 && !playableIn(m, region) && now - Date.parse(m.utcDate) < REGION_WAIT_H * 3600e3;

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
