import { useState, type Dispatch } from 'react';
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
          <span className="row-title">{home.short} v {away.short}</span>
          <span className="row-sub">
            <i className="comp-dot" style={{ background: item.comp.color }} />
            {item.comp.name}
            {hl ? ` · ${cutLabel(cutKind(hl))} ${fmtDuration(cutSec(hl))}` : ' · not available here'}
            {item.kind && <span className="pin" title="Length pinned for this match">pinned</span>}
          </span>
        </span>
      </button>
      {children && <span className="row-actions">{children}</span>}
    </li>
  );
}

const wide = () => typeof window !== 'undefined' && window.matchMedia?.('(min-width: 1100px)').matches;

/** The queue: everything that plays after the current match, as one list. Hidden when empty. */
export function UpNext({ state, pref, condensed, region, avoid = [], dispatch }: Props) {
  const [open, setOpen] = useState(wide);
  const { queue } = state;
  if (!queue.length) return null;
  const total = queue.reduce((t, it) => { const c = resolveItem(it, pref, condensed, [], region, avoid); return t + (c ? cutSec(c) : 0); }, 0);
  const next = queue[0];

  return (
    <div className={`upnext${open ? ' open' : ''}`}>
      <div className="panel-bar">
        <button className="panel-head" onClick={() => setOpen(!open)} aria-expanded={open}>
          <span className="panel-title">
            <h2>Up next <span className="count">{queue.length}</span></h2>
            {!open && <span className="peek">{matchTitle(next.match)}{queue.length > 1 ? ` +${queue.length - 1}` : ''}</span>}
          </span>
          {total > 0 && <span className="muted">{fmtTotal(total)}</span>}
          <svg className="chev" viewBox="0 0 24 24" aria-hidden="true"><path d="m7 10 5 5 5-5z" /></svg>
        </button>
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
 * Wide screens, something playing, nothing queued: the queue column stays (so the
 * player keeps the same size) and offers the rest of the round being browsed.
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
        {items.length > 0 && <span className="section-actions"><button className="btn-ghost sm" onClick={onQueueAll}>+ Queue all</button></span>}
      </div>
      <p className="suggest-note muted">
        Your queue is empty.{items.length > 0 ? <> More from <strong>{roundName}</strong>:</> : ' Add matches with + on any card.'}
      </p>
      {items.length > 0 && (
        <ol className="rows" aria-label={`More from ${roundName}`}>
          {items.map((item) => (
            <Row key={item.match.id} item={item} pref={pref} condensed={condensed} region={region} avoid={avoid} onPlay={() => onPlay(item)}>
              <button className="btn-icon sm" aria-label="Add to queue" title="Add to queue" onClick={() => onQueue(item)}>
                <svg viewBox="0 0 24 24"><path d="M19 13h-6v6h-2v-6H5v-2h6V5h2v6h6z" /></svg>
              </button>
            </Row>
          ))}
        </ol>
      )}
    </div>
  );
}
