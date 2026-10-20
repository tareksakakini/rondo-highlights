import { useEffect, useRef, useState } from 'react';

/** Whether a sideways-scrolling row has more to scroll to on its left and right (for the edge fades). */
export function useScrollEdges(row: React.RefObject<HTMLElement | null>) {
  const [more, setMore] = useState({ l: false, r: false });
  useEffect(() => {
    const el = row.current;
    if (!el) return;
    const update = () => {
      const l = el.scrollLeft > 2;
      const r = el.scrollLeft + el.clientWidth < el.scrollWidth - 2;
      setMore((m) => (m.l === l && m.r === r ? m : { l, r }));
    };
    update();
    el.addEventListener('scroll', update, { passive: true });
    const ro = new ResizeObserver(update);
    ro.observe(el);
    // Items added or removed change the width to scroll without resizing the row.
    const mo = new MutationObserver(update);
    mo.observe(el, { childList: true });
    return () => { el.removeEventListener('scroll', update); ro.disconnect(); mo.disconnect(); };
  }, [row]);
  return more;
}

/**
 * One slate of the favorites digest as a single row of cards that scrolls sideways:
 * swipe on phones, the arrows by the heading (or a trackpad) elsewhere. Each side fades
 * while there's more to scroll to.
 */
export function SlateRow({ head, label, children }: { head: React.ReactNode; label: string; children: React.ReactNode }) {
  const row = useRef<HTMLDivElement>(null);
  const more = useScrollEdges(row);

  /** A page of cards at a time, keeping the last one in view. */
  const page = (dir: 1 | -1) => {
    const el = row.current;
    if (!el) return;
    const card = el.firstElementChild?.getBoundingClientRect().width ?? 260;
    el.scrollBy({ left: dir * Math.max(card, el.clientWidth - card), behavior: 'smooth' });
  };

  return (
    <>
      <div className="slate-head">
        {head}
        {(more.l || more.r) && (
          <span className="slate-arrows">
            <button className="btn-icon sm" onClick={() => page(-1)} disabled={!more.l} aria-label={`Earlier in ${label}`}>
              <svg viewBox="0 0 24 24"><path d="M15.4 7.4 14 6l-6 6 6 6 1.4-1.4-4.6-4.6z" /></svg>
            </button>
            <button className="btn-icon sm" onClick={() => page(1)} disabled={!more.r} aria-label={`Later in ${label}`}>
              <svg viewBox="0 0 24 24"><path d="M8.6 16.6 10 18l6-6-6-6-1.4 1.4 4.6 4.6z" /></svg>
            </button>
          </span>
        )}
      </div>
      <div ref={row} className={`slate-row${more.l ? ' more-l' : ''}${more.r ? ' more-r' : ''}`}>{children}</div>
    </>
  );
}
