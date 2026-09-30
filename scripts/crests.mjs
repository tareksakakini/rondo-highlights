// Self-host small club crests.
//
// football-data.org serves 200×200 PNGs (5–35 KB each) that the site shows at
// 18–40 px, so a Premier League round cost ~240 KB of crests from a separate
// server. This step runs after `npm run ingest`: it downloads each crest once,
// shrinks it to an 80×80 WebP (40 px at 2× density), stores it in the data
// branch under crests/, and rewrites the round files to point at it. The site
// then loads crests from jsDelivr, over the connection it already has open.
//
// Idempotent: crests already on disk are never downloaded again, and a crest
// that fails to download keeps its original URL (the site handles both).
//
//   node scripts/crests.mjs [dataDir]      (default: public/data)

import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';

export const CREST_PX = 80;
const SKIP_DIRS = new Set(['cache', 'crests', '.git']);

/** Where a crest URL is stored, relative to the data root. Stable across runs. */
export function crestPath(url) {
  return `crests/${crypto.createHash('sha1').update(url).digest('hex').slice(0, 12)}.webp`;
}

const isRemote = (u) => typeof u === 'string' && /^https?:\/\//.test(u);

/** Shrink any image (PNG, SVG, JPEG…) to a square transparent WebP. */
export async function toSmallWebp(buf) {
  return sharp(buf, { density: 288 })
    .resize(CREST_PX, CREST_PX, { fit: 'contain', background: { r: 0, g: 0, b: 0, alpha: 0 } })
    .webp({ quality: 82, alphaQuality: 90, effort: 6 })
    .toBuffer();
}

async function roundFiles(dataDir) {
  const out = [];
  for (const d of await fs.readdir(dataDir, { withFileTypes: true })) {
    if (!d.isDirectory() || SKIP_DIRS.has(d.name)) continue;
    for (const f of await fs.readdir(path.join(dataDir, d.name))) {
      if (f.endsWith('.json')) out.push(path.join(dataDir, d.name, f));
    }
  }
  return out;
}

async function exists(p) {
  try { await fs.access(p); return true; } catch { return false; }
}

async function download(url, fetchImpl) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), 15000);
  try {
    const r = await fetchImpl(url, { signal: ctrl.signal });
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    return Buffer.from(await r.arrayBuffer());
  } finally {
    clearTimeout(t);
  }
}

/**
 * Localize every remote crest referenced by the round files under dataDir.
 * Returns { files, crests, downloaded, failed } counts.
 */
export async function localizeCrests(dataDir, { fetchImpl = fetch, log = console.log } = {}) {
  const files = await roundFiles(dataDir);
  const parsed = [];
  const urls = new Set();
  for (const file of files) {
    const text = await fs.readFile(file, 'utf8');
    const json = JSON.parse(text);
    parsed.push({ file, text, json });
    for (const m of json.matches ?? []) {
      for (const t of [m.home, m.away]) if (isRemote(t?.crest)) urls.add(t.crest);
    }
  }

  await fs.mkdir(path.join(dataDir, 'crests'), { recursive: true });
  const ready = new Set();
  let downloaded = 0;
  const failed = [];
  const queue = [...urls];
  const worker = async () => {
    for (let url; (url = queue.shift()); ) {
      const rel = crestPath(url);
      const dest = path.join(dataDir, rel);
      if (await exists(dest)) { ready.add(url); continue; }
      try {
        await fs.writeFile(dest, await toSmallWebp(await download(url, fetchImpl)));
        ready.add(url);
        downloaded++;
      } catch (e) {
        failed.push(`${url} (${e.message})`);
      }
    }
  };
  await Promise.all(Array.from({ length: 6 }, worker));

  let rewritten = 0;
  for (const { file, text, json } of parsed) {
    for (const m of json.matches ?? []) {
      for (const t of [m.home, m.away]) if (t && ready.has(t.crest)) t.crest = crestPath(t.crest);
    }
    const next = JSON.stringify(json);
    if (next !== text) { await fs.writeFile(file, next); rewritten++; }
  }

  for (const f of failed) log(`crest kept remote: ${f}`);
  log(`crests: ${urls.size} remote, ${downloaded} downloaded, ${failed.length} failed, ${rewritten} round files rewritten`);
  return { files: rewritten, crests: urls.size, downloaded, failed: failed.length };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const dir = path.resolve(process.argv[2] ?? 'public/data');
  localizeCrests(dir).catch((e) => { console.error(e); process.exit(1); });
}
