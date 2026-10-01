#!/usr/bin/env node
// Run by the refresh workflow after it commits new data: redeploy the site when the
// prerendered pages (scripts/prerender.ts) would change, i.e. when competitions,
// rounds or fixtures changed. Scores, dates and highlights never need a redeploy:
// the app loads those itself.
//
// Compares the fingerprint of the data with the one the live site was built from
// (/pages.json), and triggers Netlify's build hook (secret NETLIFY_BUILD_HOOK) at
// most once per MIN_HOURS (default 20): each production deploy costs Netlify credits.
//
//   node scripts/check-pages.mjs [dataDir=public/data]

import { execFileSync } from 'node:child_process';
import { fingerprint, loadModelFromDir } from './lib/pages.mjs';

const dir = process.argv[2] ?? 'public/data';
const site = (process.env.SITE_URL || 'https://rondohighlights.com').replace(/\/$/, '');
const hook = process.env.NETLIFY_BUILD_HOOK || '';
const minHours = Number(process.env.MIN_HOURS || 20);

const want = fingerprint(await loadModelFromDir(dir));

let live = null;
try {
  const r = await fetch(`${site}/pages.json?t=${Date.now()}`, { cache: 'no-store' });
  if (r.ok) live = await r.json();
  else console.log(`${site}/pages.json: HTTP ${r.status}`);
} catch (e) {
  console.log(`could not read ${site}/pages.json: ${e.message}`);
}

if (!live?.fingerprint) {
  console.log('The live site has no page fingerprint yet; the next deploy from main adds it. Nothing to do.');
  process.exit(0);
}
if (live.fingerprint === want) {
  console.log(`Pages are up to date (${want}).`);
  process.exit(0);
}
const hours = (Date.now() - Date.parse(live.builtAt)) / 36e5;
if (!(hours >= minHours)) {
  console.log(`Pages changed (${live.fingerprint} -> ${want}), but the site was built ${hours.toFixed(1)} h ago; waiting until ${minHours} h.`);
  process.exit(0);
}
if (!hook) {
  console.log(`::warning::Pages changed (${live.fingerprint} -> ${want}). Add a NETLIFY_BUILD_HOOK secret to redeploy automatically.`);
  process.exit(0);
}

const rev = execFileSync('git', ['-C', dir, 'rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
const url = `${hook}${hook.includes('?') ? '&' : '?'}trigger_title=${encodeURIComponent(`Pages changed (data ${rev.slice(0, 7)})`)}`;
try {
  const r = await fetch(url, { method: 'POST', body: rev });
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
} catch (e) {
  console.log(`::warning::The Netlify build hook failed (${e.message}); will try again on the next run.`);
  process.exit(0);
}
console.log(`Pages changed (${live.fingerprint} -> ${want}): triggered a Netlify deploy for data ${rev.slice(0, 7)}.`);
