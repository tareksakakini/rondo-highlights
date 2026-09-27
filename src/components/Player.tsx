import { useEffect, useRef, useState } from 'react';
import { loadYouTubeApi, type YTPlayer } from '../lib/youtube';

interface Props {
  videoId: string | null;
  /** changes whenever playback (re)starts, so the same video can be replayed */
  seq: number;
  label: string;
  onEnded: () => void;
  onError: (code: number) => void;
  onClose: () => void;
}

/**
 * YouTube IFrame player with a "mini player" mode: when the page scrolls the
 * player out of view it docks (bottom-right on desktop, top on phones) so it
 * stays visible — YouTube's embed policy requires the player to be visible
 * (>= 50%, >= 200x200) before we auto-play the next video.
 */
export function Player({ videoId, seq, label, onEnded, onError, onClose }: Props) {
  const slotRef = useRef<HTMLDivElement>(null);
  const hostRef = useRef<HTMLDivElement>(null);
  const player = useRef<YTPlayer | null>(null);
  const ready = useRef(false);
  const pending = useRef<string | null>(videoId);
  const cb = useRef({ onEnded, onError });
  cb.current = { onEnded, onError };
  const [mini, setMini] = useState(false);
  const [apiError, setApiError] = useState<string | null>(null);

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
              if (pending.current) player.current?.loadVideoById(pending.current);
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
  }, []);

  // Load a new video whenever the item changes.
  useEffect(() => {
    pending.current = videoId;
    if (videoId && ready.current) player.current?.loadVideoById(videoId);
    if (!videoId && ready.current) player.current?.pauseVideo();
  }, [videoId, seq]);

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
