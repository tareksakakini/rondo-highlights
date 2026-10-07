// Inlined into <head> of every page at build time (see earlyData in vite.config.ts),
// so the data the first screen needs starts loading while the HTML is still being
// parsed, instead of after the app's JS has downloaded and started. src/lib/data.ts
// and src/lib/region.ts pick these requests up.
//
//   - index.json from the data branch (always revalidated);
//   (from jsDelivr, and also from raw.githubusercontent when jsDelivr is slow to answer:
//   see race() below; GitHub throttles anonymous downloads at limits it doesn't publish,
//   so it backs jsDelivr up rather than replacing it)
//   - the round file the page will show, and condensed.json, as soon as an index
//     names the data commit (`rev`) they live at;
//   - /geo.json (the visitor's country), unless this tab already knows it.
//
// Repeat visits: the index saved on the last visit (if recent) names a commit whose
// files are already in the browser's cache, so the round shows without waiting for
// the network. The fresh index replaces it when it arrives.
//
// Which round: prerendered pages carry <meta name="rondo-route" content="CODE [ROUND]">
// (empty on the home page). The app makes the same choice in App.tsx: the page's
// competition, else the one picked last time, else the first; and the page's round,
// else that competition's current round.
//
// Plain ES2017 that runs before anything else: keep it small, and never let it throw.
(function (BASES, MAX_AGE) {
  var w = window;
  var early = (w.__rondoEarly = {}); // url -> response JSON; the app takes (removes) them
  var started = {};
  function json(r) {
    if (!r.ok) throw new Error(r.status);
    return r.json();
  }
  function url(ref, path, i) {
    return BASES[i || 0].replace('{ref}', ref) + '/' + path;
  }
  // Hedged requests: ask the first base (jsDelivr); if it hasn't answered within HEDGE_MS
  // or fails, ask the next one (raw.githubusercontent) too, take the first good answer and
  // cancel the rest. An uncached file took 0.4-11 s on jsDelivr and 0.1-0.35 s on GitHub
  // (2026-10-07); a cached one answers well within HEDGE_MS, so then GitHub isn't asked.
  // Stored under the first base's URL, where src/lib/data.ts looks for it.
  var HEDGE_MS = 200;
  function race(ref, path, init) {
    if (BASES.length < 2) return fetch(url(ref, path), init).then(json);
    return new Promise(function (resolve, reject) {
      var ctrls = [];
      var failed = 0;
      var next = 0;
      var done = false;
      var timer = null;
      function start() {
        if (done || next >= BASES.length) return;
        var i = next++;
        var ctrl = typeof AbortController === 'function' ? new AbortController() : null;
        ctrls[i] = ctrl;
        var opts = {};
        for (var k in init) opts[k] = init[k];
        if (ctrl) opts.signal = ctrl.signal;
        fetch(url(ref, path, i), opts).then(json).then(function (body) {
          done = true;
          clearTimeout(timer);
          ctrls.forEach(function (c, j) { if (c && j !== i) c.abort(); });
          resolve(body);
        }, function (e) {
          if (++failed === BASES.length) reject(e);
          else if (!done) { clearTimeout(timer); start(); }
        });
        timer = setTimeout(start, HEDGE_MS);
      }
      start();
    });
  }
  function read(key) {
    try { return JSON.parse(localStorage.getItem('rondo:' + key)); } catch (e) { return null; }
  }
  function quiet(p) {
    p.catch(function () {});
    return p;
  }
  try {
    var fresh = quiet(race('data', 'index.json', { cache: 'no-cache' }));
    w.__rondoIndex = fresh;

    var meta = document.querySelector('meta[name="rondo-route"]');
    var route = meta ? meta.content.split(' ') : location.pathname === '/' ? [''] : null;
    if (/^#\//.test(location.hash)) route = null; // an old #/PL/md-5 link: the app sorts it out

    var prefetch = function (idx) {
      if (!route || !idx || !/^[0-9a-f]{40}$/.test(idx.rev)) return;
      var comps = idx.competitions || [];
      var code = route[0] || read('comp');
      var comp = null;
      for (var i = 0; i < comps.length; i++) if (comps[i].code === code) comp = comps[i];
      if (!comp && !route[0]) comp = comps[0];
      var key = route[1] || (comp && comp.currentRound);
      if (!comp || !key) return;
      var files = [comp.code + '/' + key + '.json'];
      if (read('autoCondense') !== false) files.push('condensed.json');
      files.forEach(function (path) {
        var u = url(idx.rev, path);
        if (started[u]) return; // also when the app has already taken it
        started[u] = 1;
        early[u] = quiet(race(idx.rev, path, {}));
      });
    };

    var saved = read('indexCache');
    var savedIdx = saved && saved.idx && Date.now() - saved.t < MAX_AGE ? saved.idx : null;
    if (savedIdx) {
      w.__rondoSavedIndex = savedIdx;
      prefetch(savedIdx);
    }

    // Home and competition pages show the cards of the round that was current at build
    // time (<meta name="rondo-pre">). If this visitor will see another competition (the
    // one viewed last, on home) or a saved index says the round has moved on, show the
    // page's placeholders instead, before the first paint (scripts/prerender.ts).
    var preMeta = document.querySelector('meta[name="rondo-pre"]');
    if (preMeta && route) {
      var pre = preMeta.content.split(' ');
      var code = route[0] || read('comp');
      var stale = !!code && code !== pre[0];
      var known = savedIdx && savedIdx.competitions || [];
      for (var j = 0; j < known.length; j++) {
        if (known[j].code === pre[0] && known[j].currentRound && known[j].currentRound !== pre[1]) stale = true;
      }
      if (stale) document.documentElement.classList.add('pre-stale');
    }
    quiet(fresh.then(prefetch));

    var region = null;
    try { region = sessionStorage.getItem('rondo:netRegion'); } catch (e) { /* ignore */ }
    if (!region) w.__rondoGeo = quiet(fetch('/geo.json', { cache: 'no-store' }).then(json));
  } catch (e) {
    /* the app loads everything itself */
  }
})(__BASES__, __MAX_AGE__);
