import { useEffect, useRef } from 'react';
import type { Kind } from '../types';
import { allRegions, countryName, flag } from '../lib/region';

interface Props {
  open: boolean;
  onClose: () => void;
  autoplay: boolean;
  setAutoplay: (v: boolean) => void;
  // Phones: these three have no place in the top bar, so the sheet holds every preference.
  pref: Kind;
  setPref: (k: Kind) => void;
  spoilerFree: boolean;
  setSpoilerFree: (v: boolean) => void;
  autoCondense: boolean;
  setAutoCondense: (v: boolean) => void;
  detected: string | null;
  detectedFrom: 'network' | 'timezone' | null;
  override: string;
  setOverride: (code: string) => void;
  /** "★ My teams": who is signed in (null: nobody), and opening the account sheet. */
  account?: { name: string | null; open: () => void };
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

        <div className="setting phone-only">
          <div className="setting-text">
            <span className="setting-name">Highlight length</span>
            <span className="setting-help">Short cuts, or the extended ones.</span>
          </div>
          <div className="seg" role="radiogroup" aria-label="Preferred highlight length">
            {(['short', 'extended'] as Kind[]).map((k) => (
              <button key={k} role="radio" aria-checked={p.pref === k} className={p.pref === k ? 'on' : ''} onClick={() => p.setPref(k)}>{k === 'short' ? 'Short' : 'Extended'}</button>
            ))}
          </div>
        </div>

        <label className="setting phone-only">
          <div className="setting-text">
            <span className="setting-name">Spoiler-free</span>
            <span className="setting-help">Hide scores and thumbnails.</span>
          </div>
          <span className="switch">
            <input type="checkbox" checked={p.spoilerFree} onChange={(e) => p.setSpoilerFree(e.target.checked)} />
            <span className="track"><span className="thumb-dot" /></span>
          </span>
        </label>

        <label className="setting phone-only">
          <div className="setting-text">
            <span className="setting-name">Auto-condense</span>
            <span className="setting-help">When a match has no short cut, play just the key moments of the extended one. It can occasionally skip a goal.</span>
          </div>
          <span className="switch">
            <input type="checkbox" checked={p.autoCondense} onChange={(e) => p.setAutoCondense(e.target.checked)} />
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

        {p.account && (
          <button className="setting setting-btn" onClick={p.account.open}>
            <div className="setting-text">
              <span className="setting-name">Account</span>
              <span className="setting-help">{p.account.name ? `Signed in as ${p.account.name}.` : 'Make an account to pick your teams for "My teams".'}</span>
            </div>
            <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M8.6 16.6 10 18l6-6-6-6-1.4 1.4 4.6 4.6z" /></svg>
          </button>
        )}

        <label className="setting column">
          <div className="setting-text">
            <span className="setting-name">Your country</span>
            <span className="setting-help">
              Highlights are licensed by country, so we only show videos that play in yours.{' '}
              {p.detectedFrom === 'timezone' ? 'We guessed it from your time zone.' : 'We detect it from your connection, as YouTube does.'}{' '}
              Change it if videos won&apos;t play (VPN, travel).
            </span>
          </div>
          <select className="select" value={p.override} onChange={(e) => p.setOverride(e.target.value)}>
            <option value="">Automatic: {detectedLabel}</option>
            {allRegions().map((c) => (
              <option key={c} value={c}>{flag(c)} {countryName(c)}</option>
            ))}
          </select>
        </label>
      </div>
    </div>
  );
}
