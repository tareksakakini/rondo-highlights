#!/usr/bin/env node
// The refresh clock: decides when the data needs refreshing and starts the "Refresh data"
// workflow then. Run by .github/workflows/refresh-clock.yml.
//
// GitHub's scheduled runs are best-effort: a 2-hourly schedule ran about every 6 hours
// (up to 9.5 h apart) in late September 2026. So the clock's schedule is dense (every
// 10 minutes, and it's fine if many of those are dropped), each tick is cheap (no npm
// install, no API quota), and while matches are finishing the tick stays awake and keeps
// checking every few minutes instead of relying on the next tick turning up.
//
// When to refresh comes from the fixtures already on the data branch (lib/refresh-plan.mjs).
// Only one clock is on duty at a time: a tick that finds an older clock running exits.
//
//   node scripts/refresh-clock.mjs           (in Actions: needs GH_TOKEN with actions: write)
//   node scripts/refresh-clock.mjs --dry     (print the plan, start nothing; works locally with gh)

import { execFileSync } from 'node:child_process';
import { planRefresh, matchesFrom } from './lib/refresh-plan.mjs';

const dry = process.argv.includes('--dry');
const REFRESH = 'refresh-data.yml';
const CLOCK = 'refresh-clock.yml';
const ref = process.env.GITHUB_REF_NAME || 'main';
const myRun = Number(process.env.GITHUB_RUN_ID || 0);

// Stay awake while the next check is at most this far off; past that, leave it to the
// next scheduled tick. The job's timeout (refresh-clock.yml) is above MAX_AWAKE_MIN.
const STAY_AWAKE_MIN = 25;
const MAX_AWAKE_MIN = 300;
// If the data branch can't be read, still refresh at least this often.
const FALLBACK_EVERY_H = 2;

const started = Date.now();
const log = (...a) => console.log(`[${new Date().toISOString().slice(11, 16)}Z]`, ...a);
const gh = (...args) => execFileSync('gh', args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
const git = (...args) => execFileSync('git', args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], maxBuffer: 64 << 20 });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const ACTIVE = new Set(['queued', 'in_progress', 'waiting', 'requested', 'pending']);

function runs(workflow, limit) {
  return JSON.parse(gh('run', 'list', '--workflow', workflow, '--limit', String(limit),
    '--json', 'databaseId,status,conclusion,createdAt,displayTitle'));
}

/** Refresh runs: when the last one started, the last full one, and whether one is going now. */
function refreshHistory() {
  const list = runs(REFRESH, 40).filter((r) => r.conclusion !== 'cancelled' && r.conclusion !== 'skipped');
  const t = (r) => (r ? Date.parse(r.createdAt) : null);
  // run-name in refresh-data.yml puts the mode in the title: "Refresh data · full · …"
  const full = list.filter((r) => / · full\b/.test(r.displayTitle));
  const good = full.find((r) => r.conclusion === 'success' || ACTIVE.has(r.status));
  const failed = full.find((r) => r.status === 'completed' && r.conclusion !== 'success');
  return {
    active: list.some((r) => ACTIVE.has(r.status)),
    lastRun: t(list[0]),
    lastFull: t(good),
    lastFullFailed: failed && (!good || Date.parse(failed.createdAt) > Date.parse(good.createdAt)) ? t(failed) : null,
  };
}

/** The current data branch's matches. */
function readMatches(now) {
  git('fetch', '--quiet', '--depth=1', 'origin', 'data');
  const show = (p) => { try { return JSON.parse(git('show', `FETCH_HEAD:${p}`)); } catch { return null; } };
  const index = show('index.json');
  if (!index) throw new Error('no index.json on the data branch');
  return matchesFrom(index, async (code, key) => show(`${code}/${key}.json`), now);
}

async function plan() {
  const now = Date.now();
  const history = refreshHistory();
  let p;
  try {
    const { lastRun, lastFull, lastFullFailed } = history;
    p = planRefresh({ now, matches: await readMatches(now), lastRun, lastFull, lastFullFailed });
  } catch (e) {
    log(`! could not read the data branch (${e.message}): refreshing every ${FALLBACK_EVERY_H} h until it can`);
    const due = history.lastRun == null || now - history.lastRun >= FALLBACK_EVERY_H * 3600e3;
    p = { due, mode: 'quick', only: null, reason: 'fallback check', nextAt: now + 30 * 60e3 };
  }
  return { ...p, active: history.active };
}

function start(p) {
  const args = ['workflow', 'run', REFRESH, '--ref', ref, '-f', `mode=${p.mode}`, '-f', `reason=${p.reason.slice(0, 120)}`];
  if (p.only) args.push('-f', `only=${p.only.join(',')}`);
  if (dry) { log(`(dry) would run: gh ${args.join(' ')}`); return; }
  gh(...args);
  log(`started a ${p.mode} refresh${p.only ? ` of ${p.only.join(', ')}` : ''}: ${p.reason}`);
}

async function main() {
  if (myRun && !dry) {
    const older = runs(CLOCK, 20).filter((r) => r.status === 'in_progress' && r.databaseId < myRun);
    if (older.length) { log(`clock run ${older[0].databaseId} is already on duty`); return; }
  }
  for (;;) {
    const p = await plan();
    const when = new Date(p.nextAt).toISOString().slice(11, 16);
    if (p.due && p.active) log(`refresh due (${p.reason}), but one is already running`);
    else if (p.due) start(p);
    else log(`nothing due; next check ${when}Z`);

    const wait = p.nextAt - Date.now();
    if (dry || wait > STAY_AWAKE_MIN * 60e3) break;
    if (Date.now() + wait - started > MAX_AWAKE_MIN * 60e3) { log('awake long enough, handing over to the next tick'); break; }
    // A refresh is already running: look again soon rather than at the planned time.
    await sleep(p.due && p.active ? 3 * 60e3 : Math.max(wait, 60e3));
  }
}

main().catch((e) => {
  console.error(`✖ ${e.stderr?.toString().trim() || e.message}`);
  process.exit(1);
});
