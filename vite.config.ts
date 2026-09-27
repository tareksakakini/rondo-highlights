import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// Production builds read highlight data from the GitHub repo's `data` branch
// (served by jsDelivr, raw.githubusercontent.com as fallback), so the scheduled
// data refresh never has to redeploy the site.
//   - VITE_DATA_BASE overrides everything (single base URL).
//   - REPOSITORY_URL is set automatically by Netlify builds (e.g. https://github.com/user/repo).
//   - Otherwise (local dev/preview) use ./public/data.
function dataBases(): string[] {
  if (process.env.VITE_DATA_BASE) return [process.env.VITE_DATA_BASE.replace(/\/$/, '')];
  const repo = process.env.REPOSITORY_URL?.match(/github\.com[/:]([^/]+\/[^/.]+)/)?.[1];
  if (repo) {
    return [
      `https://cdn.jsdelivr.net/gh/${repo}@data`,
      `https://raw.githubusercontent.com/${repo}/data`,
    ];
  }
  return ['/data'];
}

export default defineConfig({
  plugins: [react()],
  server: { host: true, port: 5173 },
  define: { __DATA_BASES__: JSON.stringify(dataBases()) },
});
