const KEY = 'rondo:freshLoad';

/**
 * A chunk of this page's build failed to load. Each deploy renames the chunks and the old
 * build's are gone from the server, so a tab opened before a deploy can't load "My teams"
 * or the account sheet, and clicking them did nothing. Load the page again (at `url`, or
 * where it is), which brings the new build. At most once a minute, so a network that's
 * down doesn't reload the page over and over.
 */
export function loadFresh(url?: string) {
  if (!navigator.onLine) return;
  try {
    if (Date.now() - Number(sessionStorage.getItem(KEY) ?? 0) < 60e3) return;
    sessionStorage.setItem(KEY, String(Date.now()));
  } catch { return; }
  if (url) location.assign(url);
  else location.reload();
}
