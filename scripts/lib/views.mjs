// View counts for the cards (scripts/views.mjs writes public/data/views.json).

/** Counts are kept to 2 significant figures: what the site shows ("1.2M"), and the file only changes when that does. */
export function roundViews(n) {
  if (!Number.isFinite(n) || n < 0) return null;
  return n < 100 ? Math.round(n) : Number(n.toPrecision(2));
}

/**
 * Next views.json: every video still in a round file, with its fresh count when it was
 * re-read this run, else its last one. Videos gone from the rounds are dropped. Keys sorted,
 * so an unchanged map serializes the same.
 */
export function nextViews(prev, ids, fresh) {
  const out = {};
  for (const id of [...new Set(ids)].sort()) {
    const n = fresh.has(id) ? fresh.get(id) : prev?.[id];
    if (n != null) out[id] = n;
  }
  return out;
}
