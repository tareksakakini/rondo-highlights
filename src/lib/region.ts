import tzCountry from './tz-country.json';

// Which country is the visitor in? We only need it to pick YouTube videos that
// play there, so a private, server-free guess is enough: the browser's time zone
// (e.g. Europe/London → GB), then the language region (en-GB → GB).
// Visitors can override it in Settings (VPNs, travel, shared time zones).

// tz-country.json: time zone → country, generated from the MIT-licensed countries-and-timezones package.
const TZ = tzCountry as Record<string, string>;

export function detectRegion(): string | null {
  try {
    const tz = Intl.DateTimeFormat().resolvedOptions().timeZone;
    if (tz && TZ[tz]) return TZ[tz];
  } catch { /* ignore */ }
  const lang = (navigator.languages ?? [navigator.language]).find((l) => /-[A-Za-z]{2}$/.test(l));
  return lang ? lang.slice(-2).toUpperCase() : null;
}

let names: Intl.DisplayNames | null = null;
export function countryName(code: string) {
  try {
    names ??= new Intl.DisplayNames([navigator.language || 'en'], { type: 'region' });
    return names.of(code) ?? code;
  } catch {
    return code;
  }
}

export function flag(code: string) {
  return /^[A-Z]{2}$/.test(code) ? String.fromCodePoint(...[...code].map((c) => 0x1f1a5 + c.charCodeAt(0))) : '🌐';
}

declare global {
  interface Window { __rondoGeo?: Promise<{ country: string | null }> }
}

let all: string[] | null = null;
/** Every country we can name, sorted by display name. */
export function allRegions() {
  all ??= [...new Set(Object.values(TZ))].sort((a, b) => countryName(a).localeCompare(countryName(b)));
  return all;
}

/**
 * The visitor's country as our CDN sees it (Netlify GeoIP rule → /geo.json).
 * This is the same signal YouTube uses to block videos, so it beats the time zone
 * for VPN users and travellers. Resolves null in local dev or if it's slow.
 */
export async function fetchNetworkRegion(timeoutMs = 2500): Promise<string | null> {
  try {
    const cached = sessionStorage.getItem('rondo:netRegion');
    if (cached) return cached === '-' ? null : cached;
  } catch { /* ignore */ }
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  // Usually already on its way: scripts/early-data.js asks as the page starts loading.
  const early = window.__rondoGeo;
  window.__rondoGeo = undefined;
  try {
    const timeout = new Promise<never>((_, reject) => ctrl.signal.addEventListener('abort', () => reject(new Error('timeout'))));
    const load = early ?? fetch(`${import.meta.env.BASE_URL}geo.json`, { cache: 'no-store', signal: ctrl.signal }).then((res) => {
      if (!res.ok) throw new Error(String(res.status));
      return res.json() as Promise<{ country: string | null }>;
    });
    const { country } = await Promise.race([load, timeout]);
    const code = typeof country === 'string' && /^[A-Z]{2}$/.test(country) ? country : null;
    try { sessionStorage.setItem('rondo:netRegion', code ?? '-'); } catch { /* ignore */ }
    return code;
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}
