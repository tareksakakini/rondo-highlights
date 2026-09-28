import { useState, type Dispatch } from 'react';
import type { Kind, PlayItem } from '../types';
import { contextRemaining, type Action, type PlaybackState } from '../lib/playback';
import { fmtDuration, fmtTotal, kindLabel, matchTitle, resolveItem } from '../lib/format';
import { TeamBadge } from './TeamBadge';

interface Props {
  state: PlaybackState;
  pref: Kind;
  region: string | null;
  avoid?: string[];
  dispatch: Dispatch<Action>;
}

function Row({ item, pref, region, avoid, onPlay, children }: { item: PlayItem; pref: Kind; region: string | null; avoid: string[]; onPlay: () => void; children?: React.ReactNode }) {
  const hl = resolveItem(item, pref, [], region, avoid);
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
            {hl ? ` · ${kindLabel(hl.kind)} ${fmtDuration(hl.durationSec)}` : ' · not available here'}
            {item.kind && <span className="pin" title="Length pinned for this match">pinned</span>}
          </span>
        </span>
      </button>
      {children && <span className="row-actions">{children}</span>}
    </li>
  );
}

const wide = () => typeof window !== 'undefined' && window.matchMedia?.('(min-width: 1100px)').matches;

export function UpNext({ state, pref, region, avoid = [], dispatch }: Props) {
  const [open, setOpen] = useState(wide);
  const rest = contextRemaining(state);
  const upcoming = [...state.queue, ...rest.map((r) => r.item)];
  const total = upcoming.reduce((t, it) => t + (resolveItem(it, pref, [], region, avoid)?.durationSec ?? 0), 0);
  const next = upcoming[0];

  return (
    <div className={`upnext${open ? ' open' : ''}`}>
      <button className="panel-head" onClick={() => setOpen(!open)} aria-expanded={open}>
        <span className="panel-title">
          <h2>Up next</h2>
          {!open && next && <span className="peek">{matchTitle(next.match)}{upcoming.length > 1 ? ` +${upcoming.length - 1}` : ''}</span>}
        </span>
        {total > 0 && <span className="muted">{fmtTotal(total)}</span>}
        <svg className="chev" viewBox="0 0 24 24" aria-hidden="true"><path d="m7 10 5 5 5-5z" /></svg>
      </button>

      <div className="upnext-body">
        <section aria-label="Your queue">
          <div className="section-head">
            <h3>Your queue <span className="count">{state.queue.length}</span></h3>
            {state.queue.length > 0 && (
              <span className="section-actions">
                {state.from !== 'queue' && (
                  <button className="btn-ghost sm" onClick={() => dispatch({ type: 'playQueue' })}>Play queue</button>
                )}
                <button className="btn-ghost sm" onClick={() => dispatch({ type: 'clearQueue' })}>Clear</button>
              </span>
            )}
          </div>
          {state.queue.length === 0 ? (
            <p className="empty">Tap <b>+</b> on any match to line it up next, ahead of the rest of the round.</p>
          ) : (
            <ol className="rows">
              {state.queue.map((item, i) => (
                <Row key={item.uid} item={item} pref={pref} region={region} avoid={avoid} onPlay={() => dispatch({ type: 'playQueued', uid: item.uid })}>
                  <button className="btn-icon sm" aria-label="Move up" disabled={i === 0}
                    onClick={() => dispatch({ type: 'move', uid: item.uid, dir: -1 })}>
                    <svg viewBox="0 0 24 24"><path d="m7 14 5-5 5 5z" /></svg>
                  </button>
                  <button className="btn-icon sm" aria-label="Move down" disabled={i === state.queue.length - 1}
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
          )}
        </section>

        {state.context && (
          <section aria-label="Continuing">
            <div className="section-head">
              <h3>Then: {state.context.label} <span className="count">{rest.length}</span></h3>
            </div>
            {rest.length === 0 ? (
              <p className="empty">That's the last match of this round.</p>
            ) : (
              <ol className="rows">
                {rest.map(({ item, pos }) => (
                  <Row key={item.uid} item={item} pref={pref} region={region} avoid={avoid} onPlay={() => dispatch({ type: 'jumpContext', pos })} />
                ))}
              </ol>
            )}
          </section>
        )}
      </div>
    </div>
  );
}
