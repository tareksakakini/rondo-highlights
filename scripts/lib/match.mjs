// Pure functions that turn (fixtures, videos) into per-round highlight data.
// No I/O here — shared by ingest.mjs (live APIs) and build-sample.mjs (offline seed),
// and covered by tests/match.test.mjs.

/** Lowercase, strip accents/punctuation, collapse whitespace. */
export function normalize(s) {
  return ` ${String(s ?? '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/ø/gi, 'o')
    .replace(/ß/g, 'ss')
    .toLowerCase()
    .replace(/['’`]/g, '')
    .replace(/&/g, ' and ')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()} `;
}

// Club-name noise words that titles usually drop ("FC Barcelona" -> "Barcelona").
const NOISE = new Set([
  'fc', 'cf', 'afc', 'ac', 'as', 'ss', 'ssc', 'us', 'sc', 'sv', 'sk', 'fk', 'kv', 'vfb', 'vfl',
  'tsg', 'fsv', 'rc', 'rcd', 'cd', 'ud', 'sd', 'ca', 'osc', 'bk', 'club', 'de', 'calcio', 'bc',
]);

// Nicknames / short forms broadcasters use that can't be derived automatically.
// Keyed by football-data.org TLA (preferred) or by normalized short name.
export const MANUAL_ALIASES = {
  // Premier League
  TOT: ['spurs', 'tottenham'],
  MUN: ['man utd', 'man united', 'manchester united'],
  MCI: ['man city', 'manchester city'],
  WOL: ['wolves'],
  BHA: ['brighton'],
  NOT: ['nottingham forest', 'nottm forest', 'forest'],
  AVL: ['villa', 'aston villa'],
  NEW: ['newcastle'],
  WHU: ['west ham'],
  LEE: ['leeds'],
  CRY: ['palace', 'crystal palace'],
  HUL: ['hull', 'hull city'],
  IPS: ['ipswich'],
  COV: ['coventry'],
  SUN: ['sunderland'],
  BOU: ['bournemouth'],
  // Spain
  ATM: ['atletico madrid', 'atletico', 'atleti'],
  BAR: ['barcelona', 'barca'],
  RMA: ['real madrid'],
  ATH: ['athletic club', 'athletic bilbao'],
  BET: ['real betis', 'betis'],
  RSO: ['real sociedad'],
  // Italy
  INT: ['inter', 'inter milan', 'internazionale'],
  MIL: ['ac milan'],
  JUV: ['juventus', 'juve'],
  // Germany
  FCB: ['bayern', 'bayern munich', 'bayern munchen'],
  BVB: ['dortmund', 'bvb'],
  B04: ['leverkusen', 'bayer leverkusen'],
  BMG: ['gladbach', 'mgladbach', 'monchengladbach'],
  KOE: ['koln', 'cologne'],
  HSV: ['hamburg', 'hamburger', 'hsv'],
  // France
  PSG: ['psg', 'paris saint germain', 'paris sg'],
};

/** Every phrase that can identify this team in a video title (normalized, padded). */
export function teamAliases(team) {
  const out = new Set();
  const add = (s) => {
    const n = normalize(s).trim();
    if (n.length >= 3 || /^[a-z]{2,}$/.test(n)) out.add(n);
  };
  const strip = (s) =>
    normalize(s).trim().split(' ')
      .filter((w) => !NOISE.has(w) && !/^\d+$/.test(w))
      .join(' ');
  for (const src of [team.name, team.shortName]) {
    if (!src) continue;
    add(src);
    add(strip(src));
  }
  for (const a of MANUAL_ALIASES[team.tla] ?? []) add(a);
  out.delete('');
  return [...out].filter((a) => a.length >= 3);
}

/** Does `title` mention the team (whole-word match on any alias)? Returns the longest alias matched. */
export function mentions(normTitle, aliases) {
  let best = '';
  for (const a of aliases) {
    if (normTitle.includes(` ${a} `) && a.length > best.length) best = a;
  }
  return best;
}

const HIGHLIGHT_RE = /highlight|resumen|extended|sintesi|melhores momentos/i;
const EXCLUDE_RE =
  /\b(women|femenino|femminile|frauen|wsl|u-?1[5-9]|u-?2[0-3]|academy|youth|press conference|preview|reaction|interview|pitchside|tunnel|training|podcast|live stream|streamed|every goal|all goals|all highlights|top \d+|review|full match|carabao|fa cup|efl cup|copa del rey|coppa italia|dfb|pokal|coupe de france|#shorts)\b/i;

/** Cheap title-only pre-filter (before we spend quota on video details). */
export function looksLikeMatchHighlight(title) {
  return HIGHLIGHT_RE.test(title) && !EXCLUDE_RE.test(title);
}

const EXTENDED_RE = /\bextended\b|\bextendido\b|\blong\b/i;
export const EXTENDED_MIN_SEC = 7 * 60;

/**
 * Assign 'short' | 'extended' to every candidate video of ONE match.
 * 1. explicit "extended" in the title, or >= 7 min  -> extended
 * 2. otherwise short
 * 3. if nothing ended up extended but the longest cut is >= 2x the shortest
 *    (and at least 2.5 min), the longest is treated as the extended version.
 */
export function classify(videos) {
  const out = videos.map((v) => ({
    ...v,
    kind: EXTENDED_RE.test(v.title) || v.durationSec >= EXTENDED_MIN_SEC ? 'extended' : 'short',
  }));
  if (out.length > 1 && !out.some((v) => v.kind === 'extended')) {
    const sorted = [...out].sort((a, b) => a.durationSec - b.durationSec);
    const shortest = sorted[0];
    const longest = sorted[sorted.length - 1];
    if (longest.durationSec >= 150 && longest.durationSec >= 2 * shortest.durationSec) {
      longest.kind = 'extended';
    }
  }
  return out;
}

/**
 * Attach highlight videos to fixtures.
 * @param fixtures football-data.org style match objects
 * @param videos   [{videoId,title,channel,channelId,durationSec,publishedAt,embeddable,priority}]
 * @returns Map<matchId, Highlight[]>
 */
export function matchVideosToFixtures(fixtures, videos, { windowHours = 120 } = {}) {
  const teamCache = new Map();
  const aliasesOf = (t) => {
    const key = `${t.id ?? t.name}`;
    if (!teamCache.has(key)) teamCache.set(key, teamAliases(t));
    return teamCache.get(key);
  };

  const byMatch = new Map();
  for (const v of videos) {
    if (v.embeddable === false) continue;
    if (!v.durationSec || v.durationSec < 45) continue; // Shorts / teasers
    if (!looksLikeMatchHighlight(v.title)) continue;
    const t = normalize(v.title);
    const published = Date.parse(v.publishedAt);

    let best = null;
    for (const f of fixtures) {
      const kickoff = Date.parse(f.utcDate);
      if (!(published >= kickoff && published <= kickoff + windowHours * 3600e3)) continue;
      const h = mentions(t, aliasesOf(f.homeTeam));
      const a = mentions(t, aliasesOf(f.awayTeam));
      if (!h || !a || h === a) continue;
      // Prefer the fixture whose names matched most specifically, then the closest kick-off.
      const score = h.length + a.length - (published - kickoff) / 3.6e9;
      if (!best || score > best.score) best = { f, score };
    }
    if (!best) continue;
    const id = best.f.id;
    if (!byMatch.has(id)) byMatch.set(id, []);
    byMatch.get(id).push(v);
  }

  const result = new Map();
  for (const [id, vids] of byMatch) {
    const uniq = [...new Map(vids.map((v) => [v.videoId, v])).values()];
    const classified = classify(uniq).sort(
      (a, b) =>
        (a.kind === b.kind ? 0 : a.kind === 'short' ? -1 : 1) ||
        (a.priority ?? 99) - (b.priority ?? 99) ||
        Date.parse(a.publishedAt) - Date.parse(b.publishedAt),
    );
    result.set(
      id,
      classified.map(({ videoId, title, channel, channelId, durationSec, publishedAt, kind, priority }) => ({
        videoId, title, channel, channelId, durationSec, publishedAt, kind, priority: priority ?? 99,
      })),
    );
  }
  return result;
}

const STAGE_LABELS = {
  LEAGUE_STAGE: 'League phase',
  PLAYOFFS: 'Knockout play-offs',
  LAST_16: 'Round of 16',
  QUARTER_FINALS: 'Quarter-finals',
  SEMI_FINALS: 'Semi-finals',
  FINAL: 'Final',
};

/** Group fixtures into rounds ("Matchweek 5", "Round of 16"). */
export function roundOf(fixture, roundLabel = 'Matchweek') {
  const stage = fixture.stage ?? 'REGULAR_SEASON';
  if (stage === 'REGULAR_SEASON' || (stage === 'LEAGUE_STAGE' && fixture.matchday)) {
    const md = fixture.matchday;
    const prefix = stage === 'LEAGUE_STAGE' ? 'League phase · MD' : roundLabel;
    return { key: `md-${md}`, label: `${prefix} ${md}`, matchday: md };
  }
  const key = stage.toLowerCase().replace(/_/g, '-');
  return { key, label: STAGE_LABELS[stage] ?? stage.replace(/_/g, ' ').toLowerCase(), stage };
}

const byKindThenPriority = (a, b) =>
  (a.kind === b.kind ? 0 : a.kind === 'short' ? -1 : 1) || (a.priority ?? 99) - (b.priority ?? 99);

function slimTeam(t) {
  return { name: t.name, short: t.shortName || t.name, tla: t.tla || (t.shortName || t.name).slice(0, 3).toUpperCase(), crest: t.crest || null };
}

/**
 * Build the per-round JSON files for one competition.
 * `previous` (Map roundKey -> RoundFile) lets us keep highlights found on earlier runs.
 */
export function buildCompetition(comp, season, fixtures, highlightsByMatch, previous = new Map()) {
  const rounds = new Map();
  for (const f of fixtures) {
    const r = roundOf(f, comp.roundLabel);
    if (!rounds.has(r.key)) rounds.set(r.key, { round: r, matches: [] });
    const prevRound = previous.get(r.key);
    const prevMatch = prevRound?.matches.find((m) => m.id === f.id);
    const fresh = highlightsByMatch.get(f.id) ?? [];
    const merged = [...new Map([...(prevMatch?.highlights ?? []), ...fresh].map((h) => [h.videoId, h])).values()];
    rounds.get(r.key).matches.push({
      id: f.id,
      utcDate: f.utcDate,
      status: f.status,
      home: slimTeam(f.homeTeam),
      away: slimTeam(f.awayTeam),
      score: { home: f.score?.fullTime?.home ?? null, away: f.score?.fullTime?.away ?? null },
      highlights: classify(merged).sort(byKindThenPriority),
    });
  }

  const files = [...rounds.values()]
    .map(({ round, matches }) => ({
      competition: comp.code,
      season,
      round,
      matches: matches.sort((a, b) => Date.parse(a.utcDate) - Date.parse(b.utcDate) || a.home.name.localeCompare(b.home.name)),
    }))
    .sort((a, b) => Date.parse(a.matches[0].utcDate) - Date.parse(b.matches[0].utcDate));

  // Default round = latest one that has any finished match.
  const played = files.filter((f) => f.matches.some((m) => m.status === 'FINISHED' || m.highlights.length));
  const current = (played[played.length - 1] ?? files[0])?.round.key ?? null;

  const index = {
    code: comp.code,
    name: comp.name,
    country: comp.country,
    color: comp.color,
    season,
    seasonLabel: `${season}/${String(season + 1).slice(2)}`,
    currentRound: current,
    rounds: files.map((f) => ({
      key: f.round.key,
      label: f.round.label,
      firstDate: f.matches[0].utcDate,
      matches: f.matches.length,
      withHighlights: f.matches.filter((m) => m.highlights.length).length,
    })),
  };
  return { index, files };
}
