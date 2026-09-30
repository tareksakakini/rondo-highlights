// Condensed cuts (experimental): play only the key moments of an extended highlight.
//
// YouTube adds automatic chapters to most extended highlights, and a chapter
// usually starts right at a goal: in the videos checked (NBC Sports, club
// channels, Premier League 2026/27 MD5) the ball went in between ~2 s before and
// ~10 s after the chapter start, with the build-up just before it. So each
// chapter start becomes a moment, from PRE_SEC before it to POST_SEC after it.
//
// Chapters don't catch every goal (late goals in busy games often share a
// chapter), so a video only gets a condensed cut when it has at least as many
// action chapters as the match had goals, and at least one chapter title names a
// goal (which also keeps out press conferences and analysis shows that were
// classified as extended cuts). Otherwise the site plays the video in full.
//
// Pure functions, no I/O. Covered by tests/condense.test.mjs.

/** Seconds kept before a chapter start (build-up) and after it (goal, celebration, first replay). */
export const PRE_SEC = 20;
export const POST_SEC = 25;
/** Moments closer together than this are played as one, so the player doesn't jump for a few seconds. */
export const MERGE_GAP_SEC = 10;
/** A condensed cut that keeps more than this share of the video isn't worth offering. */
export const MAX_SHARE = 0.75;
/** Extended cuts longer than this are shows (e.g. "Matchday Live"), not highlights. */
export const MAX_VIDEO_SEC = 30 * 60;

// Chapter titles are written by YouTube's AI ("Brentford take the lead", "Match
// preview and setup", "Post-match reflection"). Action words win over skip words.
const ACTION = /goal|scor|lead|equali[sz]|winner|penalt|red card|sent off|header|strike|stunner|opener|opens|double|brace|hat-?trick|comeback|response|drama|save|chance|miss|disallow|offside|\bvar\b|deadlock|extend|third|fourth|fifth|seal|clinch|reply|pull(s|ed)? (one|a goal) back|late/i;
const SKIP = /preview|build-?up|line-?ups?|arrival|warm-?up|kick-?off|conclusion|reflection|summary|analysis|sign-?off|post-?match|review|studio|reaction|full[- ]time|interview|press|pundit|intro|setup|set-up|outlook|context|atmosphere/i;
const HALF = /\b(first|second|1st|2nd) half\b/i;
// At least one chapter must name a goal, so press conferences, analysis shows and
// behind-the-scenes videos that got classified as extended cuts are left alone.
const GOAL = /goal|scor|lead|equali[sz]|winner|deadlock|penalt|hat-?trick|brace|double|strike|opener|comeback|restores/i;

/** Is this chapter likely to hold a key moment? */
export function isActionChapter(title) {
  if (ACTION.test(title)) return true;
  return !SKIP.test(title) && !HALF.test(title);
}

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
 * @param chapters   [{ start, title }] from parseChapters()
 * @param durationSec video length
 * @param goals      goals in the match (home + away), or null when unknown
 * @returns { m: [[start, end], ...], s: total seconds } or null when no good condensed cut exists
 */
export function momentsFor(chapters, durationSec, goals = null) {
  if (!chapters?.length || !durationSec || durationSec > MAX_VIDEO_SEC) return null;
  const action = chapters.filter((c) => c.start >= 5 && c.start < durationSec - 5 && isActionChapter(c.title));
  if (!action.length) return null;
  if (goals != null && action.length < goals) return null;
  if (goals !== 0 && !chapters.some((c) => GOAL.test(c.title))) return null;
  const starts = action.map((c) => c.start);

  const windows = [];
  for (const s of starts) {
    const w = [Math.max(0, s - PRE_SEC), Math.min(durationSec, s + POST_SEC)];
    const last = windows[windows.length - 1];
    if (last && w[0] - last[1] < MERGE_GAP_SEC) last[1] = Math.max(last[1], w[1]);
    else windows.push(w);
  }
  const total = windows.reduce((t, [a, b]) => t + (b - a), 0);
  if (total > MAX_SHARE * durationSec) return null;
  return { m: windows, s: total };
}

/** Goals in a match, or null when the score isn't known. */
export function goalsIn(match) {
  const { home, away } = match.score ?? {};
  return Number.isInteger(home) && Number.isInteger(away) ? home + away : null;
}
