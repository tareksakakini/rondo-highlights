import { useEffect, useRef } from 'react';
import type { FollowsApi } from '../lib/follows';

/**
 * The account sheet (beta): signed out, why to make an account and the Google button
 * (shown first when "★ My teams" is opened); signed in, who you are, your teams and
 * Sign out. Same sheet as Settings.
 */
export function AccountSheet({ f, onEditTeams }: { f: FollowsApi; onEditTeams: () => void }) {
  const ref = useRef<HTMLDivElement>(null);
  const close = useRef(f.closeAccount);
  close.current = f.closeAccount;
  const open = !!f.sheet;

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && close.current();
    window.addEventListener('keydown', onKey);
    ref.current?.querySelector<HTMLElement>('.btn-google, .sheet-head button')?.focus();
    return () => window.removeEventListener('keydown', onKey);
  }, [open, !!f.user]);

  if (!f.sheet) return null;

  return (
    <div className="sheet-backdrop" onClick={f.closeAccount}>
      <div className="sheet account" role="dialog" aria-modal="true" aria-label="Account" ref={ref} onClick={(e) => e.stopPropagation()}>
        <div className="sheet-grip" aria-hidden="true" />
        <div className="sheet-head">
          <h2>{f.user ? 'Your account' : 'Pick your teams'} <span className="beta-tag">Beta</span></h2>
          <button className="btn-icon sm" onClick={f.closeAccount} aria-label="Close">
            <svg viewBox="0 0 24 24"><path d="M18.3 5.7 12 12l6.3 6.3-1.4 1.4L10.6 13.4 4.3 19.7 2.9 18.3 9.2 12 2.9 5.7l1.4-1.4 6.3 6.3 6.3-6.3z" /></svg>
          </button>
        </div>

        {!f.user ? (
          <div className="acct-pitch">
            <p>Make a free account, then pick your teams. You get a digest of their highlights from every league and cup, weekend by weekend, on any device.</p>
            <button className="btn-google" onClick={f.signIn} disabled={f.busy}>
              <svg viewBox="0 0 24 24" aria-hidden="true">
                <path fill="#4285F4" d="M23.5 12.3c0-.8-.1-1.6-.2-2.3H12v4.5h6.5a5.6 5.6 0 0 1-2.4 3.6v3h3.9c2.3-2.1 3.5-5.2 3.5-8.8" />
                <path fill="#34A853" d="M12 24c3.2 0 6-1.1 8-2.9l-3.9-3c-1.1.7-2.5 1.2-4.1 1.2-3.1 0-5.8-2.1-6.7-5H1.3v3.1A12 12 0 0 0 12 24" />
                <path fill="#FBBC05" d="M5.3 14.3a7.2 7.2 0 0 1 0-4.6V6.6h-4a12 12 0 0 0 0 10.8z" />
                <path fill="#EA4335" d="M12 4.8c1.8 0 3.3.6 4.6 1.8l3.4-3.4A12 12 0 0 0 1.3 6.6l4 3.1c.9-2.8 3.6-4.9 6.7-4.9" />
              </svg>
              {f.busy ? 'Signing in…' : 'Continue with Google'}
            </button>
            {f.error && <p className="acct-error" role="alert">{f.error}</p>}
            <p className="acct-fine">Already have an account? The same button signs you in. We keep your name, email and your teams, nothing else.</p>
          </div>
        ) : (
          <>
            <div className="acct-user">
              {f.user.photo ? <img src={f.user.photo} alt="" width={36} height={36} referrerPolicy="no-referrer" /> : <span className="acct-avatar" aria-hidden="true">{(f.user.name || f.user.email).slice(0, 1).toUpperCase()}</span>}
              <div className="setting-text">
                <span className="setting-name">{f.user.name || f.user.email}</span>
                {f.user.name && <span className="setting-help">{f.user.email}</span>}
              </div>
              <button className="btn-ghost sm" onClick={f.signOut}>Sign out</button>
            </div>
            {f.error && <p className="acct-error" role="alert">{f.error}</p>}
            <button className="setting setting-btn" onClick={() => { f.closeAccount(); onEditTeams(); }}>
              <div className="setting-text">
                <span className="setting-name">Your teams</span>
                <span className="setting-help">{f.teams.length ? `${f.teams.length} ${f.teams.length === 1 ? 'team' : 'teams'}: ${f.teams.slice(0, 3).join(', ')}${f.teams.length > 3 ? '…' : ''}` : 'None yet. Pick some.'}</span>
              </div>
              <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M8.6 16.6 10 18l6-6-6-6-1.4 1.4 4.6 4.6z" /></svg>
            </button>
          </>
        )}
      </div>
    </div>
  );
}
