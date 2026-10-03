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
//   node scripts/stamp-rev.mjs <index.json> <commit-sha> [<crests-commit-sha>]

import fs from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

const SHA = /^[0-9a-f]{40}$/;

export function withRev(index, rev, crestsRev = rev) {
  if (!SHA.test(rev)) throw new Error(`not a full commit SHA: ${rev}`);
  if (!SHA.test(crestsRev)) throw new Error(`not a full commit SHA: ${crestsRev}`);
  const { generatedAt, source, rev: _old, crestsRev: _oldCrests, competitions, ...rest } = index;
  return { generatedAt, source, rev, crestsRev, ...rest, competitions };
}

export async function stampRev(file, rev, crestsRev) {
  const index = JSON.parse(await fs.readFile(file, 'utf8'));
  await fs.writeFile(file, JSON.stringify(withRev(index, rev, crestsRev || rev), null, 1));
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const [file, rev, crestsRev] = process.argv.slice(2);
  stampRev(file, rev, crestsRev).catch((e) => { console.error(e.message); process.exit(1); });
}
