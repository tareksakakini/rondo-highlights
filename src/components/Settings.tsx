import { useEffect, useRef } from 'react';
import { allRegions, countryName, flag } from '../lib/region';

interface Props {
  open: boolean;
  onClose: () => void;
  autoplay: boolean;
  setAutoplay: (v: boolean) => void;
  detected: string | null;
  detectedFrom: 'network' | 'timezone' | null;
  override: string;
  setOverride: (code: string) => void;
}

/** Settings sheet: slides up from the bottom on phones, a floating panel on desktop. */
export function Settings(p: Props) {
  const ref = useRef<HTMLDivElement>(null);
  const close = useRef(p.onClose);
  close.current = p.onClose;

  useEffect(() => {
    if (!p.open) return;
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && close.current();
    window.addEventListener('keydown', onKey);
    ref.current?.querySelector<HTMLElement>('button, select')?.focus();
    return () => window.removeEventListener('keydown', onKey);
  }, [p.open]);

  if (!p.open) return null;
  const detectedLabel = p.detected
    ? `${flag(p.detected)} ${countryName(p.detected)}${p.detectedFrom === 'timezone' ? ', from your time zone' : ''}`
    : 'unknown';

  return (
    <div className="sheet-backdrop" onClick={p.onClose}>
      <div className="sheet" role="dialog" aria-modal="true" aria-label="Settings" ref={ref} onClick={(e) => e.stopPropagation()}>
        <div className="sheet-grip" aria-hidden="true" />
        <div className="sheet-head">
          <h2>Settings</h2>
          <button className="btn-icon sm" onClick={p.onClose} aria-label="Close settings">
            <svg viewBox="0 0 24 24"><path d="M18.3 5.7 12 12l6.3 6.3-1.4 1.4L10.6 13.4 4.3 19.7 2.9 18.3 9.2 12 2.9 5.7l1.4-1.4 6.3 6.3 6.3-6.3z" /></svg>
          </button>
        </div>

        <label className="setting">
          <div className="setting-text">
            <span className="setting-name">Autoplay</span>
            <span className="setting-help">Start the next match when one ends.</span>
          </div>
          <span className="switch">
            <input type="checkbox" checked={p.autoplay} onChange={(e) => p.setAutoplay(e.target.checked)} />
            <span className="track"><span className="thumb-dot" /></span>
          </span>
        </label>

        <label className="setting column">
          <div className="setting-text">
            <span className="setting-name">Your country</span>
            <span className="setting-help">Highlights are licensed by country. We detect yours from your internet connection, the same way YouTube does, and only show videos that play there. Change it if videos won&apos;t play.</span>
          </div>
          <select className="select" value={p.override} onChange={(e) => p.setOverride(e.target.value)}>
            <option value="">Automatic ({detectedLabel})</option>
            {allRegions().map((c) => (
              <option key={c} value={c}>{flag(c)} {countryName(c)}</option>
            ))}
          </select>
        </label>
      </div>
    </div>
  );
}
