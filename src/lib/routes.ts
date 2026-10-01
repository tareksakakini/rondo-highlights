// Real URLs for competitions and rounds, shared by the app (navigation, page
// titles) and the build (vite.config.ts prerenders one HTML page per URL).
//
//   /                                   home
//   /premier-league/                    a competition (the app opens its current round)
//   /premier-league/matchweek-5/        one round
//
// Slugs come from the round labels in the data, so a renamed round gets a new URL.
// Titles and descriptions never mention scores.

export const SITE = 'https://rondohighlights.com';
export const SITE_NAME = 'Rondo Highlights';

/** Fixed slugs for the competitions we know; anything else is slugified from its name. */
const COMP_SLUGS: Record<string, string> = {
  PL: 'premier-league',
  PD: 'la-liga',
  SA: 'serie-a',
  BL1: 'bundesliga',
  FL1: 'ligue-1',
  CL: 'champions-league',
  EL: 'europa-league',
  ECL: 'conference-league',
  UNL: 'nations-league',
  WC: 'world-cup',
  EC: 'euros',
};

interface CompLike { code: string; name: string; seasonLabel?: string }
interface RoundLike { key: string; label: string }

export function slugify(s: string): string {
  return s
    .normalize('NFKD').replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/\bmd\b/g, 'matchday')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

export const compSlug = (c: CompLike) => COMP_SLUGS[c.code] ?? slugify(c.name);

/** Slug for each round of a competition, unique within it (keyed by round key). */
export function roundSlugs(rounds: RoundLike[]): Map<string, string> {
  const out = new Map<string, string>();
  const used = new Set<string>();
  for (const r of rounds) {
    let s = slugify(r.label) || slugify(r.key);
    if (used.has(s)) s = `${s}-${slugify(r.key)}`;
    used.add(s);
    out.set(r.key, s);
  }
  return out;
}

export const compPath = (c: CompLike) => `/${compSlug(c)}/`;

export function roundPath(c: CompLike & { rounds: RoundLike[] }, roundKey: string): string {
  const s = roundSlugs(c.rounds).get(roundKey);
  return s ? `${compPath(c)}${s}/` : compPath(c);
}

/** "League phase · MD 1" -> "League phase Matchday 1", for running text. */
export const roundName = (label: string) => label.replace(/\bMD\b/g, 'Matchday').replace(/\s*·\s*/g, ' ');

export interface Route {
  /** Competition code, or null for the home page. */
  code: string | null;
  /** Round key, or null for a competition page (its current round is shown). */
  round: string | null;
}

/** Which competition/round a path names; null if it names none. */
export function resolvePath(competitions: (CompLike & { rounds: RoundLike[] })[], pathname: string): Route | null {
  const parts = pathname.split('/').filter(Boolean).map((p) => decodeURIComponent(p).toLowerCase());
  if (parts.length === 0) return { code: null, round: null };
  const comp = competitions.find((c) => compSlug(c) === parts[0]);
  if (!comp || parts.length > 2) return null;
  if (parts.length === 1) return { code: comp.code, round: null };
  for (const [key, slug] of roundSlugs(comp.rounds)) if (slug === parts[1]) return { code: comp.code, round: key };
  return null;
}

/** Old links looked like #/PL/md-5. */
export function legacyHash(hash: string): Route | null {
  const m = hash.match(/^#\/([A-Z0-9]+)(?:\/([\w-]+))?/);
  return m ? { code: m[1], round: m[2] ?? null } : null;
}

// ---- titles and descriptions ----

export interface Head { title: string; description: string; path: string }

const HOME_DESCRIPTION =
  'Watch a whole matchweek of football highlights back to back: Premier League, La Liga, Serie A, Bundesliga, ' +
  'Ligue 1, Champions League, Europa League, Nations League and the World Cup. Official highlights from YouTube, short or extended, with a spoiler-free mode.';

export const homeHead = (): Head => ({
  title: `${SITE_NAME} · Football highlights, back to back`,
  description: HOME_DESCRIPTION,
  path: '/',
});

export const compHead = (c: CompLike): Head => ({
  title: `${c.name} highlights${c.seasonLabel ? ` ${c.seasonLabel}` : ''}, round by round | ${SITE_NAME}`,
  description:
    `Watch ${c.name} highlights round by round: every match of the round back to back, from official YouTube channels. ` +
    'Short or extended cuts, with a spoiler-free mode.',
  path: compPath(c),
});

/** `fixtures` are "Home v Away" strings, in kick-off order. */
export function roundHead(c: CompLike & { rounds: RoundLike[] }, r: RoundLike, fixtures: string[]): Head {
  const name = `${c.name} ${roundName(r.label)}`;
  const some = fixtures.slice(0, 3).join(', ');
  const more = fixtures.length > 3 ? ` and ${fixtures.length - 3} more` : '';
  return {
    title: `${name} highlights${c.seasonLabel ? ` (${c.seasonLabel})` : ''} | ${SITE_NAME}`,
    description:
      `Every ${name} match back to back${some ? `: ${some}${more}` : ''}. ` +
      'Official highlights from YouTube, short or extended, with a spoiler-free mode.',
    path: roundPath(c, r.key),
  };
}

/** The page's main heading (visible on prerendered pages, screen-reader-only in the app). */
export const roundHeading = (c: CompLike, r: RoundLike) => `${c.name} ${roundName(r.label)} highlights`;
export const compHeading = (c: CompLike) => `${c.name} highlights`;
