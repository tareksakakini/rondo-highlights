import { useCallback, useEffect, useMemo, useReducer, useRef, useState } from 'react';
import type { Competition, DataIndex, Kind, Match, PlayItem, RoundFile } from './types';
import { fetchCondensed, fetchIndex, fetchRound } from './lib/data';
import type { CondensedMap } from './lib/moments';
import { cutKind, cutLabel, cutSec, fmtDay, fmtDuration, fmtTotal, kindLabel, matchTitle, pickCut, pickHighlight, resolveItem, scrubScore, uid } from './lib/format';
import { countryName, detectRegion, fetchNetworkRegion, flag } from './lib/region';
import { initialPlayback, playbackReducer } from './lib/playback';
import { usePersistentState } from './lib/storage';
import { describeYtError } from './lib/youtube';
import { compHead, compHeading, compPath, homeHead, legacyHash, resolvePath, roundHead, roundHeading, roundPath } from './lib/routes';
import { applyHead } from './lib/head';
import { Logo } from './components/Logo';
import { MatchCard } from './components/MatchCard';
import { Player } from './components/Player';
import { QueueSuggestions, UpNext } from './components/UpNext';
import { Settings } from './components/Settings';

function readQueue(): PlayItem[] {
  try { return JSON.parse(localStorage.getItem('rondo:queue') ?? '[]'); } catch { return []; }
}

/** Which kind of page the URL names: the app shows a round on all three. */
type Page = 'home' | 'comp' | 'round';

/** Follow an in-app link with a plain click; let modified clicks (new tab etc.) through. */
/** A round's URL; rounds without fixtures have no page of their own, so they use the competition's. */
const pathFor = (c: Competition, key: string | null) =>
  key && c.rounds.find((r) => r.key === key)?.matches ? roundPath(c, key) : compPath(c);

function onNav(e: React.MouseEvent, go: () => void) {
  if (e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
  e.preventDefault();
  go();
}

export default function App() {
  const [index, setIndex] = useState<DataIndex | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [compCode, setCompCode] = usePersistentState<string | null>('comp', null);
  const [roundKey, setRoundKey] = useState<string | null>(null);
  const [page, setPage] = useState<Page>('home');
  const [round, setRound] = useState<RoundFile | null>(null);
  const [pref, setPref] = usePersistentState<Kind>('length', 'short');
  const [spoilerFree, setSpoilerFree] = usePersistentState('spoilerFree', false);
  const [autoplay, setAutoplay] = usePersistentState('autoplay', true);
  // Auto-condense (on by default): a match with no short cut plays the key moments
  // of its extended cut instead, when YouTube's chapters give us those moments.
  const [autoCondense, setAutoCondense] = usePersistentState('autoCondense', true);
  const [condensed, setCondensed] = useState<CondensedMap | null>(null);
  const cmap = autoCondense ? condensed : null;
  const [moment, setMoment] = useState<number | null>(null);
  const [revealTitle, setRevealTitle] = useState(false);
  const [pins, setPins] = useState<Record<string, Kind>>({});
  const [settingsOpen, setSettingsOpen] = useState(false);
  // Country: your choice in Settings > what our CDN sees (same signal YouTube uses) > time zone.
  const tzRegion = useMemo(detectRegion, []);
  const [netRegion, setNetRegion] = useState<string | null>(null);
  const detected = netRegion ?? tzRegion;
  const detectedFrom: 'network' | 'timezone' | null = netRegion ? 'network' : tzRegion ? 'timezone' : null;
  const [regionOverride, setRegionOverride] = usePersistentState('region', '');
  const region = regionOverride || detected;
  const [embedErrors, setEmbedErrors] = useState(0);
  // Channels whose embeds failed with 101/150, per country, remembered for a week.
  const [embedBlocked, setEmbedBlocked] = usePersistentState<Record<string, Record<string, number>>>('embedBlocked', {});
  const avoid = useMemo(() => {
    const week = Date.now() - 7 * 864e5;
    return Object.entries(embedBlocked[region ?? '??'] ?? {}).filter(([, t]) => t > week).map(([id]) => id);
  }, [embedBlocked, region]);

  useEffect(() => {
    let alive = true;
    fetchNetworkRegion().then((c) => { if (alive && c) setNetRegion(c); });
    return () => { alive = false; };
  }, []);
  const [toast, setToast] = useState<string | null>(null);
  const [pb, dispatch] = useReducer(playbackReducer, undefined, () => initialPlayback(readQueue()));
  const stageRef = useRef<HTMLDivElement>(null);
  useEffect(() => { if ('scrollRestoration' in history) history.scrollRestoration = 'manual'; }, []);
  const returnTo = useRef<{ y: number; match: Match['id'] | null }>({ y: 0, match: null });
  const onStageEntry = useRef(false);

  // ---- data loading ----
  useEffect(() => {
    fetchIndex()
      .then((idx) => {
        setIndex(idx);
        const byCode = (code: string | null | undefined) => idx.competitions.find((c) => c.code === code);
        // The URL decides (/premier-league/matchweek-5/); an unknown path (404 page) goes home.
        let route = resolvePath(idx.competitions, location.pathname);
        if (!route) {
          history.replaceState(null, '', '/');
          route = { code: null, round: null };
        }
        // Old links: /#/PL/md-5 becomes /premier-league/matchweek-5/.
        const legacy = route.code === null ? legacyHash(location.hash) : null;
        if (legacy) {
          const lc = byCode(legacy.code);
          const lr = lc?.rounds.some((r) => r.key === legacy.round) ? legacy.round : null;
          if (lc) route = { code: lc.code, round: lr };
          history.replaceState(null, '', lc ? (lr ? roundPath(lc, lr) : compPath(lc)) : '/');
        }
        const comp = byCode(route.code) ?? byCode(compCode) ?? idx.competitions[0];
        if (comp) {
          setCompCode(comp.code);
          setRoundKey(route.round ?? comp.currentRound);
        }
        setPage(route.round ? 'round' : route.code ? 'comp' : 'home');
      })
      .catch((e: Error) => setLoadError(e.message));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const comp: Competition | undefined = index?.competitions.find((c) => c.code === compCode);

  useEffect(() => {
    if (!comp || !roundKey) return;
    let stale = false;
    setRound(null);
    fetchRound(comp.code, roundKey).then((r) => { if (!stale) setRound(r); }).catch((e: Error) => setToast(e.message));
    return () => { stale = true; };
  }, [comp, roundKey]);

  // ---- URLs: each competition and round has its own page ----
  /** Show a competition (its current round) or one round, as a new history entry. */
  const navigate = (c: Competition, key: string | null) => {
    setCompCode(c.code);
    setRoundKey(key ?? c.currentRound);
    setPage(key ? 'round' : 'comp');
    const path = pathFor(c, key);
    if (location.pathname !== path || location.hash) history.pushState(null, '', path);
  };

  useEffect(() => {
    if (!index) return;
    const onPop = (e: PopStateEvent) => {
      // Back from the player's history entry: return to the list where the match was picked.
      const leavingStage = onStageEntry.current && !e.state?.rondoStage;
      const enteringStage = !onStageEntry.current && !!e.state?.rondoStage;
      onStageEntry.current = !!e.state?.rondoStage;
      if (enteringStage) requestAnimationFrame(() => stageRef.current?.scrollIntoView({ block: 'start' }));
      // Back/Forward to another round: show its list from the top (we restore scroll ourselves).
      if (!leavingStage && !enteringStage) {
        requestAnimationFrame(() => {
          const browse = document.querySelector<HTMLElement>('.browse');
          if (browse && browse.getBoundingClientRect().top < 0) browse.scrollIntoView({ block: 'start' });
        });
      }
      if (leavingStage) {
        // After the next render (closing removes the player above the list): back to the
        // card that was played, else to where the page was.
        const { y, match } = returnTo.current;
        requestAnimationFrame(() => {
          const card = match != null ? document.querySelector(`.card[data-match="${CSS.escape(String(match))}"]`) : null;
          if (card) card.scrollIntoView({ block: 'center' });
          else window.scrollTo({ top: y });
        });
      }
      const route = resolvePath(index.competitions, location.pathname);
      if (!route) return;
      const c = index.competitions.find((x) => x.code === route.code);
      if (c) {
        setCompCode(c.code);
        setRoundKey(route.round ?? c.currentRound);
      }
      setPage(route.round ? 'round' : route.code ? 'comp' : 'home');
    };
    window.addEventListener('popstate', onPop);
    return () => window.removeEventListener('popstate', onPop);
  }, [index, setCompCode]);

  const roundMeta = comp?.rounds.find((r) => r.key === roundKey);
  const fixtures = round && round.round.key === roundKey && round.competition === comp?.code
    ? round.matches.map((m) => `${m.home.short || m.home.name} v ${m.away.short || m.away.name}`)
    : [];
  const fixturesKey = fixtures.join('|');
  useEffect(() => {
    if (!comp) return;
    if (page === 'home') applyHead(homeHead());
    else if (page === 'comp' || !roundMeta) applyHead(compHead(comp));
    else applyHead(roundHead(comp, roundMeta, fixtures));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [page, comp, roundMeta, fixturesKey]);
  const heading = page === 'home' || !comp ? 'Football highlights, back to back'
    : page === 'comp' || !roundMeta ? compHeading(comp) : roundHeading(comp, roundMeta);

  useEffect(() => {
    try { localStorage.setItem('rondo:queue', JSON.stringify(pb.queue)); } catch { /* ignore */ }
  }, [pb.queue]);

  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), 4500);
    return () => clearTimeout(t);
  }, [toast]);

  useEffect(() => {
    if (!autoCondense || !index || condensed) return;
    let alive = true;
    fetchCondensed().then((c) => { if (alive) setCondensed(c); }).catch(() => { /* not generated yet */ });
    return () => { alive = false; };
  }, [autoCondense, index, condensed]);

  // ---- helpers ----
  const toItem = useCallback(
    (m: Match, kind?: Kind): PlayItem => ({
      uid: uid(), match: m, kind,
      comp: { code: comp!.code, name: comp!.name, color: comp!.color },
      roundLabel: round!.round.label,
    }),
    [comp, round],
  );
  const playable = useMemo(() => round?.matches.filter((m) => pickHighlight(m, pref, [], region)) ?? [], [round, pref, region]);
  const withAny = round?.matches.filter((m) => m.highlights.length).length ?? 0;
  const blockedHere = useMemo(() => round?.matches.filter((m) => m.highlights.length && !pickHighlight(m, pref, [], region)) ?? [], [round, pref, region]);
  const notYet = useMemo(() => round?.matches.filter((m) => !m.highlights.length) ?? [], [round]);
  const cutFor = (m: Match) => pickCut(m, pins[m.id] ?? pref, cmap, [], region, avoid);
  const roundTotal = playable.reduce((t, m) => { const c = cutFor(m); return t + (c ? cutSec(c) : 0); }, 0);
  const condensedHere = playable.filter((m) => cutFor(m)?.condensed).length;

  /**
   * Starting a match from the list scrolls up to the player. That also adds a history
   * entry (same URL), so Back returns to where you were in the list while the video keeps
   * playing in the mini player, like YouTube on phones. A second Back leaves as usual.
   */
  const toStage = (matchId?: Match['id']) => {
    returnTo.current = { y: window.scrollY, match: matchId ?? null };
    if (!history.state?.rondoStage) history.pushState({ rondoStage: true }, '');
    onStageEntry.current = true;
    requestAnimationFrame(() => stageRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' }));
  };
  /** Closing the player from its own history entry steps back to the list too. */
  const closePlayer = () => {
    dispatch({ type: 'stop' });
    if (history.state?.rondoStage) history.back();
  };
  /** Play all: the round from its first match, the rest of it at the front of the queue. */
  const playAll = () => {
    dispatch({ type: 'playRound', items: playable.map((m) => toItem(m, pins[m.id])), start: 0 });
    toStage();
  };
  /** Play on one card: just that match; the queue carries on after it. */
  const playMatch = (m: Match, kind?: Kind) => {
    dispatch({ type: 'playOne', item: toItem(m, kind ?? pins[m.id]) });
    toStage(m.id);
  };
  const queueMatch = (m: Match, kind?: Kind) => {
    if (pb.queue.some((q) => q.match.id === m.id)) {
      dispatch({ type: 'dequeueMatch', matchId: m.id });
      setToast(`Removed ${matchTitle(m)} from the queue`);
      return;
    }
    dispatch({ type: 'enqueue', items: [toItem(m, kind)] });
    setToast(`Queued ${matchTitle(m)}`);
  };
  const queueAll = () => {
    const inQueue = new Set(pb.queue.map((q) => q.match.id));
    const adding = playable.filter((m) => !inQueue.has(m.id) && m.id !== pb.current?.match.id);
    dispatch({ type: 'enqueue', items: adding.map((m) => toItem(m, pins[m.id])) });
    setToast(adding.length ? `Queued ${adding.length} matches from ${round!.round.label}` : 'Already in your queue');
  };

  // ---- current video ----
  const current = pb.current;
  const picked = current ? resolveItem(current, pref, cmap, pb.failed[current.uid], region, avoid) : null;
  const video = picked?.h ?? null;
  const cut = picked?.condensed ?? null;

  useEffect(() => {
    if (current && !video) {
      setToast(`Skipped ${matchTitle(current.match)}: no video plays in ${region ? countryName(region) : 'your country'}`);
      dispatch({ type: 'next' });
    }
  }, [current, video]);

  useEffect(() => setRevealTitle(false), [current?.uid]);

  const onEnded = useCallback(() => { if (autoplay) dispatch({ type: 'next' }); }, [autoplay]);
  const onError = useCallback(
    (code: number) => {
      if (!video) return;
      setToast(`${video.channel}: ${describeYtError(code)}. Trying another cut`);
      // 101/150 also show up when a video is blocked in the viewer's country: after a
      // couple of those, suggest checking the country setting (VPNs, travel).
      if (code === 101 || code === 150) {
        setEmbedErrors((n) => n + 1);
        const ch = video.channelId;
        if (ch) {
          const key = region ?? '??';
          setEmbedBlocked((b) => ({ ...b, [key]: { ...b[key], [ch]: Date.now() } }));
        }
      }
      dispatch({ type: 'failed', videoId: video.videoId });
    },
    [video, region, setEmbedBlocked],
  );

  // Keyboard: Shift+N next, Shift+P previous
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!e.shiftKey || (e.target as HTMLElement)?.closest('input,select,textarea')) return;
      if (e.key === 'N') dispatch({ type: 'next' });
      if (e.key === 'P') dispatch({ type: 'prev' });
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  const queuedIds = new Set(pb.queue.map((q) => q.match.id));
  const renderCard = (m: Match) => (
    <MatchCard
      key={m.id}
      match={m}
      pref={pref}
      condensed={cmap}
      region={region}
      avoid={avoid}
      spoilerFree={spoilerFree}
      playing={current?.match.id === m.id}
      queued={queuedIds.has(m.id)}
      pinned={pins[m.id]}
      onPin={(k) => setPins((p) => ({ ...p, [m.id]: k }))}
      onPlay={(k) => playMatch(m, k)}
      onQueue={(k) => queueMatch(m, k)}
    />
  );

  const roundIdx = comp?.rounds.findIndex((r) => r.key === roundKey) ?? -1;
  const hasUpNext = pb.queue.length > 0;
  // While a match plays, the queue column stays on wide screens even when the queue is
  // empty, so the player keeps its size; it then suggests the rest of the browsed round.
  const showAside = hasUpNext || !!current;
  const suggestions = !hasUpNext && current && round
    ? playable.filter((m) => m.id !== current.match.id).map((m) => toItem(m, pins[m.id]))
    : [];

  return (
    <div className="app">
      <header className="topbar">
        <Logo />
        <span className="tagline">Football highlights, back to back</span>
        <div className="prefs">
          <div className="seg" role="radiogroup" aria-label="Preferred highlight length">
            {(['short', 'extended'] as Kind[]).map((k) => (
              <button key={k} role="radio" aria-checked={pref === k} className={pref === k ? 'on' : ''} onClick={() => setPref(k)}>
                {k === 'extended' ? <><span className="lbl-long">Extended</span><span className="lbl-short">Ext.</span></> : kindLabel(k)}
              </button>
            ))}
          </div>
          <button className={`toggle cond-toggle${autoCondense ? ' on' : ''}`} aria-pressed={autoCondense} onClick={() => setAutoCondense(!autoCondense)}
            title="Auto-condense: when a match has no short cut, play just the key moments of the extended cut, found from YouTube's chapters. It can occasionally skip a goal."
            aria-label="Auto-condense matches with no short cut">
            <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M9.64 7.64c.23-.5.36-1.05.36-1.64 0-2.21-1.79-4-4-4S2 3.79 2 6s1.79 4 4 4c.59 0 1.14-.13 1.64-.36L10 12l-2.36 2.36C7.14 14.13 6.59 14 6 14c-2.21 0-4 1.79-4 4s1.79 4 4 4 4-1.79 4-4c0-.59-.13-1.14-.36-1.64L12 14l7 7h3v-1L9.64 7.64zM6 8c-1.1 0-2-.89-2-2s.9-2 2-2 2 .89 2 2-.9 2-2 2zm0 12c-1.1 0-2-.89-2-2s.9-2 2-2 2 .89 2 2-.9 2-2 2zm6-7.5c-.28 0-.5-.22-.5-.5s.22-.5.5-.5.5.22.5.5-.22.5-.5.5zM19 3l-6 6 2 2 7-7V3z" /></svg>
            <span className="toggle-text">Auto-condense</span><sup>*</sup>
          </button>
          <button className={`toggle spoiler-toggle${spoilerFree ? ' on' : ''}`} aria-pressed={spoilerFree} onClick={() => setSpoilerFree(!spoilerFree)}
            title="Spoiler-free: hide scores and thumbnails" aria-label="Spoiler-free">
            <svg viewBox="0 0 24 24" aria-hidden="true">
              {spoilerFree
                ? <path d="M12 7a5 5 0 0 1 5 5c0 .6-.1 1.3-.4 1.8l2.9 2.9A11.8 11.8 0 0 0 23 12c-1.7-4.4-6-7.5-11-7.5-1.4 0-2.7.3-4 .7l2.2 2.2c.5-.3 1.1-.4 1.8-.4M2 4.3l2.3 2.3.4.4A11.8 11.8 0 0 0 1 12c1.7 4.4 6 7.5 11 7.5 1.5 0 3-.3 4.4-.8l.4.4 2.9 2.9 1.3-1.3L3.3 3zM7.5 9.8 9 11.4v.6a3 3 0 0 0 3 3h.6l1.6 1.6A5 5 0 0 1 7 12c0-.8.2-1.5.5-2.2m4.3-.8 3.2 3.2V12a3 3 0 0 0-3-3z" />
                : <path d="M12 4.5C7 4.5 2.7 7.6 1 12c1.7 4.4 6 7.5 11 7.5s9.3-3.1 11-7.5c-1.7-4.4-6-7.5-11-7.5M12 17a5 5 0 1 1 0-10 5 5 0 0 1 0 10m0-8a3 3 0 1 0 0 6 3 3 0 0 0 0-6" />}
            </svg>
            <span className="toggle-text">Spoiler-free</span>
          </button>
          <button className="toggle settings-btn" onClick={() => setSettingsOpen(true)} aria-label={`Settings (country: ${region ? countryName(region) : 'unknown'})`} title="Settings">
            <span className="flag" aria-hidden="true">{region ? flag(region) : '🌐'}</span>
            <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M19.4 13a7.4 7.4 0 0 0 0-2l2.1-1.6-2-3.5-2.5 1a7 7 0 0 0-1.7-1L15 3.3h-4l-.4 2.6a7 7 0 0 0-1.7 1l-2.5-1-2 3.5L6.5 11a7.4 7.4 0 0 0 0 2l-2.1 1.6 2 3.5 2.5-1c.5.4 1.1.7 1.7 1l.4 2.6h4l.4-2.6c.6-.3 1.2-.6 1.7-1l2.5 1 2-3.5zM12 15.5a3.5 3.5 0 1 1 0-7 3.5 3.5 0 0 1 0 7" /></svg>
          </button>
        </div>
      </header>

      {index?.source === 'sample' && (
        <div className="notice">
          Showing a sample snapshot. Run <code>npm run ingest</code> with your API keys to load live fixtures and highlights for every competition.
        </div>
      )}

      <div className={`layout${showAside ? ' with-aside' : ''}`}>
        <main>
          {current && (
            <section className="stage" ref={stageRef} aria-label="Now playing">
              <Player
                videoId={video?.videoId ?? null}
                seq={pb.seq}
                label={matchTitle(current.match)}
                moments={cut?.m ?? null}
                onMoment={setMoment}
                onEnded={onEnded}
                onError={onError}
                onClose={closePlayer}
              />
              <div className="now">
                <div className="now-main">
                  <div className="now-kicker">
                    <i className="comp-dot" style={{ background: current.comp.color }} />
                    {current.comp.name} · {current.roundLabel}
                    {picked && (cut && moment != null
                      ? <span className="kind-tag condensed" title="The key moments of the extended cut, found from YouTube's chapters. It can skip a goal.">{cutLabel(cutKind(picked))} · {fmtDuration(cutSec(picked))}</span>
                      : <span className={`kind-tag ${picked.h.kind}`}>{kindLabel(picked.h.kind)} · {fmtDuration(picked.h.durationSec)}</span>)}
                    {cut && moment != null && <span className="moment-count">Moment {moment + 1} of {cut.m.length}</span>}
                  </div>
                  <h2 className="now-title">{matchTitle(current.match)}</h2>
                  {video && (
                    <p className="yt-meta">
                      {spoilerFree && !revealTitle ? (
                        <button className="linkish" onClick={() => setRevealTitle(true)}>{scrubScore(video.title)} <em>(reveal)</em></button>
                      ) : (
                        <a href={`https://www.youtube.com/watch?v=${video.videoId}`} target="_blank" rel="noreferrer">{video.title}</a>
                      )}
                      <span className="yt-channel">{video.channel}</span>
                    </p>
                  )}
                </div>
                <div className="transport">
                  <button className="btn-icon" onClick={() => dispatch({ type: 'prev' })} aria-label="Previous (Shift+P)" title="Previous (Shift+P)">
                    <svg viewBox="0 0 24 24"><path d="M6 6h2v12H6zm3.5 6 8.5 6V6z" /></svg>
                  </button>
                  <button className="btn-icon" onClick={() => dispatch({ type: 'next' })} aria-label="Next (Shift+N)" title="Next (Shift+N)">
                    <svg viewBox="0 0 24 24"><path d="m6 18 8.5-6L6 6zM16 6v12h2V6z" /></svg>
                  </button>
                  <label className="switch" title="Play the next match automatically">
                    <input type="checkbox" checked={autoplay} onChange={(e) => setAutoplay(e.target.checked)} />
                    <span className="track"><span className="thumb-dot" /></span>
                    Autoplay
                  </label>
                </div>
              </div>
              {embedErrors >= 2 && (
                <div className="region-note hint">
                  <span>Several videos wouldn&apos;t play here. If you&apos;re using a VPN or travelling, set the country YouTube sees you in.</span>
                  <button className="btn-ghost sm" onClick={() => { setSettingsOpen(true); setEmbedErrors(0); }}>Check country</button>
                </div>
              )}
            </section>
          )}

          {loadError && (
            <div className="empty-state">
              <h2>No highlight data yet</h2>
              <p>Run <code>npm run sample</code> for the offline snapshot, or <code>npm run ingest</code> with API keys.</p>
            </div>
          )}

          {!index && !loadError && (
            <section className="browse" aria-label="Loading highlights" aria-busy="true">
              <div className="grid">
                {Array.from({ length: 6 }, (_, i) => <div key={i} className="card skeleton" />)}
              </div>
            </section>
          )}

          {index && (
            <section className="browse" aria-label="Browse">
              <h1 className="sr-only">{heading}</h1>
              <nav className="comps" aria-label="Competitions">
                {index.competitions.map((c, i) => (
                  <span key={c.code} className="comp-wrap">
                    {i > 0 && (c.group ?? 'league') !== (index.competitions[i - 1].group ?? 'league') && <span className="comp-sep" aria-hidden="true" />}
                    <a className={`comp${c.code === compCode ? ' on' : ''}`} style={{ '--c': c.color } as React.CSSProperties}
                      href={compPath(c)} aria-current={c.code === compCode ? 'page' : undefined}
                      onClick={(e) => onNav(e, () => navigate(c, null))}>
                      <i className="comp-dot" />{c.short ?? c.name}
                    </a>
                  </span>
                ))}
              </nav>

              {comp && (
                <div className="round-bar">
                  <div className="round-nav">
                    <RoundLink comp={comp} roundKey={roundIdx > 0 ? comp.rounds[roundIdx - 1].key : null} label="Previous round" navigate={navigate}>
                      <svg viewBox="0 0 24 24"><path d="M15.4 7.4 14 6l-6 6 6 6 1.4-1.4-4.6-4.6z" /></svg>
                    </RoundLink>
                    <label className="round-select">
                      <span className="sr-only">Round</span>
                      <select value={roundKey ?? ''} onChange={(e) => navigate(comp, e.target.value)}>
                        {comp.rounds.map((r) => (
                          <option key={r.key} value={r.key}>
                            {r.label}{r.withHighlights ? '' : r.matches ? ' · upcoming' : ''}
                          </option>
                        ))}
                      </select>
                    </label>
                    <RoundLink comp={comp} roundKey={roundIdx >= 0 && roundIdx < comp.rounds.length - 1 ? comp.rounds[roundIdx + 1].key : null} label="Next round" navigate={navigate}>
                      <svg viewBox="0 0 24 24"><path d="M8.6 16.6 10 18l6-6-6-6-1.4 1.4 4.6 4.6z" /></svg>
                    </RoundLink>
                  </div>
                  {round && round.matches.length > 0 && (
                    <p className="round-meta muted">
                      <span>{fmtDay(round.matches[0].utcDate)} – {fmtDay(round.matches[round.matches.length - 1].utcDate)}</span>
                      <span>
                        {playable.length}/{round.matches.length} playable{region ? ` in ${flag(region)}` : ''}
                        {withAny > playable.length && <button className="linkish inline" onClick={() => setSettingsOpen(true)}>why?</button>}
                      </span>
                      {roundTotal > 0 && <span>{fmtTotal(roundTotal)}</span>}
                    </p>
                  )}
                  {condensedHere > 0 && (
                    <p className="cond-note">
                      <sup>*</sup> {condensedHere === 1 ? '1 match has' : `${condensedHere} matches have`} no short cut here, so {condensedHere === 1 ? 'it plays' : 'they play'} auto-condensed:
                      the key moments of the extended cut, found from YouTube&apos;s chapters. These can occasionally skip a goal.{' '}
                      <button className="linkish inline" onClick={() => setAutoCondense(false)}>Turn off</button>
                    </p>
                  )}
                  <div className="round-actions">
                    <button className="btn-primary" disabled={!playable.length} onClick={playAll}>
                      <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M8 5v14l11-7z" /></svg>
                      Play all
                    </button>
                    <button className="btn-ghost" disabled={!playable.length} onClick={queueAll}>+ Queue all</button>
                  </div>
                </div>
              )}

              {round && !playable.length && blockedHere.length > 0 && (
                <div className="region-note">
                  <strong>None of this round&apos;s highlights are licensed on YouTube in {region ? `${flag(region)} ${countryName(region)}` : 'your country'}.</strong>
                  <span> Broadcasters sell highlight rights country by country. Try another competition, or <button className="linkish inline" onClick={() => setSettingsOpen(true)}>change your country</button> if we guessed wrong.</span>
                </div>
              )}

              <div className="grid">
                {!round && comp && Array.from({ length: 6 }, (_, i) => <div key={i} className="card skeleton" />)}
                {[...playable, ...notYet].map(renderCard)}
              </div>

              {blockedHere.length > 0 && playable.length > 0 && (
                <details className="blocked-group">
                  <summary>
                    Not available in {region ? `${flag(region)} ${countryName(region)}` : 'your country'} <span className="count">{blockedHere.length}</span>
                  </summary>
                  <div className="grid">{blockedHere.map(renderCard)}</div>
                </details>
              )}
              {blockedHere.length > 0 && !playable.length && <div className="grid">{blockedHere.map(renderCard)}</div>}
            </section>
          )}
        </main>

        {showAside && (
          <aside className={`aside${hasUpNext ? '' : ' aside-suggest'}`}>
            {hasUpNext ? (
              <UpNext state={pb} pref={pref} condensed={cmap} region={region} avoid={avoid} dispatch={dispatch} />
            ) : (
              <QueueSuggestions
                items={suggestions}
                roundName={comp && round ? `${comp.short ?? comp.name} · ${round.round.label}` : 'this round'}
                pref={pref} condensed={cmap} region={region} avoid={avoid}
                onPlay={(it) => dispatch({ type: 'playOne', item: it })}
                onQueue={(it) => { dispatch({ type: 'enqueue', items: [it] }); setToast(`Queued ${matchTitle(it.match)}`); }}
                onQueueAll={queueAll}
              />
            )}
          </aside>
        )}
      </div>

      <footer className="foot muted">
        <p>
          Showing highlights that play in {region ? `${flag(region)} ${countryName(region)}` : 'your country'}.{' '}
          <button className="linkish inline" onClick={() => setSettingsOpen(true)}>Change</button>
        </p>
        <p>
          Videos are embedded from official YouTube channels; Rondo Highlights hosts no video. Football data provided by the Football-Data.org API; Europa League and Nations League fixtures by Highlightly.
          {index && ` Updated ${new Date(index.generatedAt).toLocaleString()}.`}
        </p>
      </footer>

      <Settings
        open={settingsOpen} onClose={() => setSettingsOpen(false)}
        autoplay={autoplay} setAutoplay={setAutoplay}
        detected={detected} detectedFrom={detectedFrom} override={regionOverride} setOverride={(c) => { setRegionOverride(c); setEmbedErrors(0); }}
      />

      {toast && <div className="toast" role="status">{toast}</div>}
    </div>
  );
}

/** Previous/next round: a real link (crawlable, opens in a new tab), or a disabled button at either end. */
function RoundLink({ comp, roundKey, label, navigate, children }: {
  comp: Competition; roundKey: string | null; label: string;
  navigate: (c: Competition, key: string | null) => void; children: React.ReactNode;
}) {
  if (!roundKey) return <button className="btn-icon" disabled aria-label={label}>{children}</button>;
  return (
    <a className="btn-icon" href={pathFor(comp, roundKey)} aria-label={label} title={label}
      onClick={(e) => onNav(e, () => navigate(comp, roundKey))}>
      {children}
    </a>
  );
}
