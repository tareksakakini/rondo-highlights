import { useRef } from 'react';
import type { Team } from '../types';
import { moved, useReorder } from '../lib/reorder';
import { useScrollEdges } from './SlateRow';
import { TeamBadge } from './TeamBadge';

/**
 * Your teams over the digest, in your order, as one row that scrolls sideways. Drag a
 * chip by its grip (the dotted end cap) to move it, or focus the grip and press ←/→; the new order is
 * saved at once and reorders the weekends and midweeks below.
 */
export function TeamWheel({ teams, onReorder }: { teams: { id: string; team: Team }[]; onReorder: (ids: string[]) => void }) {
  const row = useRef<HTMLDivElement | null>(null);
  const more = useScrollEdges(row);
  const ids = teams.map((t) => t.id);
  const r = useReorder('x', (from, to) => onReorder(moved(ids, from, to)));

  const key = (e: React.KeyboardEvent, i: number, id: string) => {
    const to = e.key === 'ArrowLeft' ? i - 1 : e.key === 'ArrowRight' ? i + 1 : null;
    if (to == null) return;
    e.preventDefault();
    if (to < 0 || to >= ids.length) return;
    onReorder(moved(ids, i, to));
    // Moving the chip in the page can take the focus off its grip: put it back.
    requestAnimationFrame(() => {
      const grip = row.current?.querySelector<HTMLElement>(`[data-id="${CSS.escape(id)}"] .wheel-grip`);
      grip?.focus();
      grip?.scrollIntoView({ block: 'nearest', inline: 'nearest' });
    });
  };

  return (
    <div ref={(el) => { row.current = el; r.container.current = el; }} aria-label="Your teams, in order"
      className={`team-wheel${r.drag ? ' dragging' : ''}${more.l ? ' more-l' : ''}${more.r ? ' more-r' : ''}`}>
      {teams.map(({ id, team }, i) => (
        <span key={id} data-id={id} className={`digest-team${r.drag?.from === i ? ' is-drag' : ''}`} title={team.name} style={r.offset(i)}>
          <TeamBadge team={team} size={22} />
          {team.short}
          <button className="wheel-grip" {...r.handle(i)} onKeyDown={(e) => key(e, i, id)}
            aria-label={`Reorder ${team.short}, number ${i + 1} of ${ids.length}: drag, or press the left and right arrow keys`} title="Drag to reorder">
            <svg viewBox="0 0 24 24" aria-hidden="true">
              <circle cx="9.5" cy="6.5" r="1.6" /><circle cx="14.5" cy="6.5" r="1.6" /><circle cx="9.5" cy="12" r="1.6" />
              <circle cx="14.5" cy="12" r="1.6" /><circle cx="9.5" cy="17.5" r="1.6" /><circle cx="14.5" cy="17.5" r="1.6" />
            </svg>
          </button>
        </span>
      ))}
    </div>
  );
}
