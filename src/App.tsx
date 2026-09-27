import { useCallback, useEffect, useMemo, useReducer, useRef, useState } from 'react';
import type { Competition, DataIndex, Kind, Match, PlayItem, RoundFile } from './types';
import { fetchIndex, fetchRound } from './lib/data';
import { fmtDay, fmtDuration, fmtTotal, kindLabel, matchTitle, pickHighlight, resolveItem, scrubScore, uid } from './lib/format';
import { initialPlayback, playbackReducer } from './lib/playback';
import { usePersistentState } from './lib/storage';
import { describeYtError } from './lib/youtube';
import { Logo } from './components/Logo';
import { MatchCard } from './components/MatchCard';
import { Player } from './components/Player';
import { UpNext } from './components/UpNext';

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
  const [pins, setPins] = useState<Record<number, Kind>>({});
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
  const playable = useMemo(() => round?.matches.filter((m) => m.highlights.length) ?? [], [round]);
  const roundTotal = playable.reduce((t, m) => t + (pickHighlight(m, pref)?.durationSec ?? 0), 0);

  const playFrom = (matchId: number, kind?: Kind) => {
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
  const video = current ? resolveItem(current, pref, pb.failed[current.uid]) : null;

  useEffect(() => {
    if (current && !video) {
      setToast(`Skipped ${matchTitle(current.match)} — no playable video`);
      dispatch({ type: 'next' });
    }
  }, [current, video]);

  useEffect(() => setRevealTitle(false), [current?.uid]);

  const onEnded = useCallback(() => { if (autoplay) dispatch({ type: 'next' }); }, [autoplay]);
  const onError = useCallback(
    (code: number) => {
      if (!video) return;
      setToast(`${video.channel}: ${describeYtError(code)} — trying another cut`);
      dispatch({ type: 'failed', videoId: video.videoId });
    },
    [video],
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

  const roundIdx = comp?.rounds.findIndex((r) => r.key === roundKey) ?? -1;
  const queuedIds = new Set(pb.queue.map((q) => q.match.id));
  const hasUpNext = pb.queue.length > 0 || !!pb.context;

  return (
    <div className="app">
      <header className="topbar">
        <Logo />
        <span className="tagline">European football highlights, back to back</span>
        <div className="prefs">
          <div className="seg" role="radiogroup" aria-label="Preferred highlight length">
            {(['short', 'extended'] as Kind[]).map((k) => (
              <button key={k} role="radio" aria-checked={pref === k} className={pref === k ? 'on' : ''} onClick={() => setPref(k)}>
                {kindLabel(k)}
              </button>
            ))}
          </div>
          <button className={`toggle${spoilerFree ? ' on' : ''}`} aria-pressed={spoilerFree} onClick={() => setSpoilerFree(!spoilerFree)}
            title="Hide scores and thumbnails">
            <svg viewBox="0 0 24 24" aria-hidden="true">
              {spoilerFree
                ? <path d="M12 7a5 5 0 0 1 5 5c0 .6-.1 1.3-.4 1.8l2.9 2.9A11.8 11.8 0 0 0 23 12c-1.7-4.4-6-7.5-11-7.5-1.4 0-2.7.3-4 .7l2.2 2.2c.5-.3 1.1-.4 1.8-.4M2 4.3l2.3 2.3.4.4A11.8 11.8 0 0 0 1 12c1.7 4.4 6 7.5 11 7.5 1.5 0 3-.3 4.4-.8l.4.4 2.9 2.9 1.3-1.3L3.3 3zM7.5 9.8 9 11.4v.6a3 3 0 0 0 3 3h.6l1.6 1.6A5 5 0 0 1 7 12c0-.8.2-1.5.5-2.2m4.3-.8 3.2 3.2V12a3 3 0 0 0-3-3z" />
                : <path d="M12 4.5C7 4.5 2.7 7.6 1 12c1.7 4.4 6 7.5 11 7.5s9.3-3.1 11-7.5c-1.7-4.4-6-7.5-11-7.5M12 17a5 5 0 1 1 0-10 5 5 0 0 1 0 10m0-8a3 3 0 1 0 0 6 3 3 0 0 0 0-6" />}
            </svg>
            <span>Spoiler-free</span>
          </button>
        </div>
      </header>

      {index?.source === 'sample' && (
        <div className="notice">
          Showing a sample snapshot. Run <code>npm run ingest</code> with your API keys to load live fixtures and highlights for all six competitions.
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
                {index.competitions.map((c) => (
                  <button key={c.code} className={`comp${c.code === compCode ? ' on' : ''}`} style={{ '--c': c.color } as React.CSSProperties}
                    onClick={() => { setCompCode(c.code); setRoundKey(c.currentRound); }}>
                    <i className="comp-dot" />{c.name}
                  </button>
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
                    {round && round.matches.length > 0 && (
                      <span className="round-dates muted">
                        {fmtDay(round.matches[0].utcDate)} – {fmtDay(round.matches[round.matches.length - 1].utcDate)}
                      </span>
                    )}
                  </div>
                  <div className="round-actions">
                    {round && <span className="muted">{playable.length}/{round.matches.length} with highlights{roundTotal ? ` · ${fmtTotal(roundTotal)}` : ''}</span>}
                    <button className="btn-primary" disabled={!playable.length} onClick={() => playFrom(playable[0].id)}>
                      <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M8 5v14l11-7z" /></svg>
                      Play all
                    </button>
                    <button className="btn-ghost" disabled={!playable.length} onClick={queueAll}>+ Queue all</button>
                  </div>
                </div>
              )}

              <div className="grid">
                {!round && comp && Array.from({ length: 6 }, (_, i) => <div key={i} className="card skeleton" />)}
                {round?.matches.map((m) => (
                  <MatchCard
                    key={m.id}
                    match={m}
                    pref={pref}
                    spoilerFree={spoilerFree}
                    playing={current?.match.id === m.id}
                    queued={queuedIds.has(m.id)}
                    pinned={pins[m.id]}
                    onPin={(k) => setPins((p) => ({ ...p, [m.id]: k }))}
                    onPlay={(k) => playFrom(m.id, k)}
                    onQueue={(k) => queueMatch(m, k)}
                  />
                ))}
              </div>
            </section>
          )}
        </main>

        {(current || hasUpNext) && (
          <aside className="aside">
            <UpNext state={pb} pref={pref} dispatch={dispatch} />
          </aside>
        )}
      </div>

      <footer className="foot muted">
        Videos are embedded from their official YouTube channels; Rondo Highlights hosts no video. Football data provided by the Football-Data.org API.
        {index && ` Data updated ${new Date(index.generatedAt).toLocaleString()}.`}
      </footer>

      {toast && <div className="toast" role="status">{toast}</div>}
    </div>
  );
}
