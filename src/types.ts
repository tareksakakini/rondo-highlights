export type Kind = 'short' | 'extended';

export interface Highlight {
  videoId: string;
  title: string;
  channel: string;
  channelId?: string;
  durationSec: number;
  publishedAt: string;
  kind: Kind;
  priority?: number;
}

export interface Team {
  name: string;
  short: string;
  tla: string;
  crest: string | null;
}

export interface Match {
  id: number;
  utcDate: string;
  status: string;
  home: Team;
  away: Team;
  score: { home: number | null; away: number | null };
  highlights: Highlight[];
}

export interface RoundMeta {
  key: string;
  label: string;
  firstDate: string;
  matches: number;
  withHighlights: number;
}

export interface Competition {
  code: string;
  name: string;
  country: string;
  color: string;
  season: number;
  seasonLabel: string;
  currentRound: string | null;
  rounds: RoundMeta[];
  source: 'live' | 'sample';
}

export interface DataIndex {
  generatedAt: string;
  source: 'live' | 'sample' | 'mixed';
  competitions: Competition[];
}

export interface RoundFile {
  competition: string;
  season: number;
  round: { key: string; label: string };
  matches: Match[];
}

/** One entry in the play order: a match (not a video) — the video is picked at play time. */
export interface PlayItem {
  uid: string;
  match: Match;
  comp: { code: string; name: string; color: string };
  roundLabel: string;
  /** Pinned length for this item; otherwise the global preference applies. */
  kind?: Kind;
}
