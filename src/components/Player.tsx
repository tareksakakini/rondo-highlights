import { useEffect, useRef, useState } from 'react';
import { loadYouTubeApi, type YTPlayer } from '../lib/youtube';
import { FADE_IN_MS, FADE_OUT_MS, LEAD_SEC, momentAt, type Moment } from '../lib/moments';

const PLAYING = 1;

interface Props {
  videoId: string | null;
  /** changes whenever playback (re)starts, so the same video can be replayed */
  seq: number;
  label: string;
  /** Condensed cut: play only these [start, end] ranges, in order (experimental). */
  moments?: Moment[] | null;
  /** Which moment is playing; null when the video plays in full (no moments, or the viewer scrubbed away). */
  onMoment?: (index: number | null) => void;
  onEnded: () => void;
  onError: (code: number) => void;
  onClose: () => void;
}

interface Run {
  moments: Moment[] | null;
  idx: number;
  /** the viewer scrubbed outside the moments: stop steering and play the video as is */
  free: boolean;
  /** a jump between moments is in progress */
  busy: boolean;
  lastT: number;
  /** ignore time jumps until then (our own seeks, video start) */
  settleUntil: number;
  /** volume to restore if a fade is interrupted */
  base: number | null;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * YouTube IFrame player with a "mini player" mode: when the page scrolls the
 * player out of view it docks (bottom-right on desktop, top on phones) so it
 * stays visible — YouTube's embed policy requires the player to be visible
 * (>= 50%, >= 200x200) before we auto-play the next video.
 *
 * With `moments`, it plays a condensed cut: it starts at the first moment, and as
 * each one ends it fades the sound out, seeks to the next and fades back in. If the
 * viewer scrubs to somewhere between moments, it stops steering for that video.
 */
export function Player({ videoId, seq, label, moments = null, onMoment, onEnded, onError, onClose }: Props) {
  const slotRef = useRef<HTMLDivElement>(null);
  const hostRef = useRef<HTMLDivElement>(null);
  const player = useRef<YTPlayer | null>(null);
  const ready = useRef(false);
  const pending = useRef<{ id: string | null; moments: Moment[] | null }>({ id: videoId, moments });
  const cb = useRef({ onEnded, onError, onMoment });
  cb.current = { onEnded, onError, onMoment };
  const gen = useRef(0);
  const run = useRef<Run>({ moments: null, idx: 0, free: false, busy: false, lastT: 0, settleUntil: 0, base: null });
  const [mini, setMini] = useState(false);
  const [apiError, setApiError] = useState<string | null>(null);

  const load = () => {
    const p = player.current;
    const { id, moments: m } = pending.current;
    if (!p || !ready.current) return;
    gen.current++;
    const r = run.current;
    if (r.base != null) { p.setVolume(r.base); r.base = null; }
    if (!id) { p.pauseVideo(); return; }
    const steer = m?.length ? m : null;
    run.current = { moments: steer, idx: 0, free: false, busy: false, lastT: steer ? steer[0][0] : 0, settleUntil: performance.now() + 4000, base: null };
    p.loadVideoById(steer ? { videoId: id, startSeconds: steer[0][0] } : id);
    cb.current.onMoment?.(steer ? 0 : null);
  };

  // Create the player once.
  useEffect(() => {
    let cancelled = false;
    loadYouTubeApi()
      .then((YT) => {
        if (cancelled || !hostRef.current) return;
        // Mount into a fresh child: the API replaces its target element with an iframe.
        const target = document.createElement('div');
        hostRef.current.replaceChildren(target);
        player.current = new YT.Player(target, {
          width: '100%',
          height: '100%',
          playerVars: { autoplay: 1, rel: 0, playsinline: 1, modestbranding: 1, origin: window.location.origin },
          events: {
            onReady: () => {
              ready.current = true;
              load();
            },
            onStateChange: (e: { data: number }) => { if (e.data === YT.PlayerState.ENDED) cb.current.onEnded(); },
            onError: (e: { data: number }) => cb.current.onError(e.data),
          },
        });
      })
      .catch((e: Error) => setApiError(e.message));
    return () => {
      cancelled = true;
      player.current?.destroy();
      player.current = null;
      hostRef.current?.replaceChildren();
      ready.current = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Load a new video whenever the item changes.
  const momentsKey = moments ? JSON.stringify(moments) : '';
  useEffect(() => {
    pending.current = { id: videoId, moments };
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [videoId, seq, momentsKey]);

  // Condensed cuts: watch the clock and move from one moment to the next.
  useEffect(() => {
    const ramp = async (from: number, to: number, ms: number, g: number) => {
      const steps = Math.max(1, Math.round(ms / 50));
      for (let i = 1; i <= steps; i++) {
        if (g !== gen.current) return false;
        player.current?.setVolume(Math.round(from + ((to - from) * i) / steps));
        await sleep(ms / steps);
      }
      return g === gen.current;
    };

    const jump = async (next: number | null) => {
      const p = player.current;
      const r = run.current;
      const m = r.moments;
      if (!p || !m) return;
      const g = gen.current;
      r.busy = true;
      const fade = !p.isMuted();
      const base = p.getVolume();
      r.base = base;
      if (fade && !(await ramp(base, 0, FADE_OUT_MS, g))) return;
      if (next === null) {
        // Last moment done: that's the end of this highlight.
        p.pauseVideo();
        p.setVolume(base);
        run.current = { ...r, free: true, busy: false, base: null };
        cb.current.onEnded();
        return;
      }
      r.idx = next;
      r.lastT = m[next][0];
      r.settleUntil = performance.now() + 3000;
      p.seekTo(m[next][0], true);
      cb.current.onMoment?.(next);
      await sleep(150); // the state reads PLAYING straight after a seek, before buffering starts
      for (let i = 0; i < 30 && g === gen.current && p.getPlayerState() !== PLAYING; i++) await sleep(100);
      if (fade && !(await ramp(0, base, FADE_IN_MS, g))) return;
      p.setVolume(base);
      r.base = null;
      r.busy = false;
    };

    const timer = setInterval(() => {
      const p = player.current;
      const r = run.current;
      const m = r.moments;
      if (!p || !ready.current || !m || r.free || r.busy) return;
      if (p.getPlayerState() !== PLAYING) return;
      const t = p.getCurrentTime();
      const now = performance.now();
      if (now < r.settleUntil) {
        // Just started or just jumped: make sure we're inside the moment (a start time can be ignored).
        if (t < m[r.idx][0] - 2) p.seekTo(m[r.idx][0], true);
        r.lastT = t;
        return;
      }
      if (Math.abs(t - r.lastT) > 2.5) {
        // The viewer scrubbed. Inside a moment: carry on from there. Between moments: let them watch.
        const i = momentAt(m, t);
        if (i < 0) {
          r.free = true;
          cb.current.onMoment?.(null);
          return;
        }
        if (i !== r.idx) { r.idx = i; cb.current.onMoment?.(i); }
      }
      r.lastT = t;
      if (t >= m[r.idx][1] - LEAD_SEC) void jump(r.idx + 1 < m.length ? r.idx + 1 : null);
    }, 200);
    return () => clearInterval(timer);
  }, []);

  // Dock into a mini player when scrolled out of view.
  useEffect(() => {
    const el = slotRef.current;
    if (!el) return;
    const io = new IntersectionObserver(([e]) => setMini(e.intersectionRatio < 0.5), { threshold: [0, 0.5, 1] });
    io.observe(el);
    return () => io.disconnect();
  }, []);

  return (
    <div className="player-slot" ref={slotRef}>
      <div className={`player-shell${mini ? ' mini' : ''}`}>
        {mini && (
          <div className="mini-bar">
            <span className="mini-title">{label}</span>
            <button className="btn-ghost sm" onClick={() => slotRef.current?.scrollIntoView({ behavior: 'smooth', block: 'center' })}
              aria-label="Back to full player">Expand</button>
            <button className="btn-ghost sm" onClick={onClose} aria-label="Stop and close player">✕</button>
          </div>
        )}
        <div className="player-frame">
          <div className="player-host" ref={hostRef} />
          {apiError && <div className="player-error">{apiError}. Check your connection or ad-blocker.</div>}
        </div>
      </div>
    </div>
  );
}
