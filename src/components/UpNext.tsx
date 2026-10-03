import { useEffect, useRef, useState } from 'react';
import type { CSSProperties, Dispatch, KeyboardEvent, PointerEvent } from 'react';
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

function Row({ item, pref, condensed, region, avoid, onPlay, children, className, style }: { item: PlayItem; pref: Kind; condensed: CondensedMap | null; region: string | null; avoid: string[]; onPlay: () => void; children?: React.ReactNode; className?: string; style?: CSSProperties }) {
  const hl = resolveItem(item, pref, condensed, [], region, avoid);
  const { home, away } = item.match;
  return (
    <li className={`row${className ? ` ${className}` : ''}`} style={style}>
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
        <QueueRows queue={queue} pref={pref} condensed={condensed} region={region} avoid={avoid} dispatch={dispatch} />
      </div>
    </div>
  );
}

interface Drag { uid: string; from: number; over: number; dy: number }

/**
 * The queued rows. Each has a grip (☰): press it and drag the row to a new spot; the
 * others slide aside to show where it will land. Works with mouse, pen and touch; with
 * the keyboard, the grip moves its row with the up and down arrows.
 */
function QueueRows({ queue, pref, condensed, region, avoid, dispatch }: {
  queue: PlayItem[]; pref: Kind; condensed: CondensedMap | null; region: string | null; avoid: string[]; dispatch: Dispatch<Action>;
}) {
  const listRef = useRef<HTMLOListElement>(null);
  const [drag, setDrag] = useState<Drag | null>(null);
  const dragRef = useRef<Drag | null>(null);
  dragRef.current = drag;
  // Geometry captured at the start of a drag, in page coordinates so scrolling mid-drag is fine.
  const geo = useRef<{ tops: number[]; mids: number[]; step: number; startY: number; pointerY: number; raf: number } | null>(null);

  const update = () => {
    const g = geo.current;
    if (!g) return;
    setDrag((d) => {
      if (!d) return d;
      const dy = g.pointerY + window.scrollY - g.startY;
      const center = g.mids[d.from] + dy;
      let over = d.from;
      for (let i = 0; i < g.mids.length; i++) {
        if (i < d.from && center < g.mids[i]) { over = i; break; }
        if (i > d.from && center > g.mids[i]) over = i;
      }
      return { ...d, dy, over };
    });
  };

  // Near the top or bottom of the screen, scroll the page so long queues can be reordered.
  const tick = () => {
    const g = geo.current;
    if (!g) return;
    const edge = 64, y = g.pointerY, h = window.innerHeight;
    const v = y < edge ? -Math.ceil((edge - y) / 6) : y > h - edge ? Math.ceil((y - (h - edge)) / 6) : 0;
    if (v) { window.scrollBy(0, v); update(); }
    g.raf = requestAnimationFrame(tick);
  };

  useEffect(() => () => { if (geo.current) cancelAnimationFrame(geo.current.raf); document.body.classList.remove('is-reordering'); }, []);

  const start = (e: PointerEvent<HTMLButtonElement>, uid: string, from: number) => {
    if (e.button !== 0 || !listRef.current) return;
    e.preventDefault();
    e.currentTarget.setPointerCapture(e.pointerId);
    const rows = [...listRef.current.children] as HTMLElement[];
    const rects = rows.map((r) => r.getBoundingClientRect());
    const tops = rects.map((r) => r.top + window.scrollY);
    const mids = rects.map((r, i) => tops[i] + r.height / 2);
    const step = rows.length > 1 ? tops[1] - tops[0] : rects[0].height;
    geo.current = { tops, mids, step, startY: e.clientY + window.scrollY, pointerY: e.clientY, raf: 0 };
    geo.current.raf = requestAnimationFrame(tick);
    document.body.classList.add('is-reordering');
    setDrag({ uid, from, over: from, dy: 0 });
  };

  const moveTo = (e: PointerEvent<HTMLButtonElement>) => {
    if (!geo.current) return;
    geo.current.pointerY = e.clientY;
    update();
  };

  const end = () => {
    if (geo.current) cancelAnimationFrame(geo.current.raf);
    geo.current = null;
    document.body.classList.remove('is-reordering');
    const d = dragRef.current;
    if (d && d.over !== d.from) dispatch({ type: 'move', uid: d.uid, to: d.over });
    setDrag(null);
  };

  const onKey = (e: KeyboardEvent<HTMLButtonElement>, uid: string, i: number) => {
    const to = e.key === 'ArrowUp' ? i - 1 : e.key === 'ArrowDown' ? i + 1 : -1;
    if (to < 0 || to >= queue.length) return;
    e.preventDefault();
    dispatch({ type: 'move', uid, to });
    // Keep focus on the grip as it moves.
    requestAnimationFrame(() => (listRef.current?.children[to]?.querySelector('.grip') as HTMLElement | null)?.focus());
  };

  const shiftFor = (i: number): number => {
    if (!drag || !geo.current) return 0;
    const { from, over } = drag, step = geo.current.step;
    if (i === from) return drag.dy;
    if (from < over && i > from && i <= over) return -step;
    if (over < from && i >= over && i < from) return step;
    return 0;
  };

  return (
    <ol className={`rows${drag ? ' is-dragging' : ''}`} aria-label="Queue" ref={listRef}>
      {queue.map((item, i) => {
        const dragged = drag?.uid === item.uid;
        const y = shiftFor(i);
        return (
          <Row key={item.uid} item={item} pref={pref} condensed={condensed} region={region} avoid={avoid}
            className={dragged ? 'is-lifted' : undefined}
            style={y ? { transform: `translateY(${y}px)` } : undefined}
            onPlay={() => dispatch({ type: 'playQueued', uid: item.uid })}>
            <button className="btn-icon sm" aria-label="Remove from queue"
              onClick={() => dispatch({ type: 'dequeue', uid: item.uid })}>
              <svg viewBox="0 0 24 24"><path d="M18.3 5.7 12 12l6.3 6.3-1.4 1.4L10.6 13.4 4.3 19.7 2.9 18.3 9.2 12 2.9 5.7l1.4-1.4 6.3 6.3 6.3-6.3z" /></svg>
            </button>
            <button className="btn-icon sm grip" aria-label={`Reorder ${matchTitle(item.match)} (drag, or use the arrow keys)`} title="Drag to reorder"
              onPointerDown={(e) => start(e, item.uid, i)} onPointerMove={moveTo} onPointerUp={end} onPointerCancel={end}
              onKeyDown={(e) => onKey(e, item.uid, i)}>
              <svg viewBox="0 0 24 24"><path d="M4 7h16v2H4zm0 4h16v2H4zm0 4h16v2H4z" /></svg>
            </button>
          </Row>
        );
      })}
    </ol>
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
