// Build step (vite.config.ts): one static HTML page per competition and round, so
// search engines and link previews see a real title, description, heading and
// fixture list without running JavaScript. Each page is the built index.html with
// its own <head> and some plain content in #root, which the app replaces when it
// starts. Also writes sitemap.xml, 404.html and pages.json (the data fingerprint
// the refresh workflow compares against to decide whether to redeploy), and copies
// the rounds' crests into crests/ (scripts/lib/site-crests.mjs).
//
// Data: from GitHub on Netlify (REPOSITORY_URL), else ./public/data if present,
// else the pages are skipped (plain local builds still work).

import fs from 'node:fs';
import path from 'node:path';
import type { Plugin } from 'vite';
import { fingerprint, loadModelFromDir, loadModelFromRepo } from './lib/pages.mjs';
import { copySiteCrests } from './lib/site-crests.mjs';
import {
  SITE, compHead, compHeading, compPath, homeHead, roundHead, roundHeading, roundName, roundPath, type Head,
} from '../src/lib/routes';

interface ModelRound { key: string; label: string; fixtures: string[] }
interface ModelComp {
  code: string; name: string; short: string | null; group: string; color: string; seasonLabel: string;
  rounds: ModelRound[];
}

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

function setHead(html: string, head: Head, opts: { noindex?: boolean } = {}): string {
  const url = `${SITE}${head.path}`;
  const swaps: [RegExp, string][] = [
    [/<title>[^<]*<\/title>/, `<title>${esc(head.title)}</title>`],
    [/<meta name="description" content="[^"]*"\s*\/>/, `<meta name="description" content="${esc(head.description)}" />`],
    [/<meta property="og:title" content="[^"]*"\s*\/>/, `<meta property="og:title" content="${esc(head.title)}" />`],
    [/<meta property="og:description" content="[^"]*"\s*\/>/, `<meta property="og:description" content="${esc(head.description)}" />`],
    [/<meta property="og:url" content="[^"]*"\s*\/>/, `<meta property="og:url" content="${esc(url)}" />`],
    [/<link rel="canonical" href="[^"]*"\s*\/>/,
      opts.noindex ? '<meta name="robots" content="noindex" />' : `<link rel="canonical" href="${esc(url)}" />`],
  ];
  for (const [re, to] of swaps) {
    if (!re.test(html)) throw new Error(`prerender: index.html has no tag matching ${re}`);
    html = html.replace(re, to);
  }
  return html;
}

const LOGO =
  '<svg width="32" height="32" viewBox="0 0 48 48" fill="none" aria-hidden="true">' +
  '<path d="M39.59 15A18 18 0 1 1 11.96 10.62" fill="none" stroke="#e8eef4" stroke-width="3.6" stroke-linecap="round"/>' +
  '<circle cx="32.45" cy="8.11" r="4.6" fill="#c8f550"/>' +
  '<path d="M19.5 16.5 32 24 19.5 31.5Z" fill="#c8f550" stroke="#c8f550" stroke-width="3" stroke-linejoin="round"/></svg>';

const HEADER =
  `<header class="topbar"><a class="logo" href="/" aria-label="Rondo Highlights home">${LOGO}` +
  '<span class="wordmark">rondo<span class="wordmark-sub">highlights</span></span></a></header>';
const TAGLINE = '<p class="tagline">The whole match week, <span>back to back</span></p>';

function compNav(comps: ModelComp[], current?: string): string {
  const links = comps.map((c, i) => {
    const sep = i > 0 && c.group !== comps[i - 1].group ? '<span class="comp-sep" aria-hidden="true"></span>' : '';
    const on = c.code === current ? ' on' : '';
    return `${sep}<a class="comp${on}" href="${compPath(c)}" style="--c:${esc(c.color)}"><i class="comp-dot"></i>${esc(c.short ?? c.name)}</a>`;
  });
  return `<nav class="comps" aria-label="Competitions">${links.join('')}</nav>`;
}

const page = (comps: ModelComp[], current: string | undefined, body: string) =>
  `${HEADER}<main class="pre">${TAGLINE}${compNav(comps, current)}${body}</main>`;

function homeBody(comps: ModelComp[]): string {
  const items = comps.map((c) =>
    `<li><a href="${compPath(c)}">${esc(c.name)} highlights</a> <span class="muted">${esc(c.seasonLabel)} · ${c.rounds.length} rounds</span></li>`);
  return '<h1 class="pre-title">Football highlights, back to back</h1>' +
    '<p class="pre-lede muted">Rondo plays a whole round of football highlights back to back, from official YouTube channels. ' +
    'Pick a competition and a round, then press Play all. Short or extended cuts, a queue across competitions, and a spoiler-free mode that hides scores.</p>' +
    `<ul class="pre-list">${items.join('')}</ul>`;
}

function compBody(c: ModelComp): string {
  const items = c.rounds.map((r) =>
    `<li><a href="${roundPath(c, r.key)}">${esc(roundName(r.label))}</a> <span class="muted">${r.fixtures.length} matches</span></li>`);
  return `<h1 class="pre-title">${esc(compHeading(c))}</h1>` +
    `<p class="pre-lede muted">Every round of the ${esc(c.seasonLabel)} ${esc(c.name)}, with official highlights from YouTube played back to back. ` +
    'Pick a round to watch all of its matches in one go.</p>' +
    `<ul class="pre-list">${items.join('')}</ul>`;
}

function roundBody(c: ModelComp, i: number): string {
  const r = c.rounds[i];
  const prev = c.rounds[i - 1];
  const next = c.rounds[i + 1];
  const nav = [
    prev ? `<a rel="prev" href="${roundPath(c, prev.key)}">← ${esc(roundName(prev.label))}</a>` : '',
    `<a href="${compPath(c)}">All ${esc(c.name)} rounds</a>`,
    next ? `<a rel="next" href="${roundPath(c, next.key)}">${esc(roundName(next.label))} →</a>` : '',
  ].filter(Boolean);
  return `<h1 class="pre-title">${esc(roundHeading(c, r))}</h1>` +
    `<p class="pre-lede muted">All ${r.fixtures.length} matches of ${esc(c.name)} ${esc(roundName(r.label))} (${esc(c.seasonLabel)}), ` +
    'with official highlights from YouTube played back to back. Choose short or extended cuts, or switch on spoiler-free mode to hide scores.</p>' +
    `<ul class="pre-list">${r.fixtures.map((f) => `<li>${esc(f)}</li>`).join('')}</ul>` +
    `<nav class="pre-rounds" aria-label="Rounds">${nav.join('')}</nav>`;
}

/**
 * `route` tells scripts/early-data.js which round the app will open, so it can start
 * loading it before the app's JS arrives: "CODE ROUNDKEY", "CODE" (its current round),
 * "" (home: the last competition viewed, else the first), or null (no early load).
 */
function fill(template: string, head: Head, body: string, route: string | null, opts?: { noindex?: boolean }): string {
  let html = setHead(template, head, opts);
  if (route != null) {
    // Before the early-data script, which follows the charset.
    const charset = '<meta charset="UTF-8" />';
    if (!html.includes(charset)) throw new Error('prerender: index.html has no charset meta');
    html = html.replace(charset, `${charset}\n    <meta name="rondo-route" content="${esc(route)}" />`);
  }
  if (!html.includes('<div id="root"></div>')) throw new Error('prerender: no empty #root in index.html');
  return html.replace('<div id="root"></div>', `<div id="root">${body}</div>`);
}

interface Model {
  competitions: ModelComp[];
  crests: string[];
  crestSource: { dir?: string; base?: string };
}

async function loadModel(root: string): Promise<Model | null> {
  const repo = process.env.REPOSITORY_URL?.match(/github\.com[/:]([^/]+\/[^/.]+)/)?.[1];
  if (repo) {
    // Builds started by the refresh workflow's build hook carry the data commit as the hook body.
    const body = process.env.INCOMING_HOOK_BODY?.trim() ?? '';
    return loadModelFromRepo(repo, { indexRef: /^[0-9a-f]{40}$/.test(body) ? body : 'data' });
  }
  const dir = path.join(root, 'public/data');
  if (fs.existsSync(path.join(dir, 'index.json'))) return loadModelFromDir(dir);
  return null;
}

export function prerenderPages(): Plugin {
  let root = '';
  let outDir = '';
  return {
    name: 'rondo-prerender',
    apply: 'build',
    configResolved(c) {
      root = c.root;
      outDir = path.resolve(c.root, c.build.outDir);
    },
    async closeBundle() {
      const model = await loadModel(root);
      if (!model) {
        console.warn('prerender: no data (no REPOSITORY_URL and no public/data), skipping pages');
        return;
      }
      const comps = model.competitions;
      const template = fs.readFileSync(path.join(outDir, 'index.html'), 'utf8');
      const write = (p: string, html: string) => {
        const file = path.join(outDir, p, 'index.html');
        fs.mkdirSync(path.dirname(file), { recursive: true });
        fs.writeFileSync(file, html);
      };

      const urls: string[] = ['/'];
      write('/', fill(template, homeHead(), page(comps, undefined, homeBody(comps)), ''));
      for (const c of comps) {
        write(compPath(c), fill(template, compHead(c), page(comps, c.code, compBody(c)), c.code));
        urls.push(compPath(c));
        c.rounds.forEach((r, i) => {
          const head = roundHead(c, r, r.fixtures);
          write(head.path, fill(template, head, page(comps, c.code, roundBody(c, i)), `${c.code} ${r.key}`));
          urls.push(head.path);
        });
      }

      fs.writeFileSync(path.join(outDir, '404.html'), fill(
        template,
        { title: 'Page not found | Rondo Highlights', description: 'This page does not exist.', path: '/' },
        page(comps, undefined, '<h1 class="pre-title">Page not found</h1><p class="pre-lede muted">That page doesn&#39;t exist. <a href="/">Go to the home page</a>.</p>'),
        null,
        { noindex: true },
      ));

      fs.writeFileSync(path.join(outDir, 'sitemap.xml'),
        '<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n' +
        urls.map((u) => `  <url><loc>${SITE}${u}</loc></url>`).join('\n') + '\n</urlset>\n');

      fs.writeFileSync(path.join(outDir, 'pages.json'),
        JSON.stringify({ fingerprint: fingerprint(model), builtAt: new Date().toISOString(), pages: urls.length }) + '\n');
      console.log(`prerender: ${urls.length} pages, fingerprint ${fingerprint(model)}`);

      // The crests these pages' rounds use, served from the site itself (see scripts/lib/site-crests.mjs).
      // A crest that fails to copy is only slower: the app falls back to jsDelivr for it.
      const crests = await copySiteCrests(model.crests, model.crestSource, outDir);
      console.log(`prerender: ${crests.copied}/${model.crests.length} crests copied into the site`);
      if (crests.failed.length) console.warn(`prerender: could not copy ${crests.failed.length} crests: ${crests.failed.slice(0, 5).join(', ')}${crests.failed.length > 5 ? ', …' : ''}`);
    },
  };
}
