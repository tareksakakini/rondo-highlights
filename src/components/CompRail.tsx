import { useEffect, useRef } from 'react';
import type { Competition } from '../types';
import { compPath } from '../lib/routes';
import { CompMark } from './CompSwitcher';
import { useScrollEdges } from './SlateRow';

/**
 * Phones: every competition as one row of chips that scrolls sideways, so another league is
 * one tap away (wide screens use the headline picker, CompSwitcher). The current one is
 * filled in and kept in view; a lime dot marks competitions with new highlights.
 * scripts/prerender.ts draws the same row (compRail).
 */
export function CompRail({ comps, current, fresh, onPick }: {
  comps: Competition[];
  current: Competition;
  fresh: Set<string>;
  onPick: (c: Competition, e: React.MouseEvent) => void;
}) {
  const row = useRef<HTMLElement>(null);
  const more = useScrollEdges(row);

  // Bring the current competition into view, without moving the page.
  useEffect(() => {
    const el = row.current;
    const on = el?.querySelector<HTMLElement>('[aria-current="page"]');
    if (!el || !on || !el.clientWidth) return;
    const left = on.offsetLeft - (el.clientWidth - on.offsetWidth) / 2;
    el.scrollTo({ left: Math.max(0, left) });
  }, [current.code, comps.length]);

  return (
    <nav ref={row} className={`comp-rail${more.l ? ' more-l' : ''}${more.r ? ' more-r' : ''}`} aria-label="Competitions">
      {comps.map((c) => (
        <a key={c.code} className="cr-item" href={compPath(c)} style={{ '--c': c.color } as React.CSSProperties}
          aria-current={c.code === current.code ? 'page' : undefined}
          onClick={(e) => onPick(c, e)}>
          <CompMark comp={c} />
          {c.short ?? c.name}
          {fresh.has(c.code) && c.code !== current.code && <i className="cs-dot" title="New highlights" />}
        </a>
      ))}
    </nav>
  );
}
