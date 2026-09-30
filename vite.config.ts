import { defineConfig, type HtmlTagDescriptor, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';

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

/**
 * Start loading index.json while the HTML is still being parsed, instead of
 * after the JS bundle has downloaded and React has mounted (src/lib/data.ts
 * picks the promise up), and warm up the connections the first screen needs.
 */
function earlyData(bases: string[]): Plugin {
  const first = bases[0].replace('{ref}', 'data');
  const origin = /^https?:\/\//.test(first) ? new URL(first).origin : null;
  const tag = (t: Omit<HtmlTagDescriptor, 'injectTo'>): HtmlTagDescriptor => ({ ...t, injectTo: 'head' });
  const tags: HtmlTagDescriptor[] = [
    tag({
      tag: 'script',
      children:
        `window.__rondoIndex=fetch(${JSON.stringify(`${first}/index.json`)},{cache:'no-cache'})` +
        `.then(function(r){if(!r.ok)throw new Error(r.status);return r.json()});window.__rondoIndex.catch(function(){});`,
    }),
    // fetch() uses the CORS connection pool and <img> the plain one, so warm both.
    ...(origin
      ? [
          tag({ tag: 'link', attrs: { rel: 'preconnect', href: origin, crossorigin: '' } }),
          tag({ tag: 'link', attrs: { rel: 'preconnect', href: origin } }),
        ]
      : []),
    tag({ tag: 'link', attrs: { rel: 'preconnect', href: 'https://i.ytimg.com' } }),
  ];
  return { name: 'rondo-early-data', transformIndexHtml: () => tags };
}

const bases = dataBases();

export default defineConfig({
  plugins: [react(), earlyData(bases)],
  server: { host: true, port: 5173 },
  define: { __DATA_BASES__: JSON.stringify(bases) },
});
