// Pure functions that turn (fixtures, videos) into per-round highlight data.
// No I/O here — shared by ingest.mjs (live APIs) and build-sample.mjs (offline seed),
// and covered by tests/match.test.mjs.

import { NATIONS } from './teams.mjs';
import { EMBED_BLOCKED } from '../config.mjs';

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

// Keyed by football-data's full name where three-letter codes collide across leagues
// (BRE is Brentford and Brest). Spellings taken from the Ligue 1 channel's titles.
const NAME_ALIASES = {
  'le havre ac': ['havre', 'havre ac'],
  'es troyes ac': ['troyes', 'estac troyes', 'estac'],
  'racing club de lens': ['lens', 'rc lens'],
  'lille osc': ['lille', 'losc lille', 'losc'],
  'as monaco fc': ['monaco', 'as monaco'],
  'stade rennais fc 1901': ['rennes', 'stade rennais'],
  'olympique lyonnais': ['lyon', 'olympique lyonnais'],
  'rc strasbourg alsace': ['strasbourg', 'rc strasbourg'],
};

// Lookup: any normalized national-team name/alias -> nation entry.
const NATION_INDEX = new Map();
for (const n of NATIONS) {
  for (const a of [n.name, ...n.extraAliases]) NATION_INDEX.set(normalize(a).trim(), n);
}
export const nationFor = (name) => NATION_INDEX.get(normalize(name).trim()) ?? null;

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
  const nation = team.national ? team : nationFor(team.name) ?? nationFor(team.shortName ?? '');
  if (nation) {
    add(nation.name);
    for (const a of nation.extraAliases ?? []) add(a);
  } else {
    for (const a of MANUAL_ALIASES[team.tla] ?? []) add(a);
    for (const a of NAME_ALIASES[normalize(team.name ?? '').trim()] ?? []) add(a);
  }
  for (const a of team.extraAliases ?? []) add(a);
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

/** Levenshtein distance, capped: returns max+1 as soon as it's certain to exceed `max`. */
function editDistance(a, b, max = 1) {
  if (Math.abs(a.length - b.length) > max) return max + 1;
  let prev = Array.from({ length: b.length + 1 }, (_, j) => j);
  for (let i = 1; i <= a.length; i++) {
    const cur = [i];
    let rowMin = i;
    for (let j = 1; j <= b.length; j++) {
      cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
      rowMin = Math.min(rowMin, cur[j]);
    }
    if (rowMin > max) return max + 1;
    prev = cur;
  }
  return prev[b.length];
}

// Words of 6+ letters one typo apart count as the same ("olympiacos"/"olympiakos",
// "ferencvaros"/"ferencvarosi"); shorter words must match exactly.
const sameWord = (a, b) => a === b || (Math.min(a.length, b.length) >= 6 && editDistance(a, b) <= 1);

/**
 * Fallback for mentions(): the same whole-word test, but tolerating one spelling
 * difference per long word, for fixture feeds and broadcasters that transliterate
 * names differently. Returns the alias matched, or ''.
 */
export function fuzzyMentions(normTitle, aliases) {
  const tw = normTitle.trim().split(' ');
  let best = '';
  for (const alias of aliases) {
    if (alias.length <= best.length) continue;
    const aw = alias.split(' ');
    if (!aw.some((w) => w.length >= 6)) continue; // nothing long enough to be fuzzy about
    for (let i = 0; i + aw.length <= tw.length; i++) {
      if (aw.every((w, k) => sameWord(w, tw[i + k]))) { best = alias; break; }
    }
  }
  return best;
}

const HIGHLIGHT_RE = /highlight|resumen|extended|sintesi|melhores momentos|samenvatting|zusammenfassung|key moments/i;
// Anything but the men's first team: women's sides, youth and academy sides (UEFA Youth
// League, U19, Primavera, Juvenil...), reserve and B teams (Dortmund II, Castilla, Jong Ajax).
// Also applied to highlights kept from earlier runs, so tightening it cleans up stored data.
const NOT_FIRST_TEAM_RE =
  /\b(women|womens|woman|ladies|femenino|femenina|femminile|frauen|damen|feminine|feminines|wsl|nwsl|liga f|u-?1[4-9]\w*|u-?2[0-3]\w*|sub-?1[4-9]|sub-?2[0-3]|weuro|under[- ]?\d\d|[pf]1[4-9]|[pf]2[01]|academy|youth|uyl|juvenil|juveniles|primavera|jugend|a-?junioren|b-?junioren|nextgen|next gen|pl2|premier league 2|reserves?|b team|ii|castilla|filial|jong (?:ajax|psv|az|utrecht|twente))\b/i;

/** False for women's, youth and reserve-team videos (the site is men's first teams only). */
export const isFirstTeam = (title) => !NOT_FIRST_TEAM_RE.test(deaccent(title));

const EXCLUDE_RE =
  /\b(press conference|konferencija za medije|pressekonferenz|conferenza stampa|rueda de prensa|conference de presse|iz drugog ugla|izjave|preview|reactions?|interview|vlogs?|vlogowe|kulisy|pitchside|tunnel|training|podcast|live stream|streamed|every goal|all goals|all highlights|top \d+|review|full match|legends|alt angle|behind the scenes|behind the tigers|in hd|cinematic|inside the match|members only|on the road|match cut|post-?match|pre-?match|watchalong|reacts?|carabao|fa cup|efl cup|copa del rey|coppa italia|dfb|pokal|coupe de france|taca|friendly|friendlies|amistoso|pre-?season|qualifiers?|qualification|qualifying|clasificacion|play-?off final|club world cup|futsal|beach|esports|efootball|fc 2[5-9]|#shorts)\b/i;

// Competition keywords in titles. Club and national-team channels post several
// competitions, so a title that names a different competition is skipped.
const COMP_HINTS = [
  ['PL', /\bpremier league\b(?! 2\b)|\bepl\b/i],
  ['PD', /\bla ?liga\b/i],
  ['SA', /\bserie a\b/i],
  ['BL1', /\bbundesliga\b(?!\s*2\b)/i],
  ['FL1', /\bligue 1\b/i],
  ['CL', /\bchampions league\b|\bucl\b/i],
  ['EL', /\beuropa league\b|\buel\b/i],
  ['ECL', /\bconference league\b|\buecl\b/i],
  ['UNL', /\bnations league\b|\bunl\b|\bliga de (?:las )?naciones\b|\bligue des nations\b|\bnationenliga\b|\bliga delle nazioni\b|\bliga narodow\b|\bliga naroda\b|\bliga nacija\b|\buluslar ligi\b|\bnemzetek ligaja\b|\bliga natiunilor\b|\bnationernes liga\b|\bnasjonsligaen\b|\bnationsligan\b|\bliga das nacoes\b|\bliga narodu\b|\bthjodadeild\b/i],
  ['WC', /\bworld cup\b/i],
  ['EC', /\beuros?\b(?!\s*league)(?:\s*20\d\d)?|\beuropean championship\b|\beurocopa\b/i],
];

/** Competition codes a title explicitly mentions (empty set = no hint). */
export function detectComps(title) {
  const t = title.normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/ø/gi, 'o').replace(/ł/g, 'l').replace(/ı/g, 'i');
  const out = new Set();
  for (const [code, re] of COMP_HINTS) if (re.test(t)) out.add(code);
  return out;
}

// Highlight words on federation channels in other languages (matched without accents).
const HIGHLIGHT_LOCAL_RE = /\b(sazetak|osszefoglalo|sestrih|hojdpunkter|hoydepunkter|hojdepunkter|hoejdepunkter|skrot|resumo|ozet|rezumat|povzetek|zostrih|samantekt|stigmiotypa|vrhunci)\b/i;
const deaccent = (s) => s.normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/ø/gi, 'o').replace(/ı/g, 'i');

// A scoreline between two names ("Everton 1-0 Ipswich", "OM - PSG (1-2)") marks a match
// video even when the title never says "highlights" (Ligue 1 and several clubs do this).
const SCORE_RE = /[a-z)]\s+\d{1,2}\s*[-–:]\s*\d{1,2}\s+[a-z(]|\(\d{1,2}\s*[-–:]\s*\d{1,2}\)/i;
const CLASSIC_RE = /\bclassics?\b/i;

/**
 * Cheap title-only pre-filter (before we spend quota on video details).
 * `fixtures: true` is for fixture-backed competitions: a video must be published after a
 * real kick-off between the two teams, so "classic" can't smuggle in an old match there
 * ("EXTENDED HIGHLIGHTS | Man City 5-3 Sunderland | A Premier League Classic").
 */
export function looksLikeMatchHighlight(title, { fixtures = false } = {}) {
  const t = deaccent(title);
  if (NOT_FIRST_TEAM_RE.test(t) || EXCLUDE_RE.test(t) || (!fixtures && CLASSIC_RE.test(t))) return false;
  return HIGHLIGHT_RE.test(t) || HIGHLIGHT_LOCAL_RE.test(t) || SCORE_RE.test(t);
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
 * True when the title puts a scoreline between the two team names ("Dortmund 2-3
 * Villarreal") that isn't the fixture's final score. That's another game between the same
 * clubs: a youth or women's match on the same day, or an older meeting. Titles with no
 * scoreline there, unfinished fixtures and shoot-outs are never rejected.
 */
export function scoreContradicts(normTitle, homeAlias, awayAlias, fixture) {
  const s = fixture.score;
  const fh = s?.fullTime?.home;
  const fa = s?.fullTime?.away;
  if (fixture.status !== 'FINISHED' || !Number.isInteger(fh) || !Number.isInteger(fa)) return false;
  if (s.penalties?.home != null || s.duration === 'PENALTY_SHOOTOUT') return false;
  const hi = normTitle.indexOf(` ${homeAlias} `);
  const ai = normTitle.indexOf(` ${awayAlias} `);
  if (hi < 0 || ai < 0) return false; // matched fuzzily: positions unknown
  const [first, firstAlias, second] = hi < ai ? [hi, homeAlias, ai] : [ai, awayAlias, hi];
  const between = normTitle.slice(first + firstAlias.length + 1, second + 1);
  const m = between.match(/^ (\d{1,2}) (\d{1,2}) $/);
  if (!m) return false;
  const [x, y] = [Number(m[1]), Number(m[2])];
  return hi < ai ? x !== fh || y !== fa : x !== fa || y !== fh;
}

/** Does a stored highlight still pass the title filters and the scoreline check for `f`? */
export function stillBelongs(h, f) {
  if (!looksLikeMatchHighlight(h.title, { fixtures: true })) return false;
  const t = normalize(h.title);
  const home = mentions(t, teamAliases(f.homeTeam));
  const away = mentions(t, teamAliases(f.awayTeam));
  return !(home && away && home !== away && scoreContradicts(t, home, away, f));
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
    if (!looksLikeMatchHighlight(v.title, { fixtures: true })) continue;
    const t = normalize(v.title);
    const published = Date.parse(v.publishedAt);

    let best = null;
    for (const f of fixtures) {
      const kickoff = Date.parse(f.utcDate);
      if (!(published >= kickoff && published <= kickoff + windowHours * 3600e3)) continue;
      let h = mentions(t, aliasesOf(f.homeTeam));
      let a = mentions(t, aliasesOf(f.awayTeam));
      let fuzzy = false;
      if (!h) { h = fuzzyMentions(t, aliasesOf(f.homeTeam)); fuzzy = true; }
      if (h && !a) { a = fuzzyMentions(t, aliasesOf(f.awayTeam)); fuzzy = true; }
      if (!h || !a || h === a) continue;
      if (scoreContradicts(t, h, a, f)) continue;
      // Prefer exact name matches over typo-tolerant ones, then the fixture whose names
      // matched most specifically, then the closest kick-off.
      const score = (fuzzy ? -1000 : 0) + h.length + a.length - (published - kickoff) / 3.6e9;
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
      classified.map(slimHighlight),
    );
  }
  return result;
}

/** The fields a highlight keeps in the published JSON. allow/block = YouTube country restrictions. */
export function slimHighlight({ videoId, title, channel, channelId, durationSec, publishedAt, kind, priority, allow, block }) {
  const h = { videoId, title, channel, channelId, durationSec, publishedAt, kind, priority: priority ?? 99 };
  if (allow?.length) h.allow = allow;
  if (block?.length) h.block = block;
  return h;
}

export const STAGE_LABELS = {
  LEAGUE_STAGE: 'League phase',
  GROUP_STAGE: 'Group stage',
  PLAYOFFS: 'Knockout play-offs',
  PROMOTION_RELEGATION: 'Promotion/relegation play-offs',
  PLAYOFF_ROUND: 'Play-off round',
  LAST_32: 'Round of 32',
  LAST_16: 'Round of 16',
  QUARTER_FINALS: 'Quarter-finals',
  SEMI_FINALS: 'Semi-finals',
  THIRD_PLACE: 'Third-place play-off',
  FINAL: 'Final',
};

/** Group fixtures into rounds ("Matchweek 5", "Group stage · MD 2", "Round of 16"). */
export function roundOf(fixture, roundLabel = 'Matchweek') {
  const stage = fixture.stage ?? 'REGULAR_SEASON';
  const md = fixture.matchday;
  if (stage === 'REGULAR_SEASON' && md) return { key: `md-${md}`, label: `${roundLabel} ${md}`, matchday: md };
  if ((stage === 'LEAGUE_STAGE' || stage === 'GROUP_STAGE') && md) {
    const prefix = stage === 'GROUP_STAGE' ? 'gs-' : '';
    return { key: `${prefix}md-${md}`, label: `${STAGE_LABELS[stage]} · MD ${md}`, matchday: md };
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
    // Highlights kept from earlier runs go through today's filters again, so a filter fix
    // also removes what the old rules let in.
    const kept = (prevMatch?.highlights ?? []).filter((h) => stillBelongs(h, f));
    const merged = [...new Map([...kept, ...fresh].map((h) => [h.videoId, h])).values()];
    rounds.get(r.key).matches.push({
      id: f.id,
      utcDate: f.utcDate,
      status: f.status,
      home: slimTeam(f.homeTeam),
      away: slimTeam(f.awayTeam),
      score: { home: f.score?.fullTime?.home ?? null, away: f.score?.fullTime?.away ?? null },
      highlights: classify(merged).sort(byKindThenPriority).map(slimHighlight),
    });
  }

  const files = sortFiles([...rounds.values()].map(({ round, matches }) => ({ competition: comp.code, season, round, matches })));
  return { index: indexFor(comp, season, files), files };
}

/** Sort matches inside a round and the rounds themselves by date. */
export function sortFiles(files) {
  for (const f of files) {
    f.matches.sort((a, b) => Date.parse(a.utcDate) - Date.parse(b.utcDate) || a.home.name.localeCompare(b.home.name));
  }
  return files.sort((a, b) => Date.parse(a.matches[0].utcDate) - Date.parse(b.matches[0].utcDate));
}

/** The competition's entry in index.json. */
export function indexFor(comp, season, files) {
  // Default round = latest one with any highlights (or finished matches).
  const played = files.filter((f) => f.matches.some((m) => m.highlights.length || m.status === 'FINISHED'));
  const current = (played[played.length - 1] ?? files[0])?.round.key ?? null;
  const tournament = comp.code === 'WC' || comp.code === 'EC';
  return {
    code: comp.code,
    name: comp.name,
    short: comp.short ?? comp.name,
    group: comp.group ?? 'league',
    country: comp.country,
    color: comp.color,
    season,
    seasonLabel: tournament ? String(season) : `${season}/${String(season + 1).slice(2)}`,
    currentRound: current,
    rounds: files.map((f) => ({
      key: f.round.key,
      label: f.round.label,
      firstDate: f.matches[0].utcDate,
      matches: f.matches.length,
      withHighlights: f.matches.filter((m) => m.highlights.length).length,
    })),
  };
}

/** Merge EMBED_BLOCKED countries into a video's allow/block lists. */
export function withEmbedBlocks(v, channelId, table = EMBED_BLOCKED) {
  const extra = table[channelId];
  if (!extra) return v;
  if (v.allow) {
    const allow = v.allow.filter((c) => !extra.includes(c));
    return { ...v, allow: allow.length ? allow : ['ZZ'] }; // ZZ: nowhere
  }
  return { ...v, block: [...new Set([...(v.block ?? []), ...extra])].sort() };
}
