/**
 * Rondo mark: one pass going round the circle, the ball at its end, around a play button.
 * The same shapes are in public/logo.svg (favicon), the app icons and the share card.
 */
const ARC = 'M39.59 15A18 18 0 1 1 11.96 10.62';
const PLAY = 'M19.5 16.5 32 24 19.5 31.5Z';

export function LogoMark({ size = 32 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 48 48" fill="none" aria-hidden="true">
      <path d={ARC} fill="none" stroke="var(--text)" strokeWidth="3.6" strokeLinecap="round" />
      <circle cx="32.45" cy="8.11" r="4.6" fill="var(--accent)" />
      <path d={PLAY} fill="var(--accent)" stroke="var(--accent)" strokeWidth="3" strokeLinejoin="round" />
    </svg>
  );
}

export function Logo() {
  return (
    <a className="logo" href="/" aria-label="Rondo Highlights home">
      <LogoMark />
      <span className="wordmark">rondo<span className="wordmark-sub">highlights</span></span>
    </a>
  );
}
