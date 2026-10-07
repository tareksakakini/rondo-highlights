import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { defineConfig, transformWithEsbuild, type Plugin } from 'vite';
import preact from '@preact/preset-vite';
import { prerenderPages } from './scripts/prerender';

// Production builds read highlight data from the GitHub repo's `data` branch
// (served by jsDelivr, raw.githubusercontent.com as fallback), so the scheduled
// data refresh never has to redeploy the site.
//   - VITE_DATA_BASE overrides everything (one base URL, or several separated by commas).
//   - REPOSITORY_URL is set automatically by Netlify builds (e.g. https://github.com/user/repo).
//   - Otherwise (local dev/preview) use ./public/data.
// `{ref}` is filled in at runtime: `data` (the branch) for index.json, and the
// commit named in index.json (`rev`) for round files and crests, which never
// change at a given commit and can be cached forever.
function dataBases(): string[] {
  if (process.env.VITE_DATA_BASE) return process.env.VITE_DATA_BASE.split(',').map((b) => b.trim().replace(/\/$/, ''));
  const repo = process.env.REPOSITORY_URL?.match(/github\.com[/:]([^/]+\/[^/.]+)/)?.[1];
  if (repo) {
    return [
      `https://cdn.jsdelivr.net/gh/${repo}@{ref}`,
      `https://raw.githubusercontent.com/${repo}/{ref}`,
    ];
  }
  return ['/data'];
}

/** How old a saved index may be and still be shown while the fresh one loads. */
const SAVED_INDEX_MAX_AGE = 12 * 3600e3;

/**
 * Start loading the first screen's data while the HTML is still being parsed,
 * instead of after the JS bundle has downloaded and the app has started
 * (scripts/early-data.js; src/lib/data.ts picks the requests up), and warm up the
 * connections the first screen needs.
 */
function earlyData(bases: string[]): Plugin {
  const first = bases[0].replace('{ref}', 'data');
  const origin = /^https?:\/\//.test(first) ? new URL(first).origin : null;
  let script: Promise<string> | null = null;
  const build = async () => {
    const src = fs.readFileSync(fileURLToPath(new URL('./scripts/early-data.js', import.meta.url)), 'utf8')
      .replace('__BASES__', JSON.stringify(bases))
      .replace('__MAX_AGE__', String(SAVED_INDEX_MAX_AGE));
    const out = await transformWithEsbuild(src, 'early-data.js', { minify: true, target: 'es2017' });
    return out.code.trim();
  };
  const CHARSET = '<meta charset="UTF-8" />';
  return {
    name: 'rondo-early-data',
    // Right after the charset, ahead of the stylesheet: an inline script placed after a
    // stylesheet waits for it to download before it runs.
    async transformIndexHtml(html) {
      if (!html.includes(CHARSET)) throw new Error(`early-data: index.html has no ${CHARSET}`);
      script ??= build();
      const tags = [
        `<script>${await script}</script>`,
        // fetch() uses the CORS connection pool and <img> the plain one, so warm both.
        ...(origin ? [`<link rel="preconnect" href="${origin}" crossorigin />`, `<link rel="preconnect" href="${origin}" />`] : []),
        '<link rel="preconnect" href="https://i.ytimg.com" />',
      ];
      // A replacer function: the minified script can contain `$&`, which a replacement string would expand.
      return html.replace(CHARSET, () => `${CHARSET}\n    ${tags.join('\n    ')}`);
    },
  };
}

/**
 * Startup wheel (index.html): move the stylesheet link from <head> to just after the
 * wheel in <body> (the `<!-- rondo:stylesheet -->` marker). Browsers draw what comes
 * before a stylesheet link in the body while it loads (Chrome since 69, Safari since
 * 2017, Firefox), so the wheel shows as soon as the page starts arriving, and the page
 * below it waits for its styles as before. In the lab this cost nothing: matches were
 * on screen at the same time, and the full app and largest image too.
 */
function startupWheel(): Plugin {
  const MARK = '<!-- rondo:stylesheet -->';
  return {
    name: 'rondo-startup-wheel',
    apply: 'build',
    transformIndexHtml: {
      order: 'post',
      handler(html) {
        const links = html.match(/<link rel="stylesheet"[^>]*href="[^"]+\.css"[^>]*>/g) ?? [];
        if (links.length !== 1) throw new Error(`startup wheel: expected one stylesheet link, found ${links.length}`);
        if (!html.includes(MARK)) throw new Error(`startup wheel: index.html has no ${MARK}`);
        return html.replace(links[0], '').replace(MARK, () => links[0]);
      },
    },
  };
}

const bases = dataBases();

export default defineConfig({
  // Preact runs the React code (react and react-dom are aliased to preact/compat): the
  // same components in a bundle about a third the size, which starts faster on phones.
  plugins: [preact(), earlyData(bases), startupWheel(), prerenderPages()],
  server: { host: true, port: 5173 },
  define: { __DATA_BASES__: JSON.stringify(bases) },
});
