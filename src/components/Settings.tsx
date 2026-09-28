import { useEffect, useRef } from 'react';
import type { Kind } from '../types';
import { allRegions, countryName, flag } from '../lib/region';
import { kindLabel } from '../lib/format';

interface Props {
  open: boolean;
  onClose: () => void;
  pref: Kind;
  setPref: (k: Kind) => void;
  spoilerFree: boolean;
  setSpoilerFree: (v: boolean) => void;
  autoplay: boolean;
  setAutoplay: (v: boolean) => void;
  detected: string | null;
  override: string;
  setOverride: (code: string) => void;
}

/** Settings sheet: slides up from the bottom on phones, a floating panel on desktop. */
export function Settings(p: Props) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!p.open) return;
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && p.onClose();
    window.addEventListener('keydown', onKey);
    ref.current?.querySelector<HTMLElement>('button, select')?.focus();
    return () => window.removeEventListener('keydown', onKey);
  }, [p.open, p]);

  if (!p.open) return null;
  const detectedLabel = p.detected ? `${flag(p.detected)} ${countryName(p.detected)}` : 'unknown';

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

        <div className="setting">
          <div className="setting-text">
            <span className="setting-name">Highlight length</span>
            <span className="setting-help">Used for every match unless you pick a cut on the match itself.</span>
          </div>
          <div className="seg" role="radiogroup" aria-label="Preferred highlight length">
            {(['short', 'extended'] as Kind[]).map((k) => (
              <button key={k} role="radio" aria-checked={p.pref === k} className={p.pref === k ? 'on' : ''} onClick={() => p.setPref(k)}>
                {kindLabel(k)}
              </button>
            ))}
          </div>
        </div>

        <label className="setting">
          <div className="setting-text">
            <span className="setting-name">Spoiler-free</span>
            <span className="setting-help">Hide scores, thumbnails and scorelines in titles.</span>
          </div>
          <span className="switch">
            <input type="checkbox" checked={p.spoilerFree} onChange={(e) => p.setSpoilerFree(e.target.checked)} />
            <span className="track"><span className="thumb-dot" /></span>
          </span>
        </label>

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
            <span className="setting-help">Highlights are licensed by country. We only show videos that play where you are.</span>
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
