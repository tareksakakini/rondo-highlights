// Rondo ingestion config — competitions and the YouTube channels we trust for each.
//
// Channels are listed in PRIORITY order: when a match has several videos of the
// same length class, the one from the earliest channel wins (the others are kept
// as fallbacks in case a video fails to embed).
//
// `mustMatch` is an optional regex a video title must satisfy for that channel,
// used for multi-sport / multi-competition channels (NBC Sports posts NFL too,
// CBS Sports Golazo posts both UCL and Serie A).
//
// Rights differ by country. This list targets US viewers (2026/27 season).
// Handles that don't resolve are skipped with a warning, so it's safe to add
// speculative ones. Add club channels to improve "short" coverage.

export const REGION = 'US';

export const COMPETITIONS = [
  {
    code: 'PL',
    name: 'Premier League',
    country: 'England',
    color: '#8B5CF6',
    roundLabel: 'Matchweek',
    channels: [
      { handle: '@NBCSports', mustMatch: 'premier league' },
      { handle: '@premierleague' },
      // Clubs (short + extended cuts; some disable embedding — the script checks)
      { handle: '@arsenal' }, { handle: '@avfcofficial' }, { handle: '@chelseafc' },
      { handle: '@Everton' }, { handle: '@LiverpoolFC' }, { handle: '@mancity' },
      { handle: '@manutd' }, { handle: '@NUFC' }, { handle: '@TottenhamHotspur' },
      { handle: '@CoventryCityFC' },
    ],
  },
  {
    code: 'PD',
    name: 'La Liga',
    country: 'Spain',
    color: '#F97316',
    roundLabel: 'Matchweek',
    channels: [
      { handle: '@ESPNFC', mustMatch: 'laliga|la liga' },
      { handle: '@LaLiga' },
    ],
  },
  {
    code: 'SA',
    name: 'Serie A',
    country: 'Italy',
    color: '#0EA5E9',
    roundLabel: 'Matchweek',
    channels: [
      { handle: '@CBSSportsGolazo', mustMatch: 'serie a' },
      { handle: '@seriea' },
    ],
  },
  {
    code: 'BL1',
    name: 'Bundesliga',
    country: 'Germany',
    color: '#EF4444',
    roundLabel: 'Matchday',
    channels: [
      { handle: '@bundesliga', mustMatch: 'bundesliga(?!\\s*2\\b)' },
    ],
  },
  {
    code: 'FL1',
    name: 'Ligue 1',
    country: 'France',
    color: '#22C55E',
    roundLabel: 'Matchweek',
    channels: [
      { handle: '@beINSPORTSUSA', mustMatch: 'ligue 1' },
      { handle: '@Ligue1' },
    ],
  },
  {
    code: 'CL',
    name: 'Champions League',
    country: 'Europe',
    color: '#3B82F6',
    roundLabel: 'Matchday',
    channels: [
      { handle: '@CBSSportsGolazo', mustMatch: 'ucl|champions league' },
    ],
  },
];

// How long after kick-off we accept a highlight upload.
export const MATCH_WINDOW_HOURS = 24 * 5;

// How far back to scan channel uploads on a normal run (override with --since).
export const DEFAULT_LOOKBACK_DAYS = 10;

// Safety cap on pages (50 videos each) read per channel per run.
export const MAX_PAGES_PER_CHANNEL = 12;
