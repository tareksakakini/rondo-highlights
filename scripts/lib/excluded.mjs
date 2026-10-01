// Teams whose matches are left out of the site entirely. The list lives in
// excluded-teams.json beside this file; the app (src/lib/excluded.ts) imports the same one.
import list from './excluded-teams.json' with { type: 'json' };

const NAME_RE = new RegExp(list.namePattern, 'i');
const TLAS = new Set(list.tlas);

/** A team from football-data/Highlightly ({name, shortName, tla}) or a stored one ({name, short, tla}). */
export function isExcludedTeam(t) {
  if (!t) return false;
  return TLAS.has(String(t.tla ?? '').toUpperCase()) || [t.name, t.shortName, t.short].some((n) => n && NAME_RE.test(n));
}

/** A fixture (homeTeam/awayTeam) or a stored match (home/away). */
export function isExcludedMatch(m) {
  return isExcludedTeam(m.homeTeam ?? m.home) || isExcludedTeam(m.awayTeam ?? m.away);
}
