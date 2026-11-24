import type { Competition, DataIndex, Match, RoundFile, Team } from '../types';
import { fetchRound } from './data';

// The favorites digest ("★ My teams"): your teams' matches from every competition,
// grouped the way football is played. Leagues play Friday to Monday and the European
// cups Tuesday to Thursday, so each group ("slate") is a weekend or a midweek, in the
// viewer's own time zone.

/** One of your teams' matches, with where it comes from. */
export interface TeamMatch {
  match: Match;
  comp: Competition;
  roundLabel: string;
}

export interface Slate {
  /** Midnight starting the slate (a Friday or a Tuesday), as a sortable key. */
  start: number;
  kind: 'weekend' | 'midweek';
  /** The slate that is going on now (or, on none, the one coming next). */
  current: boolean;
  /** Your first team's matches first, then your second's…; each team's in kick-off order. */
  matches: TeamMatch[];
}

const DAY = 864e5;
/** How far back the digest goes. */
export const DIGEST_DAYS = 28;
/** How far ahead to read: the rest of the slate going on now (a weekend runs Friday to Monday). */
const AHEAD_DAYS = 4;

/** The slate a kick-off falls in: Fri-Mon is a weekend, Tue-Thu a midweek. */
export function slateOf(utc: string): { start: number; kind: Slate['kind'] } {
  const d = new Date(utc);
  const day = d.getDay(); // 0 Sunday … 6 Saturday
  const back = day === 5 ? 0 : day === 6 ? 1 : day === 0 ? 2 : day === 1 ? 3 : day - 2; // to Friday, or to Tuesday
  const start = new Date(d.getFullYear(), d.getMonth(), d.getDate() - back).getTime();
  return { start, kind: day >= 2 && day <= 4 ? 'midweek' : 'weekend' };
}

/**
 * Group matches into slates, newest first. A match between two of your teams is listed
 * once. Slates entirely in the future are left out. `teams`, in
 * your order, orders each slate: a match counts for the higher of its two teams.
 */
export function groupSlates(all: TeamMatch[], teams: string[] = [], now = Date.now()): Slate[] {
  const seen = new Set<string>();
  const byStart = new Map<number, Slate>();
  const nowSlate = slateOf(new Date(now).toISOString()).start;
  for (const tm of [...all].sort((a, b) => a.match.utcDate.localeCompare(b.match.utcDate))) {
    const key = `${tm.comp.code}:${tm.match.id}`;
    if (seen.has(key)) continue;
    seen.add(key);
    const { start, kind } = slateOf(tm.match.utcDate);
    if (start > nowSlate) continue;
    let s = byStart.get(start);
    if (!s) byStart.set(start, (s = { start, kind, current: start === nowSlate, matches: [] }));
    s.matches.push(tm);
  }
  const rank = (tm: TeamMatch) => {
    const r = [teams.indexOf(teamId(tm.match.home)), teams.indexOf(teamId(tm.match.away))].filter((i) => i >= 0);
    return r.length ? Math.min(...r) : teams.length;
  };
  // Stable: matches arrive in kick-off order, so each team's stay that way.
  for (const s of byStart.values()) s.matches.sort((a, b) => rank(a) - rank(b));
  return [...byStart.values()].sort((a, b) => b.start - a.start);
}

const roundIndex = (c: Competition) => c.rounds.findIndex((r) => r.key === c.currentRound);
/** A competition's rounds that hold matches (rounds without fixtures have no file). */
const withFiles = (c: Competition) => c.rounds.filter((r) => r.matches > 0);

/** A competition's current round and the one before (those that hold matches). */
const recentKeys = (c: Competition) => {
  const i = roundIndex(c);
  return i < 0 ? [] : [c.rounds[i], c.rounds[i - 1]].filter((r) => r?.matches).map((r) => r.key);
};

/**
 * The rounds the team picker lists teams from: each club competition's current round
 * and the one before (every club plays in those), and every round of the national
 * competitions. Those are tournaments and groups that don't all play each matchday,
 * and the World Cup is an archive whose current round is its final, so their recent
 * rounds would miss most teams. Round files are cached for good, so a repeat visit
 * costs nothing.
 */
export async function loadPickerRounds(index: DataIndex): Promise<{ comp: Competition; file: RoundFile }[]> {
  const keys = (c: Competition) => (c.group === 'national' ? withFiles(c).map((r) => r.key) : recentKeys(c));
  const wanted = index.competitions.flatMap((c) => keys(c).map((key) => ({ c, key })));
  const got = await Promise.allSettled(wanted.map(({ c, key }) => fetchRound(c.code, key).then((file) => ({ comp: c, file }))));
  return got.flatMap((r) => (r.status === 'fulfilled' ? [r.value] : []));
}

/** Who a team is across competitions: its football-data name (a Highlightly club's `key`), what your teams are saved as. */
export const teamId = (t: Team) => t.key ?? t.name;
const hasTeam = (m: Match, teams: Set<string>) => teams.has(teamId(m.home)) || teams.has(teamId(m.away));

/**
 * Your teams' matches from DIGEST_DAYS back to AHEAD_DAYS ahead. Only club competitions
 * whose recent rounds include one of your teams are read further, each as soon as its
 * own recent rounds are in (not once every competition's are). National competitions
 * are read over the window whatever their recent rounds hold: a national team can sit
 * out a matchday, and the picker lists every team from every round. Rounds files are
 * cached for good, so a repeat visit costs nothing.
 */
export async function loadTeamMatches(index: DataIndex, teams: string[], now = Date.now()): Promise<TeamMatch[]> {
  const set = new Set(teams);
  const from = now - DIGEST_DAYS * DAY;
  const to = now + AHEAD_DAYS * DAY;
  const settled = <T,>(ps: Promise<T>[]) => Promise.allSettled(ps).then((got) => got.flatMap((r) => (r.status === 'fulfilled' ? [r.value] : [])));
  const perComp = await Promise.all(index.competitions.map(async (c) => {
    if (c.group !== 'national') {
      const recent = await settled(recentKeys(c).map((key) => fetchRound(c.code, key)));
      if (!recent.some((file) => file.matches.some((m) => hasTeam(m, set)))) return [];
    }
    const rounds = withFiles(c);
    // A round can start before the window and still have matches in it: take the one before too.
    const first = rounds.findIndex((r) => Date.parse(r.firstDate) >= from);
    if (first < 0) return [];
    const keys = rounds.slice(Math.max(0, first - 1)).filter((r) => Date.parse(r.firstDate) < to).map((r) => r.key);
    const files = await settled(keys.map((key) => fetchRound(c.code, key)));
    return files.flatMap((file) => file.matches
      .filter((m) => hasTeam(m, set) && Date.parse(m.utcDate) >= from && Date.parse(m.utcDate) < to)
      .map((m) => ({ match: m, comp: c, roundLabel: file.round.label })));
  }));
  return perComp.flat();
}

export interface PickerGroup {
  /** A competition's code, or `intl` for the national teams. */
  key: string;
  name: string;
  /** What the heading's mark shows: a competition's flag or star, or a globe (`country: 'World'`). */
  mark: Pick<Competition, 'country' | 'color'>;
  teams: Team[];
}

/**
 * Every team in the data, for the picker, each listed once. Clubs go under their league
 * when they play in one, else under the first cup they appear in. National teams are one
 * group, "International", whichever national competitions they play in (after the
 * leagues and cups).
 */
export function teamDirectory(rounds: { comp: Competition; file: RoundFile }[], competitions: Competition[]): PickerGroup[] {
  const rank = (c: Competition) => (c.group === 'europe' ? 100 : 0) + competitions.indexOf(c);
  const clubs = new Map<string, { comp: Competition; team: Team }>();
  const nations = new Map<string, Team>();
  for (const { comp, file } of rounds) {
    for (const m of file.matches) {
      for (const t of [m.home, m.away]) {
        const id = teamId(t);
        if (comp.group === 'national') { if (!nations.has(id)) nations.set(id, t); continue; }
        const was = clubs.get(id);
        if (!was || rank(comp) < rank(was.comp)) clubs.set(id, { comp, team: t });
      }
    }
  }
  const byName = (a: Team, b: Team) => (a.short || a.name).localeCompare(b.short || b.name);
  const groups: PickerGroup[] = competitions.filter((c) => c.group !== 'national').sort((a, b) => rank(a) - rank(b))
    .map((comp) => ({ key: comp.code, name: comp.short ?? comp.name, mark: comp, teams: [...clubs.values()].filter((h) => h.comp === comp).map((h) => h.team).sort(byName) }));
  const national = competitions.find((c) => c.group === 'national');
  if (national) groups.push({ key: 'intl', name: 'International', mark: { country: 'World', color: national.color }, teams: [...nations.values()].sort(byName) });
  return groups.filter((g) => g.teams.length);
}

/** For search: lower case, no accents ("Atlético" matches "atletico"). */
export const fold = (s: string) => s.normalize('NFKD').replace(/[̀-ͯ]/g, '').toLowerCase();
