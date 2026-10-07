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

interface ModelTeam { name: string; short: string; tla: string; crest: string | null }
interface ModelMatch { home: ModelTeam; away: ModelTeam; hl: boolean }
interface ModelRound { key: string; label: string; fixtures: string[]; matches: ModelMatch[] }
interface ModelComp {
  code: string; name: string; short: string | null; group: string; color: string; seasonLabel: string;
  country: string | null; currentRound: string | null; rounds: ModelRound[];
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

// The app's header controls (App.tsx), invisible: they hold the header's height (on
// phones they're taller than the logo) until the app draws the real ones.
const PREFS_SPACE =
  '<div class="prefs pre-ghost" aria-hidden="true"><div class="seg"><button tabindex="-1">Short</button>' +
  '<button tabindex="-1"><span class="lbl-long">Extended</span><span class="lbl-short">Ext.</span></button></div>' +
  '<button class="toggle cond-toggle" tabindex="-1"><svg viewBox="0 0 24 24"></svg><span class="toggle-text">Auto-condense</span><sup>*</sup></button>' +
  '<button class="toggle spoiler-toggle" tabindex="-1"><svg viewBox="0 0 24 24"></svg><span class="toggle-text">Spoiler-free</span></button>' +
  '<button class="toggle settings-btn" tabindex="-1"><span class="flag">🌐</span><svg viewBox="0 0 24 24"></svg></button></div>';

const HEADER =
  `<header class="topbar"><a class="logo" href="/" aria-label="Rondo Highlights home">${LOGO}` +
  `<span class="wordmark">rondo<span class="wordmark-sub">highlights</span></span></a>${PREFS_SPACE}</header>`;
const TAGLINE = '<p class="tagline">The whole match week, <span>back to back</span></p>';


// ---------- The app's first screen, as static HTML ----------
// Prerendered pages draw what the app will show, with the same markup and classes
// (App.tsx, MatchCard.tsx, TeamBadge.tsx, CompSwitcher.tsx), so the first paint already
// has the page's final layout: on a round page, its match cards (names and crests; no
// scores or dates, which change after the build and could spoil). The app renders off
// screen and takes over once it has the round (src/main.tsx), so the cards never blink
// back to a skeleton. Keep these in step with those components.

const CARET = '<svg class="cs-caret" viewBox="0 0 24 24" aria-hidden="true"><path d="m7 10 5 5 5-5z"/></svg>';
const PREV = '<svg viewBox="0 0 24 24"><path d="M15.4 7.4 14 6l-6 6 6 6 1.4-1.4-4.6-4.6z"/></svg>';
const NEXT = '<svg viewBox="0 0 24 24"><path d="M8.6 16.6 10 18l6-6-6-6-1.4 1.4 4.6 4.6z"/></svg>';
const PLAY = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M8 5v14l11-7z"/></svg>';
const QUEUE_ICON = '<svg viewBox="0 0 24 24"><path d="M3 6h12v2H3zm0 5h12v2H3zm0 5h8v2H3zm14-3v-3h2v3h3v2h-3v3h-2v-3h-3v-2z"/></svg>';

/** CompSwitcher's CompMark: a flag for the leagues, a star for European cups, a globe for world ones. */
const FLAGS: Record<string, string> = {
  England: '<rect width="20" height="14" fill="#fff"/><rect x="8.4" width="3.2" height="14" fill="#CE1124"/><rect y="5.4" width="20" height="3.2" fill="#CE1124"/>',
  Spain: '<rect width="20" height="14" fill="#AA151B"/><rect y="3.5" width="20" height="7" fill="#F1BF00"/>',
  Italy: '<rect width="20" height="14" fill="#fff"/><rect width="6.7" height="14" fill="#009246"/><rect x="13.3" width="6.7" height="14" fill="#CE2B37"/>',
  Germany: '<rect width="20" height="4.7" fill="#000"/><rect y="4.6" width="20" height="4.8" fill="#DD0000"/><rect y="9.3" width="20" height="4.7" fill="#FFCE00"/>',
  France: '<rect width="20" height="14" fill="#fff"/><rect width="6.7" height="14" fill="#002395"/><rect x="13.3" width="6.7" height="14" fill="#ED2939"/>',
};
function compMark(c: ModelComp): string {
  const color = esc(c.color);
  const icon = (c.country && FLAGS[c.country]) || '<rect width="20" height="14" fill="var(--surface-2)"/>' + (c.country === 'World'
    ? `<g fill="none" stroke="${color}" stroke-width="1.1"><circle cx="10" cy="7" r="4.6"/><ellipse cx="10" cy="7" rx="2" ry="4.6"/><path d="M5.4 7h9.2"/></g>`
    : `<path d="m10 2.3 1.4 2.9 3.2.4-2.3 2.2.6 3.2L10 9.5 7.1 11l.6-3.2-2.3-2.2 3.2-.4z" fill="${color}"/>`);
  return `<svg class="comp-mark" viewBox="0 0 20 14" aria-hidden="true">${icon}</svg>`;
}

/** TeamBadge: the self-hosted crest, else the team's initials on a colour from its name. */
function hue(s: string) {
  let h = 0;
  for (const ch of s) h = (h * 31 + ch.charCodeAt(0)) % 360;
  return h;
}
function badge(t: ModelTeam, size: number): string {
  if (t.crest) return `<img class="badge" src="/${esc(t.crest)}" alt="" width="${size}" height="${size}" loading="lazy" decoding="async">`;
  const h = hue(t.name);
  return `<span class="badge badge-text" style="width:${size}px;height:${size}px;background:hsl(${h} 45% 28%);border-color:hsl(${h} 55% 45%);font-size:${+(size * 0.32).toFixed(2)}px" aria-hidden="true">${esc(t.tla)}</span>`;
}

/** MatchCard before the data: crests in place of the thumbnail; the date line and the cut chips hold their space. */
function card(m: ModelMatch): string {
  const teams = `<span class="thumb-teams">${badge(m.home, 56)}<span class="vs">v</span>${badge(m.away, 56)}</span>`;
  const thumb = m.hl
    ? `<div class="thumb">${teams}</div>`
    : `<button class="thumb" disabled>${teams}<span class="no-hl">Highlights not in yet</span></button>`;
  const lines = [m.home, m.away].map((t) =>
    `<div class="line">${badge(t, 22)}<span class="tname" title="${esc(t.name)}">${esc(t.short)}</span><span class="goals hidden">&nbsp;</span></div>`).join('');
  const actions = m.hl
    ? '<div class="card-actions pre-ghost" aria-hidden="true"><div class="versions"><span class="chip">Short<span class="chip-dur">0:00</span></span>' +
      `<span class="chip">Ext.<span class="chip-dur">00:00</span></span></div><span class="btn-icon">${QUEUE_ICON}</span></div>`
    : '';
  return `<article class="card${m.hl ? '' : ' is-empty'}">${thumb}<div class="card-body"><div class="fixture">${lines}</div>` +
    `<div class="meta"><span>&nbsp;</span></div>${actions}</div></article>`;
}

const skeletonGrid = () => `<div class="grid loading">${'<div class="card skeleton"></div>'.repeat(6)}</div>`;

/** The round bar (App.tsx): the competition / round headline, an empty date line, and Play all / Queue all (not yet active). */
function roundBar(comp: ModelComp | null, round: string): string {
  const switcher = comp
    ? `<div class="comp-switch"><span class="cs-button" style="--c:${esc(comp.color)}">${compMark(comp)}<span class="cs-name">${esc(comp.short ?? comp.name)}</span>${CARET}</span></div>`
    : '<span class="hl-skel hl-skel-comp"></span>';
  const sep = comp ? '<span class="hl-sep" aria-hidden="true">/</span>' : '';
  return '<div class="round-bar">' +
    `<div class="headline">${switcher}${sep}${round}</div>` +
    '<p class="round-meta muted">&nbsp;</p>' +
    `<div class="round-actions"><button class="btn-primary" disabled>${PLAY}Play all</button><button class="btn-ghost" disabled>+ Queue all</button></div>` +
    '</div>';
}

function roundNav(c: ModelComp, i: number): string {
  const link = (r: ModelRound | undefined, label: string, icon: string) => r
    ? `<a class="btn-icon" href="${roundPath(c, r.key)}" aria-label="${label}: ${esc(roundName(r.label))}" title="${label}">${icon}</a>`
    : `<button class="btn-icon" disabled aria-label="${label}">${icon}</button>`;
  return `<div class="round-nav">${link(c.rounds[i - 1], 'Previous round', PREV)}` +
    `<span class="round-select"><span class="rs-sizer pre-rs">${esc(c.rounds[i].label)}</span></span>` +
    `${link(c.rounds[i + 1], 'Next round', NEXT)}</div>`;
}

/**
 * A competition page shows its current round, which may have moved on since the build:
 * the round picker as a placeholder, sized by the build's current round so the headline
 * wraps where the app's will.
 */
function roundNavPlaceholder(c: ModelComp): string {
  const r = c.rounds.find((x) => x.key === c.currentRound);
  if (!r) return '<span class="hl-skel hl-skel-round"></span>';
  return `<div class="round-nav"><button class="btn-icon" disabled aria-hidden="true">${PREV}</button>` +
    `<span class="round-select pre-skel" aria-hidden="true"><span class="rs-sizer">${esc(r.label)}</span></span>` +
    `<button class="btn-icon" disabled aria-hidden="true">${NEXT}</button></div>`;
}

function compNav(comps: ModelComp[], current?: string): string {
  const links = comps.map((c, i) => {
    const sep = i > 0 && c.group !== comps[i - 1].group ? '<span class="comp-sep" aria-hidden="true"></span>' : '';
    const on = c.code === current ? ' on' : '';
    return `${sep}<a class="comp${on}" href="${compPath(c)}" style="--c:${esc(c.color)}"><i class="comp-dot"></i>${esc(c.short ?? c.name)}</a>`;
  });
  return `<nav class="comps" aria-label="Competitions">${links.join('')}</nav>`;
}

/** The app's page frame around a browse section; `more` (text and links for readers and crawlers) goes under the cards. */
const page = (comps: ModelComp[], current: string | undefined, heading: string, browse: string, more: string) =>
  `<div class="app">${HEADER}<div class="layout"><main><section class="browse" aria-label="Browse">` +
  `<h1 class="sr-only">${esc(heading)}</h1>${TAGLINE}${browse}` +
  `<div class="pre-more">${more}${compNav(comps, current)}</div></section></main></div></div>`;

function homePage(comps: ModelComp[]): string {
  const items = comps.map((c) =>
    `<li><a href="${compPath(c)}">${esc(c.name)} highlights</a> <span class="muted">${esc(c.seasonLabel)} · ${c.rounds.length} rounds</span></li>`);
  // The app opens the competition viewed last, else the first: unknown here, so placeholders.
  return page(comps, undefined, 'Football highlights, back to back',
    roundBar(null, '<span class="hl-skel hl-skel-round"></span>') + skeletonGrid(),
    '<p class="pre-lede muted">Rondo plays a whole round of football highlights back to back, from official YouTube channels. ' +
    'Pick a competition and a round, then press Play all. Short or extended cuts, a queue across competitions, and a spoiler-free mode that hides scores.</p>' +
    `<ul class="pre-list">${items.join('')}</ul>`);
}

function compPage(comps: ModelComp[], c: ModelComp): string {
  const items = c.rounds.map((r) =>
    `<li><a href="${roundPath(c, r.key)}">${esc(roundName(r.label))}</a> <span class="muted">${r.fixtures.length} matches</span></li>`);
  // The app shows the competition's current round, which moves on after the build: a placeholder.
  return page(comps, c.code, compHeading(c),
    roundBar(c, roundNavPlaceholder(c)) + skeletonGrid(),
    `<p class="pre-lede muted">Every round of the ${esc(c.seasonLabel)} ${esc(c.name)}, with official highlights from YouTube played back to back. ` +
    'Pick a round to watch all of its matches in one go.</p>' +
    `<ul class="pre-list">${items.join('')}</ul>`);
}

function roundPage(comps: ModelComp[], c: ModelComp, i: number): string {
  const r = c.rounds[i];
  // As in the app: matches with highlights first (as of the build).
  const matches = [...r.matches.filter((m) => m.hl), ...r.matches.filter((m) => !m.hl)];
  return page(comps, c.code, roundHeading(c, r),
    roundBar(c, roundNav(c, i)) + `<div class="grid">${matches.map(card).join('')}</div>`,
    `<p class="pre-lede muted">All ${r.fixtures.length} matches of ${esc(c.name)} ${esc(roundName(r.label))} (${esc(c.seasonLabel)}), ` +
    'with official highlights from YouTube played back to back. Choose short or extended cuts, or switch on spoiler-free mode to hide scores. ' +
    `<a href="${compPath(c)}">All ${esc(c.name)} rounds</a>.</p>`);
}

/** The 404 page: plain text (the app sends unknown paths home). */
const notFoundPage = (comps: ModelComp[]) =>
  `${HEADER}<main class="pre">${TAGLINE}${compNav(comps)}<h1 class="pre-title">Page not found</h1>` +
  '<p class="pre-lede muted">That page doesn&#39;t exist. <a href="/">Go to the home page</a>.</p></main>';

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
      write('/', fill(template, homeHead(), homePage(comps), ''));
      for (const c of comps) {
        write(compPath(c), fill(template, compHead(c), compPage(comps, c), c.code));
        urls.push(compPath(c));
        c.rounds.forEach((r, i) => {
          const head = roundHead(c, r, r.fixtures);
          write(head.path, fill(template, head, roundPage(comps, c, i), `${c.code} ${r.key}`));
          urls.push(head.path);
        });
      }

      fs.writeFileSync(path.join(outDir, '404.html'), fill(
        template,
        { title: 'Page not found | Rondo Highlights', description: 'This page does not exist.', path: '/' },
        notFoundPage(comps),
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
