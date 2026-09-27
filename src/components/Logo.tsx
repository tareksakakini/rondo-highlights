/** Rondo mark: five players in a passing circle around a play button. */
export function LogoMark({ size = 32 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 48 48" fill="none" aria-hidden="true">
      <circle cx="24" cy="24" r="18" stroke="var(--accent)" strokeWidth="3" strokeLinecap="round"
        strokeDasharray="14.62 8" strokeDashoffset="1.66" />
      <g fill="var(--text)">
        <circle cx="24" cy="6" r="2.8" />
        <circle cx="41.12" cy="18.44" r="2.8" />
        <circle cx="34.58" cy="38.56" r="2.8" />
        <circle cx="13.42" cy="38.56" r="2.8" />
        <circle cx="6.88" cy="18.44" r="2.8" />
      </g>
      <path d="M20.5 17.5 L31 24 L20.5 30.5 Z" fill="var(--accent)" stroke="var(--accent)" strokeWidth="2.5" strokeLinejoin="round" />
    </svg>
  );
}

export function Logo() {
  return (
    <a className="logo" href="./" aria-label="Rondo Highlights home">
      <LogoMark />
      <span className="wordmark">rondo<span className="wordmark-sub">highlights</span></span>
    </a>
  );
}
