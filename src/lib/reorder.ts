import { useRef, useState } from 'react';

/**
 * Drag to reorder a list of items laid out in a row ('x') or a column ('y'), with a mouse
 * or a finger, by a handle inside each item. While dragging, the item follows the pointer
 * (kept within the list) and the items it passes slide out of its way by its size; on
 * release `onMove(from, to)` is called. Items may differ in size (chips of different widths).
 *
 * The container holds the items as its direct children, in order. Give each handle the
 * props from `handle(i)` and each item the style from `offset(i)`. Handles need
 * `touch-action: none`, so a drag on them doesn't scroll the page.
 */
export function useReorder(axis: 'x' | 'y', onMove: (from: number, to: number) => void) {
  const container = useRef<HTMLElement | null>(null);
  const [drag, setDrag] = useState<{ from: number; to: number; d: number } | null>(null);
  /** Taken when the drag starts: where the pointer was, each item's start and end, how far the item moves per slot. */
  const geo = useRef({ start: 0, spans: [] as [number, number][], size: 0 });
  const pos = (e: { clientX: number; clientY: number }) => (axis === 'x' ? e.clientX : e.clientY);

  const down = (e: React.PointerEvent<HTMLElement>, i: number) => {
    if (e.button !== 0 || !container.current) return;
    e.preventDefault();
    e.currentTarget.setPointerCapture(e.pointerId);
    const spans = [...container.current.children].map((el): [number, number] => {
      const r = el.getBoundingClientRect();
      return axis === 'x' ? [r.left, r.right] : [r.top, r.bottom];
    });
    // An item's own size plus the gap to its neighbour: how far the others slide.
    const gap = spans.length > 1 ? spans[1][0] - spans[0][1] : 0;
    geo.current = { start: pos(e), spans, size: spans[i][1] - spans[i][0] + gap };
    setDrag({ from: i, to: i, d: 0 });
  };

  const move = (e: React.PointerEvent) => {
    if (!drag) return;
    const { start, spans } = geo.current;
    const [a, b] = spans[drag.from];
    const d = Math.max(spans[0][0] - a, Math.min(spans[spans.length - 1][1] - b, pos(e) - start));
    // It takes the place of every item whose middle its leading edge has passed.
    let to = drag.from;
    spans.forEach(([s, t], j) => {
      if (j > drag.from && b + d > (s + t) / 2) to = Math.max(to, j);
      if (j < drag.from && a + d < (s + t) / 2) to = Math.min(to, j);
    });
    setDrag({ ...drag, d, to });
  };

  const drop = (keep: boolean) => {
    if (drag && keep && drag.to !== drag.from) onMove(drag.from, drag.to);
    setDrag(null);
  };

  /** How far item i is moved now: the dragged one by the pointer, the ones it passed by its size. */
  const shift = (i: number) => {
    if (!drag) return 0;
    if (i === drag.from) return drag.d;
    if (drag.from < i && i <= drag.to) return -geo.current.size;
    if (drag.to <= i && i < drag.from) return geo.current.size;
    return 0;
  };

  return {
    container,
    /** The index being dragged, and where it would land. */
    drag,
    /** Where item i would be numbered if dropped now. */
    slot: (i: number) => (!drag ? i : i === drag.from ? drag.to : i + Math.sign(shift(i))),
    offset: (i: number): React.CSSProperties | undefined => {
      const s = shift(i);
      return s ? { transform: axis === 'x' ? `translateX(${s}px)` : `translateY(${s}px)` } : undefined;
    },
    handle: (i: number) => ({
      onPointerDown: (e: React.PointerEvent<HTMLElement>) => down(e, i),
      onPointerMove: move,
      onPointerUp: () => drop(true),
      onPointerCancel: () => drop(false),
    }),
  };
}

/** `list` with the item at `from` moved to `to`. */
export function moved<T>(list: T[], from: number, to: number): T[] {
  const next = [...list];
  next.splice(to, 0, ...next.splice(from, 1));
  return next;
}
