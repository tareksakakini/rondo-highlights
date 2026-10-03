import type { Dispatch } from 'react';
import type { Kind, PlayItem } from '../types';
import type { Action, PlaybackState } from '../lib/playback';
import { cutKind, cutLabel, cutSec, fmtDuration, fmtTotal, matchTitle, resolveItem } from '../lib/format';
import type { CondensedMap } from '../lib/moments';
import { TeamBadge } from './TeamBadge';

interface Props {
  state: PlaybackState;
  pref: Kind;
  condensed: CondensedMap | null;
  region: string | null;
  avoid?: string[];
  dispatch: Dispatch<Action>;
}

function Row({ item, pref, condensed, region, avoid, onPlay, children }: { item: PlayItem; pref: Kind; condensed: CondensedMap | null; region: string | null; avoid: string[]; onPlay: () => void; children?: React.ReactNode }) {
  const hl = resolveItem(item, pref, condensed, [], region, avoid);
  const { home, away } = item.match;
  return (
    <li className="row">
      <button className="row-main" onClick={onPlay} disabled={!hl}>
        <span className="row-badges"><TeamBadge team={home} size={22} /><TeamBadge team={away} size={22} /></span>
        <span className="row-text">
          <span className="row-title">{home.short} <span className="v">v</span> {away.short}</span>
          <span className="row-sub">
            <i className="comp-dot" style={{ background: item.comp.color }} />
            {hl ? `${cutLabel(cutKind(hl))} ${fmtDuration(cutSec(hl))}` : 'Not available here'}
            <span className="row-comp"> · {item.comp.name}</span>
            {item.kind && <span className="pin" title="Length pinned for this match">pinned</span>}
          </span>
        </span>
      </button>
      {children && <span className="row-actions">{children}</span>}
    </li>
  );
}

const queueTotal = (queue: PlayItem[], pref: Kind, condensed: CondensedMap | null, region: string | null, avoid: string[]) =>
  queue.reduce((t, it) => { const c = resolveItem(it, pref, condensed, [], region, avoid); return t + (c ? cutSec(c) : 0); }, 0);

/** The queue: everything that plays after the current match, as one list. Hidden when empty. */
export function UpNext({ state, pref, condensed, region, avoid = [], dispatch }: Props) {
  const { queue } = state;
  if (!queue.length) return null;
  const total = queueTotal(queue, pref, condensed, region, avoid);

  return (
    <div className="upnext">
      <div className="panel-bar">
        <div className="panel-head">
          <span className="panel-title">
            <h2>Up next <span className="count">{queue.length}</span></h2>
          </span>
          {total > 0 && <span className="muted">{fmtTotal(total)}</span>}
        </div>
        <span className="section-actions">
          {!state.current && (
            <button className="btn-ghost sm" onClick={() => dispatch({ type: 'next' })}>Play</button>
          )}
          <button className="btn-ghost sm" onClick={() => dispatch({ type: 'clearQueue' })}>Clear</button>
        </span>
      </div>

      <div className="upnext-body">
        <ol className="rows" aria-label="Queue">
          {queue.map((item, i) => (
            <Row key={item.uid} item={item} pref={pref} condensed={condensed} region={region} avoid={avoid} onPlay={() => dispatch({ type: 'playQueued', uid: item.uid })}>
              <button className="btn-icon sm" aria-label="Move up" disabled={i === 0}
                onClick={() => dispatch({ type: 'move', uid: item.uid, dir: -1 })}>
                <svg viewBox="0 0 24 24"><path d="m7 14 5-5 5 5z" /></svg>
              </button>
              <button className="btn-icon sm" aria-label="Move down" disabled={i === queue.length - 1}
                onClick={() => dispatch({ type: 'move', uid: item.uid, dir: 1 })}>
                <svg viewBox="0 0 24 24"><path d="m7 10 5 5 5-5z" /></svg>
              </button>
              <button className="btn-icon sm" aria-label="Remove from queue"
                onClick={() => dispatch({ type: 'dequeue', uid: item.uid })}>
                <svg viewBox="0 0 24 24"><path d="M18.3 5.7 12 12l6.3 6.3-1.4 1.4L10.6 13.4 4.3 19.7 2.9 18.3 9.2 12 2.9 5.7l1.4-1.4 6.3 6.3 6.3-6.3z" /></svg>
              </button>
            </Row>
          ))}
        </ol>
      </div>
    </div>
  );
}

/**
 * Narrow screens, nothing playing, a queue saved from last time: one line to pick it up
 * again (the full list shows while watching).
 */
export function QueueBar({ state, pref, condensed, region, avoid = [], onPlay, onClear }: {
  state: PlaybackState; pref: Kind; condensed: CondensedMap | null; region: string | null; avoid?: string[];
  onPlay: () => void; onClear: () => void;
}) {
  const { queue } = state;
  if (!queue.length) return null;
  const total = queueTotal(queue, pref, condensed, region, avoid);
  return (
    <div className="queue-bar">
      <button className="queue-bar-main" onClick={onPlay}>
        <span className="queue-bar-play" aria-hidden="true"><svg viewBox="0 0 24 24"><path d="M8 5v14l11-7z" /></svg></span>
        <span className="row-text">
          <span className="row-title">Your queue <span className="count">{queue.length}</span>{total > 0 && <span className="queue-bar-total"> · {fmtTotal(total)}</span>}</span>
          <span className="row-sub">Next: {matchTitle(queue[0].match)}</span>
        </span>
      </button>
      <button className="btn-ghost sm" onClick={onClear}>Clear</button>
    </div>
  );
}

/**
 * Something playing, nothing queued: offers the rest of the round being browsed (in the
 * queue column on wide screens, which also keeps the player's size; under the player otherwise).
 */
export function QueueSuggestions({ items, roundName, pref, condensed, region, avoid = [], onPlay, onQueue, onQueueAll }: {
  items: PlayItem[];
  roundName: string;
  pref: Kind;
  condensed: CondensedMap | null;
  region: string | null;
  avoid?: string[];
  onPlay: (item: PlayItem) => void;
  onQueue: (item: PlayItem) => void;
  onQueueAll: () => void;
}) {
  return (
    <div className="upnext open suggest">
      <div className="panel-bar">
        <div className="panel-head">
          <span className="panel-title"><h2>Up next</h2></span>
        </div>
      </div>
      <p className="suggest-note muted">
        Your queue is empty.{items.length === 0 && ' Add matches from any round.'}
      </p>
      {items.length > 0 && (
        <section className="suggest-section" aria-labelledby="suggest-title">
          <div className="suggest-head">
            <span className="suggest-title">
              <h3 id="suggest-title">Suggestions</h3>
              <span className="muted">More from <strong>{roundName}</strong></span>
            </span>
            <button className="btn-ghost sm" onClick={onQueueAll}>+ Queue all</button>
          </div>
          <ol className="rows" aria-label={`Suggestions: more from ${roundName}`}>
            {items.map((item) => (
              <Row key={item.match.id} item={item} pref={pref} condensed={condensed} region={region} avoid={avoid} onPlay={() => onPlay(item)}>
                <button className="btn-icon sm" aria-label="Add to queue" title="Add to queue" onClick={() => onQueue(item)}>
                  <svg viewBox="0 0 24 24"><path d="M19 13h-6v6h-2v-6H5v-2h6V5h2v6h6z" /></svg>
                </button>
              </Row>
            ))}
          </ol>
        </section>
      )}
    </div>
  );
}
