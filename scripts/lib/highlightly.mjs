// Highlightly (soccer.highlightly.net) → football-data.org-shaped fixtures.
//
// football-data.org's free tier has no Europa League or Nations League, so those two
// competitions take their fixtures from Highlightly's free plan (100 requests/day).
// Everything downstream (matchVideosToFixtures, buildCompetition) expects the
// football-data shape, so this module only translates. Pure functions, no I/O;
// covered by tests/highlightly.test.mjs.

import { normalize, nationFor } from './match.mjs';
import { NATIONS } from './teams.mjs';
import { makeRegistry } from './videos.mjs';

// Words too common to identify a club on their own ("Real", "Sporting", "Union"...).
const GENERIC = new Set([
  'real', 'sporting', 'union', 'united', 'city', 'club', 'athletic', 'atletico', 'dinamo', 'dynamo',
  'olympique', 'olympic', 'racing', 'sport', 'sports', 'saint', 'young', 'boys', 'rapid', 'red', 'star',
  'football', 'futbol', 'calcio', 'national', 'team', 'royal', 'stade', 'lokomotiv', 'spartak', 'slavia',
  'hapoel', 'maccabi', 'shakhtar', 'zenit', 'deportivo', 'wanderers', 'rovers', 'county', 'town', 'albion',
  'villa', 'borussia', 'eintracht', 'hertha', 'viktoria', 'sparta', 'inter', 'milan', 'roma', 'torino',
  'north', 'south', 'east', 'west', 'republic', 'new', 'san', 'santa', 'nacional', 'crvena', 'zvezda',
]);

// Club-type abbreviations that say nothing about which club it is.
const CLUB_PREFIXES = new Set(['AFC', 'SSC', 'TSG', 'VFB', 'VFL', 'RCD', 'OSC', 'BSC', 'KRC', 'RSC', 'HNK', 'GNK', 'FSV', 'SPAL']);

/** "League Stage - 8" → { stage, matchday }; qualifying rounds → null (not shown on the site). */
export function parseRound(round, utcDate, season) {
  const r = String(round ?? '').trim();
  const lower = r.toLowerCase();
  let m;
  if ((m = lower.match(/^(?:league stage|league phase|league [a-d])\s*-\s*(\d+)$/))) {
    return { stage: 'LEAGUE_STAGE', matchday: Number(m[1]) };
  }
  if (/qualif|preliminary/.test(lower)) return null;
  // A "play-off" before the league phase is the last qualifying round (August).
  const beforeLeaguePhase = utcDate && Date.parse(utcDate) < Date.UTC(season, 8, 1);
  if (/play-?offs?/.test(lower) && beforeLeaguePhase) return null;
  if (/relegation|promotion/.test(lower)) return { stage: 'PROMOTION_RELEGATION' };
  if (/knockout|play-?offs?/.test(lower)) return { stage: 'PLAYOFFS' };
  if (/round of 32|last 32|1\/16/.test(lower)) return { stage: 'LAST_32' };
  if (/round of 16|last 16|8th finals|1\/8/.test(lower)) return { stage: 'LAST_16' };
  if (/quarter/.test(lower)) return { stage: 'QUARTER_FINALS' };
  if (/semi/.test(lower)) return { stage: 'SEMI_FINALS' };
  if (/3rd|third/.test(lower)) return { stage: 'THIRD_PLACE' };
  if (/\bfinal\b/.test(lower)) return { stage: 'FINAL' };
  if (!r) return beforeLeaguePhase ? null : { stage: 'OTHER' };
  return { stage: r.toUpperCase().replace(/[^A-Z0-9]+/g, '_').replace(/^_|_$/g, '') };
}

/** Highlightly's state.description → football-data status. */
export function parseStatus(description) {
  const d = String(description ?? '').toLowerCase();
  if (/finished|after extra time|after penalties|^ft$|^aet$|^pen/.test(d)) return 'FINISHED';
  if (/not started|scheduled|to be (?:defined|announced)|^tbd$|^ns$/.test(d) || !d) return 'TIMED';
  if (/postponed/.test(d)) return 'POSTPONED';
  if (/cancel/.test(d)) return 'CANCELLED';
  if (/abandon|suspend|interrupt/.test(d)) return 'SUSPENDED';
  if (/half[- ]?time|^ht$|break/.test(d)) return 'PAUSED';
  return 'IN_PLAY';
}

/** "2 - 1" → { home: 2, away: 1 } (nulls when there's no score yet). */
export function parseScore(current) {
  const m = String(current ?? '').match(/(\d+)\s*[-–:]\s*(\d+)/);
  return m ? { home: Number(m[1]), away: Number(m[2]) } : { home: null, away: null };
}

const stripNational = (name) => String(name ?? '').replace(/\s+(?:national\s+team|nt)$/i, '').trim();

/** Distinctive single words of a club name ("Hapoel Beer Sheva" → ["beer", "sheva"]). */
function distinctiveWords(name) {
  return normalize(name).trim().split(' ').filter((w) => w.length >= 5 && !GENERIC.has(w) && !/^\d+$/.test(w));
}

// Core of a club name for comparisons: normalized, without short noise words (FC, AC, de...).
const core = (s) => normalize(s).trim().split(' ').filter((w) => w.length > 3).join(' ');

/** Guard against loose registry hits ("Inter Turku" must not borrow Inter Milan's identity). */
function sameClub(raw, fd) {
  const a = core(raw);
  if (!a) return false;
  return [fd.short, fd.name].some((n) => {
    const b = core(n);
    if (!b) return false;
    if (a === b) return true;
    const contained = a.includes(b) || b.includes(a);
    return contained && Math.min(a.length, b.length) / Math.max(a.length, b.length) >= 0.5;
  });
}

/**
 * Turn a Highlightly team into a football-data-style team.
 * National teams get the canonical NATIONS entry (name, code, aliases in other languages).
 * Clubs borrow the name, TLA and crest of the same club from football-data when we know it
 * (so the club nickname table in match.mjs applies), plus their distinctive words as aliases.
 */
export function toTeam(t, { national, clubRegistry } = {}) {
  const raw = stripNational(t?.name);
  if (!raw || /^(?:tbd|tba|to be (?:defined|decided|announced))$/i.test(raw)) return null;
  const logo = t.logo ?? null;
  if (national) {
    const n = nationFor(raw);
    if (n) return { id: `n:${n.tla}`, name: n.name, shortName: n.shortName, tla: n.tla, crest: logo, national: true, extraAliases: n.extraAliases };
    return { id: t.id ?? raw, name: raw, shortName: raw, tla: raw.replace(/[^A-Za-z]/g, '').slice(0, 3).toUpperCase(), crest: logo, national: true, extraAliases: [] };
  }
  const known = clubRegistry?.(raw);
  const fd = known && !known.key.startsWith('x:') && sameClub(raw, known) ? known : null;
  // Acronyms in the name are what titles often use on their own ("NEC", "OFI", "PAOK").
  const acronyms = raw.split(/\s+/).filter((w) => /^[A-Z]{3,4}$/.test(w) && !CLUB_PREFIXES.has(w));
  const extraAliases = [...new Set([raw, ...distinctiveWords(raw), ...acronyms, ...(fd ? [fd.name, fd.short] : [])])];
  return {
    id: t.id ?? raw,
    name: raw,
    shortName: fd?.short && normalize(fd.short).length <= normalize(raw).length ? fd.short : raw,
    tla: fd?.tla ?? raw.replace(/[^A-Za-z]/g, '').slice(0, 3).toUpperCase(),
    crest: logo ?? fd?.crest ?? null,
    extraAliases,
  };
}

/**
 * Highlightly matches → football-data fixtures ({ id, utcDate, status, stage, matchday,
 * homeTeam, awayTeam, score.fullTime }). Qualifying rounds and TBD pairings are dropped.
 * `knownTeams` = clubs from the football-data competitions (for names/crests/aliases).
 */
export function toFixtures(matches, { season, national = false, knownTeams = [] } = {}) {
  const clubRegistry = national ? null : makeRegistry(knownTeams, { nations: false, clubs: true });
  const out = [];
  for (const m of matches ?? []) {
    if (!m?.id || !m.date) continue;
    const round = parseRound(m.round, m.date, season);
    if (!round) continue;
    const homeTeam = toTeam(m.homeTeam, { national, clubRegistry });
    const awayTeam = toTeam(m.awayTeam, { national, clubRegistry });
    if (!homeTeam || !awayTeam) continue;
    const status = parseStatus(m.state?.description);
    const score = parseScore(m.state?.score?.current);
    out.push({
      id: m.id,
      utcDate: new Date(m.date).toISOString().replace('.000Z', 'Z'),
      status,
      ...round,
      homeTeam,
      awayTeam,
      score: { fullTime: status === 'TIMED' ? { home: null, away: null } : score },
    });
  }
  return out;
}

// Re-exported so tests can check the nation list covers what Highlightly sends.
export { NATIONS };
