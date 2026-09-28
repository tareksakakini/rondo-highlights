// Rondo Highlights ingestion config: competitions and the YouTube channels we trust.
//
// GLOBAL AUDIENCE: we keep every embeddable video, whatever country it's limited
// to, and record its country restrictions. The site then picks, per visitor, a
// cut that actually plays in their country. So the channel lists mix:
//   - rights-holder broadcasters (often one country only, usually the best/extended cuts)
//   - official league / federation / club / national-team channels (usually worldwide)
//
// Channels are listed in PRIORITY order per competition: when a match has several
// playable videos of the same length, the earliest channel wins.
//
// `mustMatch`: regex a title must satisfy for that channel (multi-sport or
// multi-competition channels). Club and national-team channels are shared across
// competitions; for them we rely on competition keywords in titles (see detectComps
// in lib/match.mjs) plus the fixture's teams and date.
//
// Handles that don't resolve are skipped with a warning. All handles below were
// resolved on 2026-09-27; add more clubs/federations to improve coverage.

// ---------------------------------------------------------------- channel pools
const ch = (handle, extra = {}) => ({ handle, tier: 'broadcaster', ...extra });

/** Premier League clubs (2026/27) with official channels we could verify. */
export const PL_CLUBS = [
  '@arsenal', '@avfcofficial', '@afcbournemouth', '@BrentfordFC', '@OfficialBHAFC', '@chelseafc',
  '@CoventryCityFC', '@OfficialCPFC', '@Everton', '@FulhamFC', '@hullcityofficial', '@IpswichTown',
  '@LeedsUnited', '@LiverpoolFC', '@mancity', '@manutd', '@NUFC', '@NottinghamForestFC',
  '@SunderlandAFC', '@TottenhamHotspur',
].map((h) => ch(h, { tier: 'club' }));

/** Big European clubs: their channels carry UCL/UEL highlights worldwide. */
export const EURO_CLUBS = [
  '@realmadrid', '@fcbarcelona', '@atleticodemadrid', '@RealBetis', '@VillarrealCF',
  '@fcbayern', '@BVB', '@RBLeipzig', '@VfB', '@Eintracht',
  '@PSG', '@OM_Officiel', '@OlympiqueLyonnais', '@LOSC', '@ASMonaco',
  '@juventus', '@inter', '@acmilan', '@sscnapoli', '@ASRoma', '@AtalantaBC',
  '@SLBenfica', '@fcporto', '@SportingCP', '@AFCAjax', '@PSV', '@Feyenoord',
  '@CelticFC', '@RangersFC', '@Galatasaray', '@Fenerbahce', '@ClubBrugge',
].map((h) => ch(h, { tier: 'club' }));

/** National-team / federation channels (Nations League, Euros, World Cup). */
export const NATIONS = [
  '@England', '@DFB', '@SeFutbol', '@FFF', '@OnsOranje', '@FAWales', '@ScotlandNationalTeam',
  '@LaczyNasPilka', '@OEFB', '@nazionaledicalcio', '@FPF.Oficial', '@royalbelgianfa', '@hns.family',
  '@DBUTV', '@norges.fotballforbund', '@svenskfotboll', '@sfvasf', '@MLSZTV', '@FAITV', '@OfficialIrishFA',
  '@FRFTVofficial', '@FSSrbije', '@sfzofficial', '@nzssi', '@TFF', '@uafukraine', '@EthnikiOmada', '@footballiceland',
].map((h) => ch(h, { tier: 'nation' }));

// ---------------------------------------------------------------- competitions
// source: 'fixtures' → fixtures from football-data.org (free tier), videos matched to them
//         'videos'   → no free fixture feed: matches are discovered from highlight titles
// archive: finished tournament; only ingested when missing or requested (--only=WC)
// optional: skipped quietly if football-data.org says the plan doesn't include it

export const COMPETITIONS = [
  {
    code: 'PL', name: 'Premier League', short: 'Premier League', country: 'England', color: '#8B5CF6',
    group: 'league', roundLabel: 'Matchweek', source: 'fixtures',
    channels: [ch('@NBCSports', { mustMatch: 'premier league' }), ch('@SkySportsPremierLeague'), ch('@TNTSportsFootball', { mustMatch: 'premier league' }), ...PL_CLUBS],
  },
  {
    code: 'PD', name: 'La Liga', short: 'La Liga', country: 'Spain', color: '#F97316',
    group: 'league', roundLabel: 'Matchweek', source: 'fixtures',
    channels: [ch('@ESPNFC', { mustMatch: 'laliga|la liga' }), ch('@LaLiga'), ...EURO_CLUBS],
  },
  {
    code: 'SA', name: 'Serie A', short: 'Serie A', country: 'Italy', color: '#0EA5E9',
    group: 'league', roundLabel: 'Matchweek', source: 'fixtures',
    channels: [ch('@CBSSportsGolazo', { mustMatch: 'serie a' }), ch('@seriea'), ...EURO_CLUBS],
  },
  {
    code: 'BL1', name: 'Bundesliga', short: 'Bundesliga', country: 'Germany', color: '#EF4444',
    group: 'league', roundLabel: 'Matchday', source: 'fixtures',
    channels: [ch('@bundesliga', { mustMatch: 'bundesliga(?!\\s*2\\b)' }), ...EURO_CLUBS],
  },
  {
    code: 'FL1', name: 'Ligue 1', short: 'Ligue 1', country: 'France', color: '#22C55E',
    group: 'league', roundLabel: 'Matchweek', source: 'fixtures',
    channels: [ch('@beINSPORTSUSA', { mustMatch: 'ligue 1' }), ch('@Ligue1'), ...EURO_CLUBS],
  },
  {
    code: 'CL', name: 'Champions League', short: 'Champions League', country: 'Europe', color: '#3B82F6',
    group: 'europe', roundLabel: 'Matchday', source: 'fixtures',
    channels: [ch('@CBSSportsGolazo', { mustMatch: '\\bucl\\b|champions league' }), ch('@TNTSportsFootball', { mustMatch: 'champions league' }), ...PL_CLUBS, ...EURO_CLUBS],
  },
  {
    code: 'EL', name: 'Europa League', short: 'Europa League', country: 'Europe', color: '#F59E0B',
    group: 'europe', roundLabel: 'Matchday', source: 'videos',
    channels: [ch('@CBSSportsGolazoEurope', { mustMatch: '\\buel\\b|europa league' }), ch('@TNTSportsFootball', { mustMatch: 'europa league' }), ...PL_CLUBS, ...EURO_CLUBS],
  },
  {
    code: 'UNL', name: 'UEFA Nations League', short: 'Nations League', country: 'Europe', color: '#14B8A6',
    group: 'national', roundLabel: 'Matchday', source: 'videos',
    channels: [ch('@FOXSports', { mustMatch: 'nations league' }), ch('@FOXSoccer', { mustMatch: 'nations league' }), ...NATIONS],
  },
  {
    code: 'WC', name: 'FIFA World Cup', short: 'World Cup', country: 'World', color: '#E11D48',
    group: 'national', roundLabel: 'Matchday', source: 'fixtures', season: 2026,
    archive: true, since: '2026-06-01', maxPages: 80,
    // FOX held the US rights and posted highlights on @FOXSports; FIFA's own uploads refuse
    // embeds in the US even though the Data API reports them as playable everywhere.
    channels: [ch('@FOXSports', { mustMatch: 'world cup' }), ch('@FOXSoccer', { mustMatch: 'world cup' }), ch('@FIFA', { mustMatch: 'world cup' }), ...NATIONS],
  },
  {
    code: 'EC', name: 'UEFA European Championship', short: 'Euros', country: 'Europe', color: '#6366F1',
    group: 'national', roundLabel: 'Matchday', source: 'fixtures', optional: true,
    channels: [ch('@FOXSoccer', { mustMatch: '\\beuro\\b' }), ch('@UEFA', { mustMatch: '\\beuro 20\\d\\d\\b' }), ...NATIONS],
  },
];

// How long after kick-off we accept a highlight upload.
export const MATCH_WINDOW_HOURS = 24 * 5;

// How far back to scan channel uploads on a normal run (override with --since).
export const DEFAULT_LOOKBACK_DAYS = 10;

// Safety cap on pages (50 videos each) read per channel per run.
export const MAX_PAGES_PER_CHANNEL = 12;

/**
 * Countries where a channel's uploads refuse to play in embeds (player error 150) even
 * though the Data API reports no restriction. Found by testing on the live site; merged
 * into each video's allow/block lists at ingest. Keyed by channel id.
 */
export const EMBED_BLOCKED = {
  UCpcTrCXblq78GZrTUTLWeBw: ['US'], // FIFA: World Cup 2026 highlights (checked 2026-09-28)
};
