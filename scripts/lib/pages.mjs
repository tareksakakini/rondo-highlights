// The data behind the prerendered pages (see vite.config.ts), and a fingerprint of it.
//
// Pages only show competitions, rounds and who plays whom: no scores, dates or
// highlight counts. That data rarely changes during a season, so the site only
// needs redeploying when the fingerprint changes (scripts/check-pages.mjs), which
// keeps Netlify deploys (and credits) to a minimum.

import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { isExcludedMatch } from './excluded.mjs';

const teamName = (t) => t?.short || t?.name || 'TBD';
export const CREST = /^crests\/[0-9a-f]{12}\.webp$/;

/**
 * @param {any} index  index.json
 * @param {(code: string, key: string) => Promise<any>} readRound  a round file
 */
export async function buildModel(index, readRound) {
  const competitions = [];
  const crests = new Set(); // self-hosted crests the rounds use (copied into the site: scripts/lib/site-crests.mjs)
  for (const c of index.competitions) {
    const rounds = [];
    for (const r of c.rounds) {
      if (!r.matches) continue;
      const file = await readRound(c.code, r.key);
      const shown = (file?.matches ?? []).filter((m) => !isExcludedMatch(m));
      for (const m of shown) for (const t of [m.home, m.away]) if (CREST.test(t?.crest ?? '')) crests.add(t.crest);
      const fixtures = shown.map((m) => `${teamName(m.home)} v ${teamName(m.away)}`);
      if (fixtures.length) rounds.push({ key: r.key, label: r.label, fixtures });
    }
    if (rounds.length) {
      competitions.push({
        code: c.code, name: c.name, short: c.short ?? null, group: c.group ?? 'league',
        color: c.color, seasonLabel: c.seasonLabel, rounds,
      });
    }
  }
  return { competitions, crests: [...crests].sort() };
}

/** Changes only when something a page shows changes (fixture order within a round is ignored). */
export function fingerprint(model) {
  const stable = model.competitions.map((c) => ({
    ...c,
    rounds: c.rounds.map((r) => ({ ...r, fixtures: [...r.fixtures].sort() })),
  }));
  return createHash('sha256').update(JSON.stringify(stable)).digest('hex').slice(0, 16);
}

/** From a checked-out data branch (public/data locally and in the refresh workflow). */
export async function loadModelFromDir(dir) {
  const index = JSON.parse(fs.readFileSync(path.join(dir, 'index.json'), 'utf8'));
  const model = await buildModel(index, async (code, key) => {
    const f = path.join(dir, code, `${key}.json`);
    return fs.existsSync(f) ? JSON.parse(fs.readFileSync(f, 'utf8')) : null;
  });
  return { ...model, crestSource: { dir } };
}

/** From GitHub (Netlify builds): index.json from the data branch (or `indexRef`), rounds from the commit it names. */
export async function loadModelFromRepo(repo, { fetchImpl = fetch, concurrency = 12, indexRef = 'data' } = {}) {
  const raw = (ref, p) => `https://raw.githubusercontent.com/${repo}/${ref}/${p}`;
  const get = async (url) => {
    for (let attempt = 1; ; attempt++) {
      const r = await fetchImpl(url);
      if (r.ok) return r.json();
      if (r.status === 404) return null;
      if (attempt >= 3) throw new Error(`${r.status} fetching ${url}`);
      await new Promise((res) => setTimeout(res, 500 * attempt));
    }
  };
  // A build started by the refresh workflow names the data commit it saw (raw.githubusercontent
  // caches branch files for a few minutes, so reading `data` could return the previous index).
  const index = await get(raw(indexRef, 'index.json') + (indexRef === 'data' ? `?t=${Date.now()}` : ''));
  if (!index) throw new Error(`no index.json on the data branch of ${repo}`);
  const ref = /^[0-9a-f]{40}$/.test(index.rev ?? '') ? index.rev : 'data';

  // Fetch round files in parallel, then build the model from the results.
  const wanted = index.competitions.flatMap((c) => c.rounds.filter((r) => r.matches).map((r) => `${c.code}/${r.key}`));
  const files = new Map();
  let next = 0;
  await Promise.all(Array.from({ length: concurrency }, async () => {
    while (next < wanted.length) {
      const id = wanted[next++];
      files.set(id, await get(raw(ref, `${id}.json`)));
    }
  }));
  const model = await buildModel(index, async (code, key) => files.get(`${code}/${key}`) ?? null);
  // Crests never change once stored; read them at the commit the site would (crestsRev, else rev).
  const crestsRef = /^[0-9a-f]{40}$/.test(index.crestsRev ?? '') ? index.crestsRev : ref;
  return { ...model, crestSource: { base: raw(crestsRef, '') } };
}
