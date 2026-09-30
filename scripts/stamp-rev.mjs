// Stamp index.json with the data-branch commit that holds this dataset.
//
// Round files and crests only change when the data does, so the site fetches
// them from that exact commit (jsDelivr `@<sha>`), which CDNs and browsers can
// cache forever. Only index.json is read from the moving `data` branch.
//
//   node scripts/stamp-rev.mjs <index.json> <commit-sha>

import fs from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

export function withRev(index, rev) {
  if (!/^[0-9a-f]{40}$/.test(rev)) throw new Error(`not a full commit SHA: ${rev}`);
  const { generatedAt, source, rev: _old, competitions, ...rest } = index;
  return { generatedAt, source, rev, ...rest, competitions };
}

export async function stampRev(file, rev) {
  const index = JSON.parse(await fs.readFile(file, 'utf8'));
  await fs.writeFile(file, JSON.stringify(withRev(index, rev), null, 1));
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const [file, rev] = process.argv.slice(2);
  stampRev(file, rev).catch((e) => { console.error(e.message); process.exit(1); });
}
