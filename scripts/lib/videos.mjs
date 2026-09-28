// "Video-first" competitions: for a competition with no fixture feed, matches are
// discovered from highlight titles instead. (Europa League and Nations League used this
// until they moved to Highlightly fixtures; no competition uses it at the moment.)
//
//   1. parseTeams()   pulls "Team A" and "Team B" out of a title
//   2. canonical()    maps each side to a known team (clubs seen in the free
//                     competitions, national teams) or a cleaned-up name
//   3. videos about the same pair of teams within a few days form one match
//   4. rounds come from "MD 3"/"Matchday 3" in titles when present, otherwise
//      from date windows (e.g. a Nations League international break)
//
// Pure functions, no I/O. Covered by tests/videos.test.mjs.

import { normalize, teamAliases, classify, slimHighlight, detectComps, looksLikeMatchHighlight, STAGE_LABELS, sortFiles, indexFor } from './match.mjs';
import { NATIONS } from './teams.mjs';

const EMOJI = /[\p{Extended_Pictographic}\u{1F1E6}-\u{1F1FF}\u{FE0F}\u{200D}]/gu;

function cleanSide(s) {
  return s
    .replace(/\((?:agg|aet|pens?|[\d\s:-]+)[^)]*\)/gi, ' ')
    .replace(/\[[^\]]*\]|\([^)]*\)/g, ' ')
    .replace(/\s+(?:(?:extended|full|official|all)\s+)*(?:match\s+)?highlights?\b.*$/i, '')
    .replace(/\s+(?:resumen|resume|samenvatting|sintesi)\b.*$/i, '')
    .replace(/^(?:highlights?|resumen|extended highlights)\s*[:|-]?\s*/i, '')
    .replace(/\s{2,}/g, ' ')
    .trim();
}

const words = (s) => normalize(s).trim().split(' ').filter(Boolean).length;
const plausible = (s) => s && words(s) >= 1 && words(s) <= 5 && !/^\d+$/.test(s);

/**
 * Extract the two team names from a highlight title, in the order written
 * (usually home first). Returns null when no "A vs B" / "A 2-1 B" pattern fits.
 */
export function parseTeams(title) {
  const t = title.replace(EMOJI, ' ').replace(/\s+/g, ' ');
  const segments = t.split(/\s*[|¦•]\s*|\s+I\s+|:\s+|\s+[-–—]{2,}\s+/).map((s) => s.trim()).filter(Boolean);
  for (const seg of segments) {
    let m;
    // "A 2-1 B", "A 2–1 B"
    if ((m = seg.match(/^(.+?)\s+(\d{1,2})\s*[-–:]\s*(\d{1,2})\s+(.+)$/))) {
      const a = cleanSide(m[1]); const b = cleanSide(m[4]);
      if (plausible(a) && plausible(b)) return { home: a, away: b, score: [Number(m[2]), Number(m[3])] };
    }
    // "Italia-Belgio 2-1" (federation style, no spaces around the dash)
    if ((m = seg.match(/^([^\d\s-][^\d-]*?)-([^\d\s-][^\d-]*?)\s+(\d{1,2})\s*[-–:]\s*(\d{1,2})\b/))) {
      const a = cleanSide(m[1]); const b = cleanSide(m[2]);
      if (plausible(a) && plausible(b)) return { home: a, away: b, score: [Number(m[3]), Number(m[4])] };
    }
    // "A 2 B 1" (Newcastle style)
    if ((m = seg.match(/^([^\d]+?)\s+(\d{1,2})\s+([^\d]+?)\s+(\d{1,2})$/))) {
      const a = cleanSide(m[1]); const b = cleanSide(m[3]);
      if (plausible(a) && plausible(b)) return { home: a, away: b, score: [Number(m[2]), Number(m[4])] };
    }
    // "A vs. B", "A v B", "A vs B Highlights ..."
    if ((m = seg.match(/^(.+?)\s+(?:vs?\.?|x)\s+(.+)$/i))) {
      const a = cleanSide(m[1]); const b = cleanSide(m[2]);
      if (plausible(a) && plausible(b)) return { home: a, away: b };
    }
    // "A - B" (all-caps league style)
    if ((m = seg.match(/^([^-–]+?)\s+[-–]\s+([^-–]+)$/))) {
      const a = cleanSide(m[1]); const b = cleanSide(m[2]);
      if (plausible(a) && plausible(b) && words(a) <= 4 && words(b) <= 4) return { home: a, away: b };
    }
  }
  return null;
}

/** "MD 3", "Matchday 3", "Jornada 3" → 3; knockout words → stage key. */
export function roundFromTitle(title) {
  const md = title.match(/\b(?:md|matchday|match day|jornada|giornata|spieltag|journee)\s?-?\s?(\d{1,2})\b/i);
  if (md) return { md: Number(md[1]) };
  const t = title.toLowerCase();
  if (/\bknockout play-?offs?\b|\bplay-?off round\b/.test(t)) return { stage: 'PLAYOFFS' };
  if (/\bround of 16\b|\blast 16\b/.test(t)) return { stage: 'LAST_16' };
  if (/\bquarter-?finals?\b/.test(t)) return { stage: 'QUARTER_FINALS' };
  if (/\bsemi-?finals?\b/.test(t)) return { stage: 'SEMI_FINALS' };
  if (/\bfinal\b/.test(t)) return { stage: 'FINAL' };
  return {};
}

const titleCase = (s) => s.toLowerCase().replace(/(^|[\s'.-])(\p{L})/gu, (_, p, c) => p + c.toUpperCase());

/**
 * Build a resolver that maps a raw team string to a stable team.
 * `knownTeams` = teams from the free fixture feeds (clubs) — national teams are always included.
 */
export function makeRegistry(knownTeams = [], { nations = true, clubs = true } = {}) {
  const entries = [];
  const seen = new Set();
  // Club competitions must not resolve "Ararat-Armenia" to the national team, and vice versa.
  for (const t of [...(nations ? NATIONS : []), ...(clubs ? knownTeams : [])]) {
    const key = t.national ? `n:${t.tla}` : `c:${t.id ?? normalize(t.name).trim()}`;
    if (seen.has(key)) continue;
    seen.add(key);
    entries.push({ key, team: t, aliases: teamAliases(t) });
  }
  return function canonical(raw) {
    const s = normalize(raw).trim();
    if (!s) return null;
    let best = null;
    for (const e of entries) {
      for (const a of e.aliases) {
        if (a === s) return slim(e);
        if ((` ${s} `).includes(` ${a} `) && (!best || a.length > best.len)) best = { e, len: a.length };
      }
    }
    if (best && best.len >= 4) return slim(best.e);
    if (words(raw) > 4) return null;
    const name = /[a-z]/.test(raw) ? raw : titleCase(raw);
    return { key: `x:${s}`, name, short: name, tla: s.replace(/[^a-z]/g, '').slice(0, 3).toUpperCase(), crest: null };
  };
  function slim(e) {
    const t = e.team;
    return { key: e.key, name: t.name, short: t.shortName || t.name, tla: t.tla || t.name.slice(0, 3).toUpperCase(), crest: t.crest ?? null };
  }
}

const DAY = 86400e3;

const tokens = (s) => new Set(normalize(s).trim().split(' ').filter((w) => w.length > 1));
const subset = (a, b) => [...a].every((w) => b.has(w));
/** One side is the same team and the other side's name is a word-subset of the other's. */
function relatedTeam(a, b) {
  if (a.key === b.key) return true;
  const ta = tokens(a.name); const tb = tokens(b.name);
  return ta.size > 0 && tb.size > 0 && (subset(ta, tb) || subset(tb, ta));
}
function sameFixture(m, home, away) {
  const [h, a] = [m.home, m.away];
  return (h.key === home.key && relatedTeam(a, away)) || (a.key === away.key && relatedTeam(h, home))
    || (h.key === away.key && relatedTeam(a, home)) || (a.key === home.key && relatedTeam(h, away));
}

/**
 * Discover matches for a video-first competition.
 * @param comp       competition config
 * @param season     season start year
 * @param videos     candidate videos (already channel-filtered, with priority/tier)
 * @param canonical  from makeRegistry()
 * @param previous   Map roundKey -> previously published RoundFile (keeps older matches)
 */
export function buildFromVideos(comp, season, videos, canonical, previous = new Map()) {
  const matches = new Map(); // id -> match with _videos

  // Seed with previously published matches so they survive short lookback windows.
  for (const file of previous.values()) {
    for (const m of file.matches) {
      matches.set(m.id, {
        ...m,
        _pair: [m.home.key, m.away.key].sort().join('|'),
        _t: Math.min(...m.highlights.map((h) => Date.parse(h.publishedAt))),
        _videos: [...m.highlights],
        _round: { md: m.round?.md ?? undefined, stage: m.round?.stage ?? undefined },
        _orderPriority: Math.min(...m.highlights.map((h) => h.priority ?? 99)),
      });
    }
  }

  for (const v of videos) {
    if (v.embeddable === false || !v.durationSec || v.durationSec < 45) continue;
    if (!looksLikeMatchHighlight(v.title)) continue;
    const hints = detectComps(v.title);
    if (hints.size && !hints.has(comp.code)) continue;
    if (!hints.has(comp.code) && v.tier !== 'broadcaster') continue; // clubs/nations must name the competition
    const parsed = parseTeams(v.title);
    if (!parsed) continue;
    const home = canonical(parsed.home);
    const away = canonical(parsed.away);
    if (!home || !away || home.key === away.key) continue;
    const pair = [home.key, away.key].sort().join('|');
    const t = Date.parse(v.publishedAt);
    const r = roundFromTitle(v.title);

    let match = [...matches.values()].find((m) => m._pair === pair && Math.abs(m._t - t) <= 4 * DAY)
      // Same fixture spelled differently by another channel ("AZ Alkmaar" vs "Alkmaar", "NEC" vs "NEC Nijmegen").
      ?? [...matches.values()].find((m) => Math.abs(m._t - t) <= 2 * DAY && sameFixture(m, home, away));
    if (!match) {
      const kickoff = new Date(t - 3 * 3600e3);
      const id = `${comp.code}-${home.key}-${away.key}-${kickoff.toISOString().slice(0, 10)}`.replace(/[^\w:-]+/g, '_');
      match = {
        id, utcDate: kickoff.toISOString(), status: 'FINISHED',
        home: { ...home }, away: { ...away }, score: { home: null, away: null },
        _pair: pair, _t: t, _videos: [], _round: {}, _orderPriority: 99,
      };
      matches.set(id, match);
    }
    if (match._videos.some((x) => x.videoId === v.videoId)) continue;
    match._videos.push(v);
    match._t = Math.min(match._t, t);
    // The highest-priority channel decides home/away order and the display names.
    if ((v.priority ?? 99) < (match._orderPriority ?? 99)) {
      match._orderPriority = v.priority ?? 99;
      match.home = { ...home };
      match.away = { ...away };
    }
    // Scores from official titles ("A 2-1 B") fill in the result, oriented to the match.
    if (parsed.score && match.score.home == null) {
      const same = home.key === match.home.key;
      match.score = same ? { home: parsed.score[0], away: parsed.score[1] } : { home: parsed.score[1], away: parsed.score[0] };
    }
    if (r.md) match._round.md = match._round.md ?? r.md;
    if (r.stage) match._round.stage = match._round.stage ?? r.stage;
  }

  const list = [...matches.values()].filter((m) => m._videos.length);

  // Matches without an explicit matchday: borrow it from matches with one on nearby dates.
  const dated = list.filter((m) => m._round.md);
  for (const m of list) {
    if (m._round.md || m._round.stage) continue;
    const near = dated
      .map((d) => ({ md: d._round.md, gap: Math.abs(d._t - m._t) }))
      .filter((d) => d.gap <= 2.5 * DAY)
      .sort((a, b) => a.gap - b.gap)[0];
    if (near) m._round.md = near.md;
  }

  // Remaining matches: group into date windows (a gap of more than 3 days starts a new one).
  const loose = list.filter((m) => !m._round.md && !m._round.stage).sort((a, b) => a._t - b._t);
  let windowStart = null; let last = null;
  for (const m of loose) {
    if (last === null || m._t - last > 3 * DAY) windowStart = m._t;
    m._round.window = windowStart;
    last = m._t;
  }

  const rounds = new Map();
  const fmt = (t) => new Date(t).toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' });
  for (const m of list) {
    const r = m._round;
    let round;
    if (r.stage) round = { key: r.stage.toLowerCase().replace(/_/g, '-'), label: STAGE_LABELS[r.stage] ?? r.stage, stage: r.stage };
    else if (r.md) round = { key: `md-${r.md}`, label: `League phase · MD ${r.md}`, md: r.md };
    else round = { key: `w-${new Date(r.window).toISOString().slice(0, 10)}`, label: '', window: r.window };
    if (!rounds.has(round.key)) rounds.set(round.key, { round, matches: [] });
    const highlights = classify([...new Map(m._videos.map((x) => [x.videoId, x])).values()])
      .sort((a, b) => (a.kind === b.kind ? 0 : a.kind === 'short' ? -1 : 1) || (a.priority ?? 99) - (b.priority ?? 99))
      .map(slimHighlight);
    rounds.get(round.key).matches.push({
      id: m.id, utcDate: m.utcDate, status: 'FINISHED',
      home: { key: m.home.key, name: m.home.name, short: m.home.short, tla: m.home.tla, crest: m.home.crest ?? null },
      away: { key: m.away.key, name: m.away.name, short: m.away.short, tla: m.away.tla, crest: m.away.crest ?? null },
      score: m.score ?? { home: null, away: null },
      round: { md: r.md ?? null, stage: r.stage ?? null },
      highlights,
    });
  }

  const files = sortFiles([...rounds.values()].map(({ round, matches: ms }) => ({ competition: comp.code, season, round, matches: ms })));
  // Label date windows now that we know their span: "Sep 24–29".
  for (const f of files) {
    if (!f.round.key.startsWith('w-')) continue;
    const first = Date.parse(f.matches[0].utcDate);
    const lastT = Date.parse(f.matches[f.matches.length - 1].utcDate);
    const [m1, d1] = fmt(first).split(' ');
    const [m2, d2] = fmt(lastT).split(' ');
    const span = m1 === m2 ? (d1 === d2 ? `${m1} ${d1}` : `${m1} ${d1}–${d2}`) : `${m1} ${d1} – ${m2} ${d2}`;
    f.round.label = `League phase · ${span}`;
  }
  return { index: indexFor(comp, season, files), files };
}
