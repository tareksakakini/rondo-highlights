// Beta features, off for everyone until a browser opts in with a link:
//   ?beta=follow  turns on following teams and leagues (with an account) in this browser
//   ?beta=off     turns it off again
// The choice is kept in localStorage (rondo:beta) and the parameter is taken out of the URL.

export const followBeta = (() => {
  try {
    const q = new URLSearchParams(location.search).get('beta');
    if (q === 'follow') localStorage.setItem('rondo:beta', 'follow');
    if (q === 'off') localStorage.removeItem('rondo:beta');
    if (q != null) {
      const url = new URL(location.href);
      url.searchParams.delete('beta');
      history.replaceState(history.state, '', url.pathname + url.search + url.hash);
    }
    return localStorage.getItem('rondo:beta') === 'follow';
  } catch { return false; }
})();
