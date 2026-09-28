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

let all: string[] | null = null;
/** Every country we can name, sorted by display name. */
export function allRegions() {
  all ??= [...new Set(Object.values(TZ))].sort((a, b) => countryName(a).localeCompare(countryName(b)));
  return all;
}
