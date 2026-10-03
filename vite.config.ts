import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { defineConfig, transformWithEsbuild, type Plugin } from 'vite';
import preact from '@preact/preset-vite';
import { prerenderPages } from './scripts/prerender';

// Production builds read highlight data from the GitHub repo's `data` branch
// (served by jsDelivr, raw.githubusercontent.com as fallback), so the scheduled
// data refresh never has to redeploy the site.
//   - VITE_DATA_BASE overrides everything (single base URL).
//   - REPOSITORY_URL is set automatically by Netlify builds (e.g. https://github.com/user/repo).
//   - Otherwise (local dev/preview) use ./public/data.
// `{ref}` is filled in at runtime: `data` (the branch) for index.json, and the
// commit named in index.json (`rev`) for round files and crests, which never
// change at a given commit and can be cached forever.
function dataBases(): string[] {
  if (process.env.VITE_DATA_BASE) return [process.env.VITE_DATA_BASE.replace(/\/$/, '')];
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
      return html.replace(CHARSET, `${CHARSET}\n    ${tags.join('\n    ')}`);
    },
  };
}

const bases = dataBases();

export default defineConfig({
  // Preact runs the React code (react and react-dom are aliased to preact/compat): the
  // same components in a bundle about a third the size, which starts faster on phones.
  plugins: [preact(), earlyData(bases), prerenderPages()],
  server: { host: true, port: 5173 },
  define: { __DATA_BASES__: JSON.stringify(bases) },
});
