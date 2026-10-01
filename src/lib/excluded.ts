import type { Match, Team } from '../types';
import list from '../../scripts/lib/excluded-teams.json';

// Same list as scripts/lib/excluded.mjs, which drops these matches at ingest. Filtering here
// too keeps them off the site before the next data refresh and out of a saved queue.
const NAME_RE = new RegExp(list.namePattern, 'i');
const TLAS = new Set(list.tlas);

export const isExcludedTeam = (t: Team) =>
  TLAS.has(t.tla?.toUpperCase()) || [t.name, t.short].some((n) => n && NAME_RE.test(n));

export const isExcludedMatch = (m: Match) => isExcludedTeam(m.home) || isExcludedTeam(m.away);
