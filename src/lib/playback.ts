import type { PlayItem } from '../types';

/**
 * One play order:
 *  - `current` is playing; `queue` is everything that plays after it, in order.
 *  - "+" and "Queue all" add to the end of the queue, in the order you add them.
 *  - "Play" on one match plays just that match now; the queue is left as it was (minus
 *    that match, so it doesn't play twice) and carries on afterwards.
 *  - "Play all" plays the round's first match and puts the rest of the round at the front
 *    of the queue (marked `auto`), ahead of what you had queued. Another "Play all"
 *    replaces the old round's leftovers; what you queued yourself stays, in its order.
 *  - `history` is what played before, for Previous.
 * Clearing the queue empties it; nothing else keeps playing afterwards.
 */
export interface PlaybackState {
  queue: PlayItem[];
  current: PlayItem | null;
  history: PlayItem[];
  /** videoIds that failed to play, per item uid (so we fall back to the other cut) */
  failed: Record<string, string[]>;
  /** bumps on every (re)start so the player reloads even for the same video */
  seq: number;
}

export type Action =
  | { type: 'playRound'; items: PlayItem[]; start: number }
  | { type: 'playOne'; item: PlayItem }
  | { type: 'playQueued'; uid: string }
  | { type: 'enqueue'; items: PlayItem[] }
  | { type: 'dequeue'; uid: string }
  | { type: 'dequeueMatch'; matchId: number | string }
  | { type: 'move'; uid: string; dir: -1 | 1 }
  | { type: 'clearQueue' }
  | { type: 'next' }
  | { type: 'prev' }
  | { type: 'failed'; videoId: string }
  | { type: 'stop' };

const HISTORY_MAX = 50;

export const initialPlayback = (queue: PlayItem[] = []): PlaybackState => ({
  queue: dedupe(queue), current: null, history: [], failed: {}, seq: 0,
});

/** First occurrence of each match wins. */
function dedupe(items: PlayItem[]): PlayItem[] {
  const seen = new Set<number | string>();
  return items.filter((it) => (seen.has(it.match.id) ? false : (seen.add(it.match.id), true)));
}

const pushHistory = (h: PlayItem[], item: PlayItem | null) =>
  item ? [...h, item].slice(-HISTORY_MAX) : h;

export function playbackReducer(s: PlaybackState, a: Action): PlaybackState {
  switch (a.type) {
    case 'playRound': {
      if (!a.items.length) return s;
      const pos = Math.max(0, Math.min(a.start, a.items.length - 1));
      const start = a.items[pos];
      const rest = a.items.slice(pos + 1);
      const inRound = new Set([start, ...rest].map((it) => it.match.id));
      // A match you had queued yourself from this round plays in round order, and stays yours.
      const mine = new Set(s.queue.filter((q) => !q.auto).map((q) => q.match.id));
      const leftovers = rest.map((it) => ({ ...it, auto: mine.has(it.match.id) ? undefined : true }));
      const handAdded = s.queue.filter((q) => !q.auto && !inRound.has(q.match.id));
      return {
        ...s,
        current: { ...start, auto: undefined },
        queue: [...leftovers, ...handAdded],
        history: pushHistory(s.history, s.current),
        failed: {},
        seq: s.seq + 1,
      };
    }
    case 'playOne':
      return {
        ...s,
        current: { ...a.item, auto: undefined },
        queue: s.queue.filter((q) => q.match.id !== a.item.match.id),
        history: pushHistory(s.history, s.current),
        failed: {},
        seq: s.seq + 1,
      };
    case 'playQueued': {
      const item = s.queue.find((q) => q.uid === a.uid);
      if (!item) return s;
      return {
        ...s,
        current: item,
        queue: s.queue.filter((q) => q.uid !== a.uid),
        history: pushHistory(s.history, s.current),
        seq: s.seq + 1,
      };
    }
    case 'enqueue': {
      // Already queued (from a round or by hand) or playing now: left where it is.
      const added = dedupe(a.items)
        .filter((it) => it.match.id !== s.current?.match.id && !s.queue.some((q) => q.match.id === it.match.id))
        .map((it) => ({ ...it, auto: undefined }));
      // Queueing a round leftover by hand keeps its place but makes it yours (a later "Play"
      // won't drop it).
      const ids = new Set(a.items.map((it) => it.match.id));
      const queue = s.queue.map((q) => (q.auto && ids.has(q.match.id) ? { ...q, auto: undefined } : q));
      return { ...s, queue: [...queue, ...added] };
    }
    case 'dequeue':
      return { ...s, queue: s.queue.filter((q) => q.uid !== a.uid) };
    case 'dequeueMatch':
      return { ...s, queue: s.queue.filter((q) => q.match.id !== a.matchId) };
    case 'move': {
      const i = s.queue.findIndex((q) => q.uid === a.uid);
      const j = i + a.dir;
      if (i < 0 || j < 0 || j >= s.queue.length) return s;
      const q = [...s.queue];
      [q[i], q[j]] = [q[j], q[i]];
      // Moving an item by hand makes it the viewer's choice: it's no longer a round leftover
      // that the next "Play" would replace.
      q[j] = { ...q[j], auto: undefined };
      return { ...s, queue: q };
    }
    case 'clearQueue':
      return { ...s, queue: [] };
    case 'next': {
      const [head, ...rest] = s.queue;
      return {
        ...s,
        current: head ?? null,
        queue: rest,
        history: pushHistory(s.history, s.current),
        seq: s.seq + 1,
      };
    }
    case 'prev': {
      const back = s.history[s.history.length - 1];
      if (!back) return { ...s, seq: s.seq + 1 }; // restart current
      return {
        ...s,
        current: back,
        history: s.history.slice(0, -1),
        queue: s.current ? [s.current, ...s.queue.filter((q) => q.match.id !== s.current!.match.id)] : s.queue,
        seq: s.seq + 1,
      };
    }
    case 'failed': {
      if (!s.current) return s;
      const list = [...(s.failed[s.current.uid] ?? []), a.videoId];
      return { ...s, failed: { ...s.failed, [s.current.uid]: list } };
    }
    case 'stop':
      return { ...s, current: null, history: pushHistory(s.history, s.current) };
  }
}
