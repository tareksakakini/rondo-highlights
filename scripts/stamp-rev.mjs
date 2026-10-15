// Stamp index.json with the data-branch commit that holds this dataset.
//
// Round files only change when the data does, so the site fetches them from that
// exact commit (jsDelivr `@<sha>`), which CDNs and browsers can cache forever.
// Only index.json is read from the moving `data` branch.
//
// Crests are stored under content-addressed names and never change or go away, so
// they are read at `crestsRev`: the last commit that added one. A refresh that adds
// no crest leaves their URLs alone, and visitors keep them cached across refreshes.
//
// `publishedAt` only ever goes up: it moves whenever anything else in the index
// changes, and stays put otherwise. jsDelivr's copy of the branch can lag hours behind
// it (it served a 3-hour-old index through every purge on 2026-10-15), so the site
// reads index.json from every source and keeps the newest copy it has seen.
//
//   node scripts/stamp-rev.mjs <index.json> <commit-sha> [<crests-commit-sha>]
//
// The index last published (to compare with) is read from the git HEAD of index.json's folder.

import { execFileSync } from 'node:child_process';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const SHA = /^[0-9a-f]{40}$/;
const unstamped = ({ publishedAt, ...rest }) => JSON.stringify(rest);

/** `index` naming `rev` and `crestsRev`, with a `publishedAt` later than `previous`'s unless nothing else changed. */
export function withRev(index, rev, crestsRev = rev, previous = null, now = Date.now()) {
  if (!SHA.test(rev)) throw new Error(`not a full commit SHA: ${rev}`);
  if (!SHA.test(crestsRev)) throw new Error(`not a full commit SHA: ${crestsRev}`);
  const { generatedAt, source, rev: _old, crestsRev: _oldCrests, publishedAt: carried, competitions, ...rest } = index;
  const next = { generatedAt, source, rev, crestsRev, publishedAt: undefined, ...rest, competitions };
  const last = Date.parse(previous?.publishedAt ?? carried ?? '') || 0;
  next.publishedAt = previous?.publishedAt && unstamped(previous) === unstamped(next)
    ? previous.publishedAt
    : new Date(Math.max(now, last + 1)).toISOString();
  return next;
}

/** index.json as last committed in its folder's repository, or null. */
function committed(file) {
  try {
    const out = execFileSync('git', ['show', `HEAD:./${path.basename(file)}`], {
      cwd: path.dirname(file), encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'], maxBuffer: 1 << 26,
    });
    return JSON.parse(out);
  } catch { return null; }
}

export async function stampRev(file, rev, crestsRev, previous = committed(file)) {
  const index = JSON.parse(await fs.readFile(file, 'utf8'));
  await fs.writeFile(file, JSON.stringify(withRev(index, rev, crestsRev || rev, previous), null, 1));
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const [file, rev, crestsRev] = process.argv.slice(2);
  stampRev(file, rev, crestsRev).catch((e) => { console.error(e.message); process.exit(1); });
}
