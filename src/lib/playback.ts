import type { PlayItem } from '../types';

/**
 * Spotify-style play order:
 *  - `context` is what you pressed Play on (a whole matchweek, from a given match on)
 *  - `queue` is what you added by hand; it always plays before the context continues
 * When the current video ends: next queued item if any, else the next context item.
 */
export interface PlaybackState {
  context: { label: string; items: PlayItem[]; pos: number } | null;
  queue: PlayItem[];
  current: PlayItem | null;
  from: 'context' | 'queue' | null;
  /** videoIds that failed to play, per item uid (so we fall back to the other cut) */
  failed: Record<string, string[]>;
  /** match ids already played since the context started (so queued matches aren't replayed) */
  played: number[];
  /** bumps on every (re)start so the player reloads even for the same video */
  seq: number;
}

export type Action =
  | { type: 'playContext'; label: string; items: PlayItem[]; start: number }
  | { type: 'playQueue' }
  | { type: 'playQueued'; uid: string }
  | { type: 'jumpContext'; pos: number }
  | { type: 'enqueue'; items: PlayItem[] }
  | { type: 'dequeue'; uid: string }
  | { type: 'move'; uid: string; dir: -1 | 1 }
  | { type: 'clearQueue' }
  | { type: 'next' }
  | { type: 'prev' }
  | { type: 'failed'; videoId: string }
  | { type: 'stop' };

export const initialPlayback = (queue: PlayItem[] = []): PlaybackState => ({
  context: null, queue, current: null, from: null, failed: {}, played: [], seq: 0,
});

const markPlayed = (s: PlaybackState, item: PlayItem | null) =>
  item && !s.played.includes(item.match.id) ? [...s.played, item.match.id] : s.played;

function advance(s: PlaybackState): PlaybackState {
  const played = markPlayed(s, s.current);
  if (s.queue.length) {
    const [head, ...rest] = s.queue;
    return { ...s, played, current: head, queue: rest, from: 'queue', seq: s.seq + 1 };
  }
  if (s.context) {
    let pos = s.context.pos + 1;
    while (pos < s.context.items.length && played.includes(s.context.items[pos].match.id)) pos++;
    if (pos < s.context.items.length) {
      return { ...s, played, context: { ...s.context, pos }, current: s.context.items[pos], from: 'context', seq: s.seq + 1 };
    }
  }
  return { ...s, played, current: null, from: null, seq: s.seq + 1 };
}

export function playbackReducer(s: PlaybackState, a: Action): PlaybackState {
  switch (a.type) {
    case 'playContext': {
      if (!a.items.length) return s;
      const pos = Math.max(0, Math.min(a.start, a.items.length - 1));
      return { ...s, context: { label: a.label, items: a.items, pos }, current: a.items[pos], from: 'context', failed: {}, played: [], seq: s.seq + 1 };
    }
    case 'playQueue':
      return s.queue.length ? advance({ ...s, context: null }) : s;
    case 'playQueued': {
      const item = s.queue.find((q) => q.uid === a.uid);
      if (!item) return s;
      return { ...s, current: item, from: 'queue', queue: s.queue.filter((q) => q.uid !== a.uid), seq: s.seq + 1 };
    }
    case 'jumpContext': {
      if (!s.context || !s.context.items[a.pos]) return s;
      return { ...s, context: { ...s.context, pos: a.pos }, current: s.context.items[a.pos], from: 'context', seq: s.seq + 1 };
    }
    case 'enqueue':
      return { ...s, queue: [...s.queue, ...a.items] };
    case 'dequeue':
      return { ...s, queue: s.queue.filter((q) => q.uid !== a.uid) };
    case 'move': {
      const i = s.queue.findIndex((q) => q.uid === a.uid);
      const j = i + a.dir;
      if (i < 0 || j < 0 || j >= s.queue.length) return s;
      const q = [...s.queue];
      [q[i], q[j]] = [q[j], q[i]];
      return { ...s, queue: q };
    }
    case 'clearQueue':
      return { ...s, queue: [] };
    case 'next':
      return advance(s);
    case 'prev': {
      if (s.from === 'context' && s.context && s.context.pos > 0) {
        const pos = s.context.pos - 1;
        return { ...s, context: { ...s.context, pos }, current: s.context.items[pos], seq: s.seq + 1 };
      }
      return { ...s, seq: s.seq + 1 }; // restart current
    }
    case 'failed': {
      if (!s.current) return s;
      const list = [...(s.failed[s.current.uid] ?? []), a.videoId];
      return { ...s, failed: { ...s.failed, [s.current.uid]: list } };
    }
    case 'stop':
      return { ...s, current: null, from: null, context: null };
  }
}

/** Context items still to come (with their absolute positions), skipping ones already played or queued. */
export function contextRemaining(s: PlaybackState) {
  if (!s.context) return [];
  const skip = new Set([...s.played, ...(s.current ? [s.current.match.id] : []), ...s.queue.map((q) => q.match.id)]);
  return s.context.items
    .map((item, pos) => ({ item, pos }))
    .filter(({ item, pos }) => pos > s.context!.pos && !skip.has(item.match.id));
}
