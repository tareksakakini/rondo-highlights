// Auto-condensed cuts: play only the key moments of an extended highlight.
//
// YouTube adds automatic chapters to most extended highlights, and a chapter
// usually starts right at a goal: in the videos checked (NBC Sports, club
// channels, Premier League 2026/27 MD5) the ball went in between ~2 s before and
// ~10 s after the chapter start, with the build-up just before it. So every
// chapter edge (each chapter start after 0:00) becomes a moment, from PRE_SEC
// before it to POST_SEC after it. Every video with chapters gets a cut, whatever
// its chapter titles say. Busy games can have several goals in one chapter, so a
// condensed cut can skip a goal; the site says so next to the button.
//
// Pure functions, no I/O. Covered by tests/condense.test.mjs.

/** Seconds kept before a chapter start (build-up) and after it (goal, celebration, first replay). */
export const PRE_SEC = 20;
export const POST_SEC = 25;
/** Moments closer together than this are played as one, so the player doesn't jump for a few seconds. */
export const MERGE_GAP_SEC = 10;

/**
 * Chapters from a YouTube watch page's HTML (automatic or description chapters).
 * Returns [{ start, title }] sorted by start (may be empty), or null when the page
 * has no ytInitialData at all (consent page, bot check, error page).
 */
export function parseChapters(html) {
  const m = html.match(/var ytInitialData\s*=\s*(\{.*?\});\s*<\/script>/s);
  if (!m) return null;
  let data;
  try { data = JSON.parse(m[1]); } catch { return null; }
  const maps = [];
  (function walk(o) {
    if (!o || typeof o !== 'object') return;
    if (Array.isArray(o.markersMap)) maps.push(o.markersMap);
    for (const v of Object.values(o)) walk(v);
  })(data);
  const chapters = new Map();
  for (const map of maps) {
    // Prefer the uploader's own chapters over YouTube's automatic ones.
    const ordered = [...map].sort((a, b) => (a.key === 'DESCRIPTION_CHAPTERS' ? -1 : 0) - (b.key === 'DESCRIPTION_CHAPTERS' ? -1 : 0));
    for (const entry of ordered) {
      const list = entry?.value?.chapters;
      if (!Array.isArray(list) || !list.length || chapters.size) continue;
      for (const c of list) {
        const r = c.chapterRenderer;
        if (!r) continue;
        const start = Math.round((r.timeRangeStartMillis ?? 0) / 1000);
        const title = r.title?.simpleText ?? r.title?.runs?.map((x) => x.text).join('') ?? '';
        chapters.set(start, title);
      }
    }
  }
  return [...chapters].map(([start, title]) => ({ start, title })).sort((a, b) => a.start - b.start);
}

/**
 * Key moments for one video.
 * @param chapters    [{ start, title }] from parseChapters()
 * @param durationSec video length
 * @returns { m: [[start, end], ...], s: total seconds }, or null when the video has no chapter edges
 */
export function momentsFor(chapters, durationSec) {
  if (!chapters?.length || !durationSec) return null;
  const starts = chapters.map((c) => c.start).filter((t) => t > 0 && t < durationSec).sort((a, b) => a - b);
  if (!starts.length) return null;
  const windows = [];
  for (const t of starts) {
    const w = [Math.max(0, t - PRE_SEC), Math.min(durationSec, t + POST_SEC)];
    const last = windows[windows.length - 1];
    if (last && w[0] - last[1] < MERGE_GAP_SEC) last[1] = Math.max(last[1], w[1]);
    else windows.push(w);
  }
  return { m: windows, s: windows.reduce((sum, [a, b]) => sum + (b - a), 0) };
}
