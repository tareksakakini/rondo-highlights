import { useEffect, useMemo, useRef, useState } from 'react';
import type { Team } from '../types';
import { fold, teamId, type PickerGroup } from '../lib/digest';
import { moved, useReorder } from '../lib/reorder';
import { CompMark } from './CompSwitcher';
import { TeamBadge } from './TeamBadge';

/**
 * Pick your teams: every team in the data as a crest, under its league (or its
 * cup or national competition), with a search box. Your teams are listed first, in your
 * order (new ones join at the end; drag one by its handle to move it), which orders the
 * digest. Changes are saved when it closes.
 */
export function TeamPicker({ groups, selected, onClose }: {
  /** null while the teams load. */
  groups: PickerGroup[] | null;
  selected: string[];
  /** With the new selection. */
  onClose: (teams: string[]) => void;
}) {
  const [picked, setPicked] = useState<string[]>(selected);
  const [q, setQ] = useState('');
  const done = useRef(() => onClose(picked));
  done.current = () => onClose(picked);
  const input = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && done.current();
    window.addEventListener('keydown', onKey);
    // Phones: don't pop the keyboard over the crests straight away.
    if (window.matchMedia?.('(hover: hover)').matches) input.current?.focus();
    document.documentElement.classList.add('cs-open');
    return () => { window.removeEventListener('keydown', onKey); document.documentElement.classList.remove('cs-open'); };
  }, []);

  const shown = useMemo(() => {
    const needle = fold(q.trim());
    if (!groups || !needle) return groups;
    const hit = (t: Team) => [t.name, t.short, t.tla].some((s) => s && fold(s).includes(needle));
    return groups.map((g) => ({ ...g, teams: g.teams.filter(hit) })).filter((g) => g.teams.length);
  }, [groups, q]);

  const toggle = (id: string) => setPicked((p) => (p.includes(id) ? p.filter((x) => x !== id) : [...p, id]));
  const move = (from: number, to: number) => setPicked((p) => moved(p, from, to));
  const byId = useMemo(() => new Map((groups ?? []).flatMap((g) => g.teams).map((t) => [teamId(t), t])), [groups]);

  return (
    <div className="sheet-backdrop" onClick={() => done.current()}>
      <div className="sheet picker" role="dialog" aria-modal="true" aria-label="Pick your teams" onClick={(e) => e.stopPropagation()}>
        <div className="sheet-grip" aria-hidden="true" />
        <div className="sheet-head">
          <h2>Pick your teams</h2>
          <button className="btn-icon sm" onClick={() => done.current()} aria-label="Close">
            <svg viewBox="0 0 24 24"><path d="M18.3 5.7 12 12l6.3 6.3-1.4 1.4L10.6 13.4 4.3 19.7 2.9 18.3 9.2 12 2.9 5.7l1.4-1.4 6.3 6.3 6.3-6.3z" /></svg>
          </button>
        </div>
        <input ref={input} className="picker-search" type="search" placeholder="Search teams" aria-label="Search teams"
          value={q} onChange={(e) => setQ(e.target.value)} />
        <div className="picker-body">
          {picked.length > 0 && !q.trim() && (
            <section className="picker-group picker-order" aria-label="Your teams, in order">
              <h3>Your teams</h3>
              <p className="muted picker-hint">In this order: your first team&apos;s matches come first in each weekend and midweek.</p>
              <OrderList ids={picked} byId={byId} onMove={move} onRemove={toggle} />
            </section>
          )}
          {!shown && <p className="muted picker-note">Loading teams…</p>}
          {shown && !shown.length && <p className="muted picker-note">No team matches “{q}”.</p>}
          {shown?.map((g) => (
            <section key={g.comp.code} className="picker-group">
              <h3><CompMark comp={g.comp} />{g.comp.short ?? g.comp.name}</h3>
              <div className="picker-grid">
                {g.teams.map((t) => {
                  const on = picked.includes(teamId(t));
                  return (
                    <button key={teamId(t)} className={`picker-team${on ? ' on' : ''}`} aria-pressed={on} title={t.name} onClick={() => toggle(teamId(t))}>
                      <TeamBadge team={t} size={40} />
                      <span>{t.short || t.name}</span>
                      {on && <svg className="picker-check" viewBox="0 0 24 24" aria-hidden="true"><path d="M9 16.2 4.8 12l-1.4 1.4L9 19 21 7l-1.4-1.4z" /></svg>}
                    </button>
                  );
                })}
              </div>
            </section>
          ))}
        </div>
        <div className="picker-foot">
          <span className="muted">{picked.length ? `${picked.length} ${picked.length === 1 ? 'team' : 'teams'} picked` : 'Tap a crest to pick a team'}</span>
          <button className="btn-primary" onClick={() => done.current()}>Done</button>
        </div>
      </div>
    </div>
  );
}

/**
 * Your teams in order. Drag a row by its handle (≡) to move it, with a mouse or a finger;
 * the rows it passes slide out of its way. With the keyboard: focus the handle, ↑/↓.
 */
function OrderList({ ids, byId, onMove, onRemove }: {
  ids: string[];
  byId: Map<string, Team>;
  onMove: (from: number, to: number) => void;
  onRemove: (id: string) => void;
}) {
  const list = useRef<HTMLOListElement | null>(null);
  const r = useReorder('y', onMove);
  const last = ids.length - 1;

  const key = (e: React.KeyboardEvent, i: number, id: string) => {
    const to = e.key === 'ArrowUp' ? i - 1 : e.key === 'ArrowDown' ? i + 1 : null;
    if (to == null) return;
    e.preventDefault();
    if (to < 0 || to > last) return;
    onMove(i, to);
    // Moving the row in the page can take the focus off its handle: put it back.
    requestAnimationFrame(() => list.current?.querySelector<HTMLElement>(`li[data-id="${CSS.escape(id)}"] .order-handle`)?.focus());
  };

  return (
    <ol ref={(el) => { list.current = el; r.container.current = el; }} className={`order-list${r.drag ? ' dragging' : ''}`}>
      {ids.map((id, i) => {
        const t = byId.get(id);
        const name = t?.short || t?.name || id;
        return (
          <li key={id} data-id={id} className={r.drag?.from === i ? 'is-drag' : undefined} style={r.offset(i)}>
            <span className="order-n">{r.slot(i) + 1}</span>
            {t && <TeamBadge team={t} size={24} />}
            <span className="order-name" title={t?.name ?? id}>{name}</span>
            <button className="btn-icon sm order-remove" onClick={() => onRemove(id)} aria-label={`Remove ${name}`} title="Remove">
              <svg viewBox="0 0 24 24"><path d="M18.3 5.7 12 12l6.3 6.3-1.4 1.4L10.6 13.4 4.3 19.7 2.9 18.3 9.2 12 2.9 5.7l1.4-1.4 6.3 6.3 6.3-6.3z" /></svg>
            </button>
            <button className="order-handle" title="Drag to reorder"
              aria-label={`Reorder ${name}, number ${i + 1} of ${ids.length}: drag, or press the up and down arrow keys`}
              {...r.handle(i)} onKeyDown={(e) => key(e, i, id)}>
              <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 7h16v2H4zm0 4h16v2H4zm0 4h16v2H4z" /></svg>
            </button>
          </li>
        );
      })}
    </ol>
  );
}
