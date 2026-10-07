import { useEffect, useId, useLayoutEffect, useRef, useState } from 'react';
import type { Competition, RoundMeta } from '../types';

/**
 * How a round shows in the picker: "Matchweek 12" → tile 12 under "Matchweeks",
 * "League phase · MD 3" → tile 3 under "League phase", "Round of 16" → a row under "Knockouts".
 */
function parse(label: string): { group: string; num: number | null; name: string } {
  let m = /^(Matchweek|Matchday) (\d+)$/.exec(label);
  if (m) return { group: `${m[1]}s`, num: +m[2], name: label };
  m = /^(.+?) · (.+)$/.exec(label);
  if (m) {
    const n = /^(?:MD|Matchday|Matchweek) (\d+)$/.exec(m[2]);
    return { group: m[1], num: n ? +n[1] : null, name: m[2] };
  }
  return { group: 'Knockouts', num: null, name: label };
}

const day = new Intl.DateTimeFormat(undefined, { day: 'numeric', month: 'short' });
const when = (r: RoundMeta) => (r.firstDate ? day.format(new Date(r.firstDate)) : '');
/** Rounds whose highlights aren't in yet (or which haven't been played). */
const upcoming = (r: RoundMeta) => !r.withHighlights;

/**
 * The round picker, built like the competition picker: a button with the current round that
 * opens every round of the competition (a dropdown on wide screens, a sheet from the bottom
 * on phones). Numbered rounds are a grid of tiles; knockout rounds are rows.
 */
export function RoundPicker({ comp, roundKey, hrefFor, onPick }: {
  comp: Competition;
  roundKey: string | null;
  hrefFor: (key: string) => string;
  onPick: (key: string, e: React.MouseEvent) => void;
}) {
  const [open, setOpen] = useState(false);
  const btn = useRef<HTMLButtonElement>(null);
  const panel = useRef<HTMLDivElement>(null);
  const id = useId();
  const current = comp.rounds.find((r) => r.key === roundKey);

  const close = (refocus = true) => { setOpen(false); if (refocus) btn.current?.focus(); };

  // Close when the competition changes underneath.
  useEffect(() => { setOpen(false); }, [comp.code]);

  // As a dropdown, keep the panel on screen: shift it left when the round sits far right.
  useLayoutEffect(() => {
    const el = panel.current;
    if (!open || !el || getComputedStyle(el).position !== 'absolute') return;
    const over = el.getBoundingClientRect().right - (document.documentElement.clientWidth - 16);
    if (over > 0) el.style.left = `${-over}px`;
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const here = panel.current?.querySelector<HTMLElement>('[aria-current="page"]');
    here?.focus();
    here?.scrollIntoView({ block: 'nearest' });
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { e.preventDefault(); close(); return; }
      const items = [...(panel.current?.querySelectorAll<HTMLElement>('.rp-item') ?? [])];
      const i = items.indexOf(document.activeElement as HTMLElement);
      let next: HTMLElement | undefined;
      if (e.key === 'Home') next = items[0];
      else if (e.key === 'End') next = items[items.length - 1];
      else if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
        next = items[Math.min(items.length - 1, Math.max(0, i + (e.key === 'ArrowRight' ? 1 : -1)))];
      } else if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
        // Move to the nearest item on the row above or below.
        const down = e.key === 'ArrowDown';
        const from = items[i]?.getBoundingClientRect();
        if (!from) next = items[0];
        else {
          const cx = from.left + from.width / 2;
          const rows = items.map((el) => el.getBoundingClientRect())
            .map((r, j) => ({ j, top: r.top, dx: Math.abs(r.left + r.width / 2 - cx) }))
            .filter((r) => (down ? r.top > from.top + 2 : r.top < from.top - 2));
          if (rows.length) {
            const rowTop = down ? Math.min(...rows.map((r) => r.top)) : Math.max(...rows.map((r) => r.top));
            const row = rows.filter((r) => Math.abs(r.top - rowTop) < 2).sort((a, b) => a.dx - b.dx);
            next = items[row[0].j];
          }
        }
      } else return;
      e.preventDefault();
      if (next) { next.focus(); next.scrollIntoView({ block: 'nearest' }); }
    };
    document.addEventListener('keydown', onKey);
    // The sheet covers the page on phones; keep the page from scrolling under it.
    document.documentElement.classList.add('cs-open');
    return () => { document.removeEventListener('keydown', onKey); document.documentElement.classList.remove('cs-open'); };
  }, [open]);

  const groups: { label: string; tiles: RoundMeta[]; rows: RoundMeta[] }[] = [];
  for (const r of comp.rounds) {
    const p = parse(r.label);
    let g = groups.find((x) => x.label === p.group);
    if (!g) groups.push(g = { label: p.group, tiles: [], rows: [] });
    (p.num != null ? g.tiles : g.rows).push(r);
  }

  const item = (r: RoundMeta, cls: string, content: React.ReactNode) => (
    <a key={r.key} className={`rp-item ${cls}${upcoming(r) ? ' is-upcoming' : ''}`} href={hrefFor(r.key)}
      aria-current={r.key === roundKey ? 'page' : undefined}
      aria-label={`${r.label}${upcoming(r) ? ', upcoming' : ''}`}
      title={[r.label, when(r)].filter(Boolean).join(' · ')}
      onClick={(e) => { onPick(r.key, e); if (e.defaultPrevented) close(false); }}>
      {content}
    </a>
  );

  return (
    <div className={`round-select${open ? ' is-open' : ''}`} style={{ '--c': comp.color } as React.CSSProperties}>
      <button ref={btn} className="rs-button" aria-expanded={open} aria-controls={id} onClick={() => setOpen(!open)}>
        <span className="rs-name">{current?.label ?? ''}</span>
        <svg className="cs-caret" viewBox="0 0 24 24" aria-hidden="true"><path d="m7 10 5 5 5-5z" /></svg>
        <span className="sr-only">: change round</span>
      </button>
      {open && (
        <>
          <div className="cs-backdrop" onClick={() => close(false)} />
          <div className="cs-panel rp-panel" id={id} ref={panel} role="dialog" aria-label="Rounds">
            <div className="cs-grab" aria-hidden="true" />
            {groups.map((g) => (
              <div className="cs-group" key={g.label}>
                <div className="cs-label">{g.label}</div>
                {g.tiles.length > 0 && (
                  <div className="rp-tiles">
                    {g.tiles.map((r) => item(r, 'rp-tile', parse(r.label).num))}
                  </div>
                )}
                {g.rows.map((r) => item(r, 'rp-row', <>
                  <span className="rp-row-name">{parse(r.label).name}</span>
                  <span className="cs-round">{upcoming(r) ? when(r) || 'Upcoming' : when(r)}</span>
                </>))}
              </div>
            ))}
          </div>
        </>
      )}
    </div>
  );
}
