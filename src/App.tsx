import { useCallback, useEffect, useMemo, useReducer, useRef, useState } from 'react';
import type { Competition, DataIndex, Kind, Match, PlayItem, RoundFile } from './types';
import { fetchIndex, fetchRound } from './lib/data';
import { fmtDay, fmtDuration, fmtTotal, kindLabel, matchTitle, pickHighlight, resolveItem, scrubScore, uid } from './lib/format';
import { countryName, detectRegion, fetchNetworkRegion, flag } from './lib/region';
import { initialPlayback, playbackReducer } from './lib/playback';
import { usePersistentState } from './lib/storage';
import { describeYtError } from './lib/youtube';
import { Logo } from './components/Logo';
import { MatchCard } from './components/MatchCard';
import { Player } from './components/Player';
import { UpNext } from './components/UpNext';
import { Settings } from './components/Settings';

function readQueue(): PlayItem[] {
  try { return JSON.parse(localStorage.getItem('rondo:queue') ?? '[]'); } catch { return []; }
}

function parseHash() {
  const [, code, round] = window.location.hash.match(/^#\/([A-Z0-9]+)(?:\/([\w-]+))?/) ?? [];
  return { code, round };
}

export default function App() {
  const [index, setIndex] = useState<DataIndex | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [compCode, setCompCode] = usePersistentState<string | null>('comp', null);
  const [roundKey, setRoundKey] = useState<string | null>(null);
  const [round, setRound] = useState<RoundFile | null>(null);
  const [pref, setPref] = usePersistentState<Kind>('length', 'short');
  const [spoilerFree, setSpoilerFree] = usePersistentState('spoilerFree', false);
  const [autoplay, setAutoplay] = usePersistentState('autoplay', true);
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

  // ---- data loading ----
  useEffect(() => {
    fetchIndex()
      .then((idx) => {
        setIndex(idx);
        const h = parseHash();
        const comp = idx.competitions.find((c) => c.code === h.code) ?? idx.competitions.find((c) => c.code === compCode) ?? idx.competitions[0];
        if (comp) {
          setCompCode(comp.code);
          setRoundKey(comp.rounds.some((r) => r.key === h.round) && comp.code === h.code ? h.round! : comp.currentRound);
        }
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
    history.replaceState(null, '', `#/${comp.code}/${roundKey}`);
    return () => { stale = true; };
  }, [comp, roundKey]);

  useEffect(() => {
    try { localStorage.setItem('rondo:queue', JSON.stringify(pb.queue)); } catch { /* ignore */ }
  }, [pb.queue]);

  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), 4500);
    return () => clearTimeout(t);
  }, [toast]);

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
  const roundTotal = playable.reduce((t, m) => t + (pickHighlight(m, pins[m.id] ?? pref, [], region, avoid)?.durationSec ?? 0), 0);

  const playFrom = (matchId: number | string, kind?: Kind) => {
    const start = playable.findIndex((m) => m.id === matchId);
    const items = playable.map((m) => toItem(m, m.id === matchId ? kind ?? pins[m.id] : pins[m.id]));
    dispatch({ type: 'playContext', label: `${comp!.name} · ${round!.round.label}`, items, start: Math.max(0, start) });
    requestAnimationFrame(() => stageRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' }));
  };
  const queueMatch = (m: Match, kind?: Kind) => {
    dispatch({ type: 'enqueue', items: [toItem(m, kind)] });
    setToast(`Queued ${matchTitle(m)}`);
  };
  const queueAll = () => {
    dispatch({ type: 'enqueue', items: playable.map((m) => toItem(m, pins[m.id])) });
    setToast(`Queued ${playable.length} matches from ${round!.round.label}`);
  };

  // ---- current video ----
  const current = pb.current;
  const video = current ? resolveItem(current, pref, pb.failed[current.uid], region, avoid) : null;

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
      region={region}
      avoid={avoid}
      spoilerFree={spoilerFree}
      playing={current?.match.id === m.id}
      queued={queuedIds.has(m.id)}
      pinned={pins[m.id]}
      onPin={(k) => setPins((p) => ({ ...p, [m.id]: k }))}
      onPlay={(k) => playFrom(m.id, k)}
      onQueue={(k) => queueMatch(m, k)}
    />
  );

  const roundIdx = comp?.rounds.findIndex((r) => r.key === roundKey) ?? -1;
  const hasUpNext = pb.queue.length > 0 || !!pb.context;

  return (
    <div className="app">
      <header className="topbar">
        <Logo />
        <span className="tagline">Football highlights, back to back</span>
        <div className="prefs">
          <div className="seg" role="radiogroup" aria-label="Preferred highlight length">
            {(['short', 'extended'] as Kind[]).map((k) => (
              <button key={k} role="radio" aria-checked={pref === k} className={pref === k ? 'on' : ''} onClick={() => setPref(k)}>
                {kindLabel(k)}
              </button>
            ))}
          </div>
          <button className={`toggle desktop-only${spoilerFree ? ' on' : ''}`} aria-pressed={spoilerFree} onClick={() => setSpoilerFree(!spoilerFree)}
            title="Hide scores and thumbnails">
            <svg viewBox="0 0 24 24" aria-hidden="true">
              {spoilerFree
                ? <path d="M12 7a5 5 0 0 1 5 5c0 .6-.1 1.3-.4 1.8l2.9 2.9A11.8 11.8 0 0 0 23 12c-1.7-4.4-6-7.5-11-7.5-1.4 0-2.7.3-4 .7l2.2 2.2c.5-.3 1.1-.4 1.8-.4M2 4.3l2.3 2.3.4.4A11.8 11.8 0 0 0 1 12c1.7 4.4 6 7.5 11 7.5 1.5 0 3-.3 4.4-.8l.4.4 2.9 2.9 1.3-1.3L3.3 3zM7.5 9.8 9 11.4v.6a3 3 0 0 0 3 3h.6l1.6 1.6A5 5 0 0 1 7 12c0-.8.2-1.5.5-2.2m4.3-.8 3.2 3.2V12a3 3 0 0 0-3-3z" />
                : <path d="M12 4.5C7 4.5 2.7 7.6 1 12c1.7 4.4 6 7.5 11 7.5s9.3-3.1 11-7.5c-1.7-4.4-6-7.5-11-7.5M12 17a5 5 0 1 1 0-10 5 5 0 0 1 0 10m0-8a3 3 0 1 0 0 6 3 3 0 0 0 0-6" />}
            </svg>
            <span>Spoiler-free</span>
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

      <div className={`layout${current || hasUpNext ? ' with-aside' : ''}`}>
        <main>
          {current && (
            <section className="stage" ref={stageRef} aria-label="Now playing">
              <Player
                videoId={video?.videoId ?? null}
                seq={pb.seq}
                label={matchTitle(current.match)}
                onEnded={onEnded}
                onError={onError}
                onClose={() => dispatch({ type: 'stop' })}
              />
              <div className="now">
                <div className="now-main">
                  <div className="now-kicker">
                    <i className="comp-dot" style={{ background: current.comp.color }} />
                    {current.comp.name} · {current.roundLabel}
                    {video && <span className={`kind-tag ${video.kind}`}>{kindLabel(video.kind)} · {fmtDuration(video.durationSec)}</span>}
                  </div>
                  <h1 className="now-title">{matchTitle(current.match)}</h1>
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

          {index && (
            <section className="browse" aria-label="Browse">
              <nav className="comps" aria-label="Competitions">
                {index.competitions.map((c, i) => (
                  <span key={c.code} className="comp-wrap">
                    {i > 0 && (c.group ?? 'league') !== (index.competitions[i - 1].group ?? 'league') && <span className="comp-sep" aria-hidden="true" />}
                    <button className={`comp${c.code === compCode ? ' on' : ''}`} style={{ '--c': c.color } as React.CSSProperties}
                      aria-pressed={c.code === compCode}
                      onClick={() => { setCompCode(c.code); setRoundKey(c.currentRound); }}>
                      <i className="comp-dot" />{c.short ?? c.name}
                    </button>
                  </span>
                ))}
              </nav>

              {comp && (
                <div className="round-bar">
                  <div className="round-nav">
                    <button className="btn-icon" disabled={roundIdx <= 0} aria-label="Previous round"
                      onClick={() => setRoundKey(comp.rounds[roundIdx - 1].key)}>
                      <svg viewBox="0 0 24 24"><path d="M15.4 7.4 14 6l-6 6 6 6 1.4-1.4-4.6-4.6z" /></svg>
                    </button>
                    <label className="round-select">
                      <span className="sr-only">Round</span>
                      <select value={roundKey ?? ''} onChange={(e) => setRoundKey(e.target.value)}>
                        {comp.rounds.map((r) => (
                          <option key={r.key} value={r.key}>
                            {r.label}{r.withHighlights ? '' : r.matches ? ' · upcoming' : ''}
                          </option>
                        ))}
                      </select>
                    </label>
                    <button className="btn-icon" disabled={roundIdx < 0 || roundIdx >= comp.rounds.length - 1} aria-label="Next round"
                      onClick={() => setRoundKey(comp.rounds[roundIdx + 1].key)}>
                      <svg viewBox="0 0 24 24"><path d="M8.6 16.6 10 18l6-6-6-6-1.4 1.4 4.6 4.6z" /></svg>
                    </button>
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
                  <div className="round-actions">
                    <button className="btn-primary" disabled={!playable.length} onClick={() => playFrom(playable[0].id)}>
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

        {(current || hasUpNext) && (
          <aside className="aside">
            <UpNext state={pb} pref={pref} region={region} avoid={avoid} dispatch={dispatch} />
          </aside>
        )}
      </div>

      <footer className="foot muted">
        <p>
          Showing highlights that play in {region ? `${flag(region)} ${countryName(region)}` : 'your country'}.{' '}
          <button className="linkish inline" onClick={() => setSettingsOpen(true)}>Change</button>
        </p>
        <p>
          Videos are embedded from official YouTube channels; Rondo Highlights hosts no video. Football data provided by the Football-Data.org API.
          {index && ` Updated ${new Date(index.generatedAt).toLocaleString()}.`}
        </p>
      </footer>

      <Settings
        open={settingsOpen} onClose={() => setSettingsOpen(false)}
        pref={pref} setPref={setPref}
        spoilerFree={spoilerFree} setSpoilerFree={setSpoilerFree}
        autoplay={autoplay} setAutoplay={setAutoplay}
        detected={detected} detectedFrom={detectedFrom} override={regionOverride} setOverride={(c) => { setRegionOverride(c); setEmbedErrors(0); }}
      />

      {toast && <div className="toast" role="status">{toast}</div>}
    </div>
  );
}
