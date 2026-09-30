// Condensed cuts (experimental): an extended highlight played as a list of key
// moments, [start, end] in seconds, computed at ingest from YouTube's chapters
// (scripts/lib/condense.mjs). The Player seeks from one moment to the next.

export type Moment = [number, number];

export interface CondensedEntry {
  /** moments, in order */
  m: Moment[];
  /** total seconds */
  s: number;
}

export type CondensedMap = Record<string, CondensedEntry>;

/** Index of the moment playing at `t` (a second of slack at the start), or -1 when `t` falls between moments. */
export function momentAt(moments: Moment[], t: number): number {
  return moments.findIndex(([s, e]) => t >= s - 1 && t < e);
}

/** Volume ramp and gap lengths, in ms: long enough to soften a cut, short enough not to drag. */
export const FADE_OUT_MS = 450;
export const FADE_IN_MS = 700;
/** Start fading this many seconds before a moment ends, so the fade finishes on time. */
export const LEAD_SEC = 0.6;
