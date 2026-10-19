// When to refresh the data, from the fixtures we already have (used by scripts/refresh-clock.mjs).
//
// Highlights go up ~20-60 minutes after full time, in bursts (weekend afternoons and
// evenings, European nights), so a fixed timer is either too slow on a Saturday or wasteful
// on a quiet Tuesday. Instead:
//   - "hot" matches, from HOT_FROM_MIN after kick-off until HOT_UNTIL_H: refresh every
//     HOT_EVERY_MIN, reading only the competitions involved (a quick run);
//   - finished matches still without a widely playable highlight (see isCovered): every LATE_EVERY_MIN until LATE_SOON_H
//     after kick-off, then every LATER_EVERY_H until LATE_UNTIL_H (the Bundesliga holds
//     Saturday 15:30 games back ~30 h; Ligue 1 is sometimes a day late);
//   - otherwise every IDLE_EVERY_H (fixture changes, scores), quick, every competition;
//   - and a full run every FULL_EVERY_H (10 days of uploads, every stored video re-checked).

export const HOT_FROM_MIN = 100;
export const HOT_UNTIL_H = 4;
export const HOT_EVERY_MIN = 10;
export const LATE_SOON_H = 12;
export const LATE_EVERY_MIN = 60;
export const LATE_UNTIL_H = 54;
export const LATER_EVERY_H = 3;
export const IDLE_EVERY_H = 6;
export const FULL_EVERY_H = 22;
export const FULL_RETRY_H = 2; // after a failed full run (not every tick: a run can fail after spending quota)
// A run started this much early still counts (GitHub starts runs a little late or early).
const SLACK_MS = 2 * 60e3;

/**
 * Countries most of our visitors are in. A match whose videos so far are all limited to
 * other countries (Sky's cut is UK only; NBC's US cut comes later) isn't covered yet.
 */
export const KEY_REGIONS = ['US', 'GB'];

const playsIn = (h, c) => (h.allow ? h.allow.includes(c) : !h.block?.includes(c));

/** Has a highlight that plays everywhere, or one for each of KEY_REGIONS. */
export function isCovered(highlights = []) {
  return highlights.some((h) => !h.allow && !h.block?.length)
    || (highlights.length > 0 && KEY_REGIONS.every((c) => highlights.some((h) => playsIn(h, c))));
}

const MIN = 60e3;
const HOUR = 3600e3;
const SKIP = /^(POSTPONED|CANCELLED|SUSPENDED)$/;

/** "Man United v Tottenham", "Man United v Tottenham and 2 more" */
function names(list) {
  const shown = list.slice(0, 2).map((m) => m.label);
  return list.length > 2 ? `${shown.join(', ')} and ${list.length - 2} more` : shown.join(', ');
}

const comps = (list) => [...new Set(list.map((m) => m.comp))];

/**
 * @param now       ms
 * @param matches   [{ comp, label, utcDate, status, covered }] (covered: isCovered, a widely playable highlight is in)
 * @param lastRun   ms when the last refresh run started (any mode), or null
 * @param lastFull  ms when the last successful full run started, or null
 * @param lastFullFailed ms when the last full run that failed started, if it came after that, or null
 * @returns { due, mode: 'full'|'quick', only: string[]|null (null = every competition), reason, nextAt }
 *          nextAt: when this should be asked again (the next time something could become due).
 */
export function planRefresh({ now, matches, lastRun = null, lastFull = null, lastFullFailed = null }) {
  const live = matches.filter((m) => m.utcDate && !SKIP.test(m.status ?? ''));
  const age = (m) => now - Date.parse(m.utcDate);
  const hot = live.filter((m) => age(m) >= HOT_FROM_MIN * MIN && age(m) <= HOT_UNTIL_H * HOUR);
  const late = live.filter((m) => !m.covered && age(m) > HOT_UNTIL_H * HOUR && age(m) <= LATE_UNTIL_H * HOUR);
  const lateEvery = late.some((m) => age(m) <= LATE_SOON_H * HOUR) ? LATE_EVERY_MIN * MIN : LATER_EVERY_H * HOUR;
  const since = lastRun == null ? Infinity : now - lastRun;
  const waited = (ms) => since >= ms - SLACK_MS;

  // When the next full run is due: FULL_EVERY_H after the last good one, FULL_RETRY_H after a failure.
  const fullDueAt = Math.max(
    lastFull == null ? -Infinity : lastFull + FULL_EVERY_H * HOUR,
    lastFullFailed == null ? -Infinity : lastFullFailed + FULL_RETRY_H * HOUR,
  );
  let plan = { due: false, mode: 'quick', only: null, reason: '' };
  if (now >= fullDueAt - SLACK_MS) {
    plan = { due: true, mode: 'full', only: null, reason: 'daily full refresh' };
  } else if (hot.length && waited(HOT_EVERY_MIN * MIN)) {
    plan = { due: true, mode: 'quick', only: comps([...hot, ...late]), reason: `just finished: ${names(hot)}` };
  } else if (late.length && waited(lateEvery)) {
    plan = { due: true, mode: 'quick', only: comps(late), reason: `still no widely playable highlights: ${names(late)}` };
  } else if (waited(IDLE_EVERY_H * HOUR)) {
    plan = { due: true, mode: 'quick', only: null, reason: 'routine check' };
  }

  // The next moment worth asking again.
  const ran = plan.due ? now : lastRun ?? now;
  const times = [ran + IDLE_EVERY_H * HOUR, plan.mode === 'full' && plan.due ? now + FULL_EVERY_H * HOUR : fullDueAt];
  if (hot.length) times.push(ran + HOT_EVERY_MIN * MIN);
  if (late.length) times.push(ran + lateEvery);
  for (const m of live) {
    const startsHot = Date.parse(m.utcDate) + HOT_FROM_MIN * MIN;
    if (startsHot > now) times.push(startsHot);
  }
  const nextAt = Math.max(now + MIN, Math.min(...times.filter((t) => t > now)));
  return { ...plan, nextAt };
}

/** The matches planRefresh looks at, from index.json and a reader of round files. */
export async function matchesFrom(index, readRound, now) {
  const out = [];
  for (const c of index?.competitions ?? []) {
    if (c.source !== 'live') continue;
    // Rounds that started up to LATE_UNTIL_H + a week ago (rounds spread out) or start within a day.
    const keys = (c.rounds ?? [])
      .filter((r) => r.key === c.currentRound
        || (Date.parse(r.firstDate) >= now - (LATE_UNTIL_H * HOUR + 7 * 24 * HOUR) && Date.parse(r.firstDate) <= now + 24 * HOUR))
      .map((r) => r.key);
    for (const key of keys) {
      const round = await readRound(c.code, key);
      for (const m of round?.matches ?? []) {
        out.push({
          comp: c.code,
          label: `${m.home?.short ?? m.home?.name} v ${m.away?.short ?? m.away?.name}`,
          utcDate: m.utcDate,
          status: m.status,
          covered: isCovered(m.highlights),
        });
      }
    }
  }
  return out;
}
