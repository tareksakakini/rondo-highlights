#!/usr/bin/env node
// Run by the refresh workflow after it pushes new data: ask jsDelivr for the files a
// visit reads, so the CDN fetches them from GitHub now rather than while a visitor
// waits. A file jsDelivr hasn't served yet takes ~0.4-3 s; once it has, ~20 ms.
// Every refresh that changes what the site shows moves `rev`, so all round files
// get new URLs, and the purge of index.json empties its cache too.
//
// 1. index.json on the `data` branch: check that jsDelivr serves the copy just
//    pushed (the workflow purged it). If it still serves the old one, purge again
//    and retry, so a slow purge can't leave the old index cached for hours.
// 2. Each competition's current round and condensed.json (what a first visit reads),
//    then their crests. The site serves crests itself (scripts/lib/site-crests.mjs);
//    jsDelivr's copy is only the fallback for a crest added since the last site build,
//    and such a crest is in a current round.
// 3. Every other round file, for visitors who land on another page.
//
// It warms the jsDelivr servers the GitHub runner reaches, and jsDelivr's own copy
// of the files, so a visitor whose nearby server is still empty no longer waits
// for GitHub. It never fails the refresh: problems are logged as warnings.
//
//   node scripts/warm-cdn.mjs [dataDir=public/data]   (GITHUB_REPOSITORY=owner/repo)

import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const SHA = /^[0-9a-f]{40}$/;
const CREST = /^crests\/[\w.-]+\.webp$/;

async function exists(file) {
  try { await fs.access(file); return true; } catch { return false; }
}

async function readJson(file) {
  try { return JSON.parse(await fs.readFile(file, 'utf8')); } catch { return null; }
}

/**
 * The files to warm, in order: [{ ref, path, first }]. `ref` is the commit to read
 * them at; `first` marks what a first visit to a competition's current round reads.
 */
export async function plan(dir) {
  const index = await readJson(path.join(dir, 'index.json'));
  if (!index || !SHA.test(index.rev)) throw new Error(`${dir}/index.json has no rev`);
  const rev = index.rev;
  const crestsRev = SHA.test(index.crestsRev) ? index.crestsRev : rev;
  const first = [];
  const rest = [];
  const firstCrests = new Set();
  for (const comp of index.competitions ?? []) {
    for (const round of comp.rounds ?? []) {
      const file = `${comp.code}/${round.key}.json`;
      if (!(await exists(path.join(dir, file)))) continue;
      if (round.key === comp.currentRound) {
        first.push(file);
        const data = await readJson(path.join(dir, file));
        for (const m of data?.matches ?? []) {
          for (const side of [m.home, m.away]) if (CREST.test(side?.crest ?? '')) firstCrests.add(side.crest);
        }
      } else {
        rest.push(file);
      }
    }
  }
  if (await exists(path.join(dir, 'condensed.json'))) first.push('condensed.json');
  return [
    ...first.map((p) => ({ ref: rev, path: p, first: true })),
    ...[...firstCrests].sort().map((p) => ({ ref: crestsRev, path: p, first: true })),
    ...rest.map((p) => ({ ref: rev, path: p, first: false })),
  ];
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * Make sure jsDelivr serves the index just pushed. Returns the number of tries it
 * took, or 0 if it still served an old copy after the last one.
 */
export async function checkIndex(cdn, purgeBase, local, { fetch = globalThis.fetch, wait = sleep, delays = [3000, 5000, 10000, 20000, 30000] } = {}) {
  const want = JSON.stringify(local);
  for (let i = 0; i < delays.length; i++) {
    await wait(delays[i]);
    let got = null;
    try {
      const r = await fetch(`${cdn}@data/index.json`);
      if (r.ok) got = JSON.stringify(await r.json());
      else console.log(`  index.json: HTTP ${r.status}`);
    } catch (e) {
      console.log(`  index.json: ${e.message}`);
    }
    if (got === want) return i + 1;
    console.log(`  index.json: jsDelivr still serves an older copy (try ${i + 1}); purging again`);
    try { await fetch(`${purgeBase}@data/index.json`); } catch { /* the next try tells */ }
  }
  return 0;
}

/**
 * GET each URL (reading the body), `concurrency` at a time. A failure is retried
 * after each of `retryDelays`: jsDelivr sometimes answers 404 "Failed to fetch the
 * requested commit" for a commit it can read a moment later.
 */
export async function warm(urls, { fetch = globalThis.fetch, concurrency = 8, retryDelays = [2000, 6000], wait = sleep, now = () => performance.now() } = {}) {
  const results = new Array(urls.length);
  let next = 0;
  async function one(url) {
    const t = now();
    try {
      const r = await fetch(url);
      await r.arrayBuffer();
      return { url, status: r.status, ok: r.ok, ms: Math.round(now() - t) };
    } catch (e) {
      return { url, status: 0, ok: false, ms: Math.round(now() - t), error: e.message };
    }
  }
  async function worker() {
    while (next < urls.length) {
      const i = next++;
      let res = await one(urls[i]);
      for (let k = 0; !res.ok && k < retryDelays.length; k++) {
        await wait(retryDelays[k]);
        res = { ...(await one(urls[i])), retries: k + 1 };
      }
      results[i] = res;
    }
  }
  await Promise.all(Array.from({ length: Math.min(concurrency, urls.length) }, worker));
  return results;
}

function summary(results) {
  const ms = results.filter((r) => r.ok).map((r) => r.ms).sort((a, b) => a - b);
  const q = (p) => (ms.length ? ms[Math.min(ms.length - 1, Math.floor(p * ms.length))] : 0);
  const slow = ms.filter((x) => x > 300).length;
  const retried = results.filter((r) => r.ok && r.retries).length;
  return `${ms.length}/${results.length} ok${retried ? ` (${retried} after a retry)` : ''}; ${slow} took over 300 ms (not cached yet); median ${q(0.5)} ms, p90 ${q(0.9)} ms, max ${q(1)} ms`;
}

async function main() {
  const dir = process.argv[2] ?? 'public/data';
  const repo = process.env.GITHUB_REPOSITORY;
  if (!repo) throw new Error('GITHUB_REPOSITORY is not set (owner/repo)');
  const cdn = `https://cdn.jsdelivr.net/gh/${repo}`;
  const purgeBase = `https://purge.jsdelivr.net/gh/${repo}`;

  const local = await readJson(path.join(dir, 'index.json'));
  const tries = await checkIndex(cdn, purgeBase, local);
  if (tries) console.log(`index.json: jsDelivr serves the new copy (try ${tries})`);
  else console.log('::warning::jsDelivr still serves an old index.json; visitors may see older highlights until its cache expires');

  const files = await plan(dir);
  const urls = files.map((f) => `${cdn}@${f.ref}/${f.path}`);
  const t = performance.now();
  const results = await warm(urls);
  console.log(`warmed ${urls.length} files in ${((performance.now() - t) / 1000).toFixed(1)} s`);
  console.log(`  current rounds, condensed.json and their crests: ${summary(results.filter((_, i) => files[i].first))}`);
  console.log(`  everything else: ${summary(results.filter((_, i) => !files[i].first))}`);
  for (const r of results.filter((x) => !x.ok)) console.log(`::warning::could not warm ${r.url}: ${r.error ?? `HTTP ${r.status}`}`);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main().catch((e) => { console.log(`::warning::CDN warming failed: ${e.message}`); });
}
