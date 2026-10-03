import { useEffect, useId, useRef, useState } from 'react';
import type { Competition } from '../types';
import { compPath } from '../lib/routes';

const GROUPS: { key: NonNullable<Competition['group']>; label: string }[] = [
  { key: 'league', label: 'Leagues' },
  { key: 'europe', label: 'European cups' },
  { key: 'national', label: 'National teams' },
];

/** Country flags for the leagues; a star for European competitions, a globe for world ones. */
export function CompMark({ comp }: { comp: Competition }) {
  const flag: Record<string, React.ReactNode> = {
    England: <><rect width="20" height="14" fill="#fff" /><rect x="8.4" width="3.2" height="14" fill="#CE1124" /><rect y="5.4" width="20" height="3.2" fill="#CE1124" /></>,
    Spain: <><rect width="20" height="14" fill="#AA151B" /><rect y="3.5" width="20" height="7" fill="#F1BF00" /></>,
    Italy: <><rect width="20" height="14" fill="#fff" /><rect width="6.7" height="14" fill="#009246" /><rect x="13.3" width="6.7" height="14" fill="#CE2B37" /></>,
    Germany: <><rect width="20" height="4.7" fill="#000" /><rect y="4.6" width="20" height="4.8" fill="#DD0000" /><rect y="9.3" width="20" height="4.7" fill="#FFCE00" /></>,
    France: <><rect width="20" height="14" fill="#fff" /><rect width="6.7" height="14" fill="#002395" /><rect x="13.3" width="6.7" height="14" fill="#ED2939" /></>,
  };
  const icon = flag[comp.country] ?? (
    <>
      <rect width="20" height="14" fill="var(--surface-2)" />
      {comp.country === 'World'
        ? <g fill="none" stroke={comp.color} strokeWidth="1.1"><circle cx="10" cy="7" r="4.6" /><ellipse cx="10" cy="7" rx="2" ry="4.6" /><path d="M5.4 7h9.2" /></g>
        : <path d="m10 2.3 1.4 2.9 3.2.4-2.3 2.2.6 3.2L10 9.5 7.1 11l.6-3.2-2.3-2.2 3.2-.4z" fill={comp.color} />}
    </>
  );
  return <svg className="comp-mark" viewBox="0 0 20 14" aria-hidden="true">{icon}</svg>;
}

const roundLabel = (c: Competition) => c.rounds.find((r) => r.key === c.currentRound)?.label ?? '';

/**
 * The competition picker: a button with the current competition that opens every
 * competition, grouped, with its current round (a dropdown on wide screens, a sheet from
 * the bottom on phones). A lime dot marks competitions with new highlights since last seen.
 */
export function CompSwitcher({ comps, current, fresh, onPick }: {
  comps: Competition[];
  current: Competition;
  fresh: Set<string>;
  onPick: (c: Competition, e: React.MouseEvent) => void;
}) {
  const [open, setOpen] = useState(false);
  const btn = useRef<HTMLButtonElement>(null);
  const list = useRef<HTMLDivElement>(null);
  const id = useId();
  const freshElsewhere = comps.some((c) => c.code !== current.code && fresh.has(c.code));

  const close = (refocus = true) => { setOpen(false); if (refocus) btn.current?.focus(); };

  useEffect(() => {
    if (!open) return;
    list.current?.querySelector<HTMLElement>('[aria-current="page"]')?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { e.preventDefault(); close(); return; }
      if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return;
      const items = [...(list.current?.querySelectorAll<HTMLElement>('.cs-item') ?? [])];
      const i = items.indexOf(document.activeElement as HTMLElement);
      const next = items[(i + (e.key === 'ArrowDown' ? 1 : -1) + items.length) % items.length];
      if (next) { e.preventDefault(); next.focus(); }
    };
    document.addEventListener('keydown', onKey);
    // The sheet covers the page on phones; keep the page from scrolling under it.
    document.documentElement.classList.add('cs-open');
    return () => { document.removeEventListener('keydown', onKey); document.documentElement.classList.remove('cs-open'); };
  }, [open]);

  const groups = GROUPS.map((g) => ({ ...g, comps: comps.filter((c) => (c.group ?? 'league') === g.key) })).filter((g) => g.comps.length);

  return (
    <div className={`comp-switch${open ? ' is-open' : ''}`}>
      <button ref={btn} className="cs-button" style={{ '--c': current.color } as React.CSSProperties}
        aria-expanded={open} aria-controls={id} onClick={() => setOpen(!open)}>
        <CompMark comp={current} />
        <span className="cs-name">{current.short ?? current.name}</span>
        <svg className="cs-caret" viewBox="0 0 24 24" aria-hidden="true"><path d="m7 10 5 5 5-5z" /></svg>
        {freshElsewhere && <i className="cs-fresh" title="New highlights in other competitions" />}
        <span className="sr-only">: change competition{freshElsewhere ? ' (new highlights elsewhere)' : ''}</span>
      </button>
      {open && (
        <>
          <div className="cs-backdrop" onClick={() => close(false)} />
          <div className="cs-panel" id={id} ref={list} role="dialog" aria-label="Competitions">
            <div className="cs-grab" aria-hidden="true" />
            <div className="cs-cols">
              {[groups.slice(0, 1), groups.slice(1)].map((col, i) => col.length > 0 && (
                <div className="cs-col" key={i}>
                  {col.map((g) => (
                    <div className="cs-group" key={g.key}>
                      <div className="cs-label">{g.label}</div>
                      {g.comps.map((c) => (
                        <a key={c.code} className="cs-item" href={compPath(c)} style={{ '--c': c.color } as React.CSSProperties}
                          aria-current={c.code === current.code ? 'page' : undefined}
                          onClick={(e) => { onPick(c, e); if (!e.defaultPrevented) return; close(false); }}>
                          <CompMark comp={c} />
                          <span className="cs-item-name">{c.short ?? c.name}</span>
                          {fresh.has(c.code) && <i className="cs-dot" title="New highlights" />}
                          <span className="cs-round">{roundLabel(c)}</span>
                        </a>
                      ))}
                    </div>
                  ))}
                </div>
              ))}
            </div>
          </div>
        </>
      )}
    </div>
  );
}
