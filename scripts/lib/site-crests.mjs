// Copy the crests the rounds use into the built site (dist/crests/), so visitors load
// them from the site's own host, over the connection the page already has, instead of
// from jsDelivr, which can take 0.4-3 s per crest when it hasn't cached them yet.
//
// Crest files are named by a hash of their source and never change once stored
// (scripts/crests.mjs), so the site serves them with a year-long immutable cache
// (public/_headers) and visitors download each one once. A crest added to the data
// after the last site build isn't here yet: the app then falls back to the jsDelivr
// copy (TeamBadge's onError).

import fs from 'node:fs/promises';
import path from 'node:path';

/**
 * @param {string[]} crests   paths like `crests/1a2b3c4d5e6f.webp`
 * @param {{ dir?: string, base?: string }} source  a data directory, or a URL prefix (raw.githubusercontent at a commit)
 * @param {string} outDir     the built site
 * @returns {Promise<{ copied: number, failed: string[] }>}
 */
export async function copySiteCrests(crests, source, outDir, { fetchImpl = fetch, concurrency = 16 } = {}) {
  await fs.mkdir(path.join(outDir, 'crests'), { recursive: true });
  const failed = [];
  let copied = 0;
  let next = 0;
  async function one(p) {
    const dest = path.join(outDir, p);
    if (source.dir) {
      await fs.copyFile(path.join(source.dir, p), dest);
      return;
    }
    for (let attempt = 1; ; attempt++) {
      try {
        const r = await fetchImpl(source.base + p);
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        await fs.writeFile(dest, Buffer.from(await r.arrayBuffer()));
        return;
      } catch (e) {
        if (attempt >= 3) throw e;
        await new Promise((res) => setTimeout(res, 500 * attempt));
      }
    }
  }
  await Promise.all(Array.from({ length: Math.min(concurrency, crests.length) }, async () => {
    while (next < crests.length) {
      const p = crests[next++];
      try {
        await one(p);
        copied++;
      } catch {
        failed.push(p);
      }
    }
  }));
  return { copied, failed: failed.sort() };
}
