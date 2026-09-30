// Minimal typings + loader for the YouTube IFrame Player API.
// https://developers.google.com/youtube/iframe_api_reference

export interface YTPlayer {
  loadVideoById(id: string | { videoId: string; startSeconds?: number }): void;
  cueVideoById(id: string): void;
  playVideo(): void;
  pauseVideo(): void;
  seekTo(seconds: number, allowSeekAhead: boolean): void;
  getCurrentTime(): number;
  getVolume(): number;
  setVolume(volume: number): void;
  isMuted(): boolean;
  getPlayerState(): number;
  destroy(): void;
}

interface YTNamespace {
  Player: new (el: HTMLElement, opts: Record<string, unknown>) => YTPlayer;
  PlayerState: { ENDED: 0; PLAYING: 1; PAUSED: 2; BUFFERING: 3; CUED: 5 };
}

declare global {
  interface Window {
    YT?: YTNamespace;
    onYouTubeIframeAPIReady?: () => void;
  }
}

let loading: Promise<YTNamespace> | null = null;

export function loadYouTubeApi(): Promise<YTNamespace> {
  if (window.YT?.Player) return Promise.resolve(window.YT);
  if (loading) return loading;
  loading = new Promise((resolve, reject) => {
    const prev = window.onYouTubeIframeAPIReady;
    window.onYouTubeIframeAPIReady = () => {
      prev?.();
      resolve(window.YT!);
    };
    const s = document.createElement('script');
    s.src = 'https://www.youtube.com/iframe_api';
    s.async = true;
    s.onerror = () => { loading = null; reject(new Error('Could not load the YouTube player')); };
    document.head.appendChild(s);
  });
  return loading;
}

/** Player error codes -> human text. 101/150 = owner disabled embedding. */
export function describeYtError(code: number) {
  switch (code) {
    case 2: return 'invalid video id';
    case 5: return 'HTML5 player error';
    case 100: return 'video removed or private';
    case 101:
    case 150: return 'embedding disabled by the channel';
    default: return `player error ${code}`;
  }
}
