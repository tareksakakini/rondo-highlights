import { useCallback, useEffect, useRef, useState } from 'react';
import { isCancelled, loadAccount, type Account, type AccountUser, type Follows } from './account';
import { usePersistentState } from './storage';

const NONE: Follows = { teams: [], comps: [] };

/**
 * Your teams (beta, "★ My teams"). Picking teams needs an account, so it comes first:
 * `withAccount(next)` runs `next` at once when signed in, else opens the sign-in sheet
 * and runs it once the sign-in finishes. The account's teams are also kept in
 * localStorage, so a reload shows them at once while the account loads.
 */
export function useFollows(enabled: boolean) {
  const [account, setAccount] = useState<Account | null>(null);
  const [user, setUser] = useState<AccountUser | null>(null);
  // Known once the first sign-in state has arrived (before that, nobody counts as signed out).
  const [known, setKnown] = useState(false);
  const [cached, setCached] = usePersistentState<Follows & { uid: string | null }>('follows', { ...NONE, uid: null });
  const follows = user && cached.uid === user.uid ? cached : NONE;
  /** The sign-in sheet: open, and whether it was opened on the way to "My teams" (so it can say so). */
  const [sheet, setSheet] = useState<{ forTeams: boolean } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const after = useRef<(() => void) | null>(null);

  useEffect(() => {
    if (!enabled) return;
    let alive = true;
    let off = () => {};
    loadAccount().then((acc) => {
      if (!alive || !acc) return;
      setAccount(acc);
      off = acc.onChange((u) => {
        setUser(u);
        setKnown(true);
        if (!u) return;
        acc.load(u.uid).then((remote) => {
          if (!alive) return;
          setCached({ ...remote, uid: u.uid });
          // Signed in from the sheet: carry on to where the person was going.
          const next = after.current;
          after.current = null;
          if (next) { setSheet(null); next(); }
        }, () => setError("Couldn't load your teams. Check your connection and try again."));
      });
    });
    return () => { alive = false; off(); };
  }, [enabled, setCached]);

  /** Save the account's teams. */
  const setTeams = useCallback((teams: string[]) => {
    if (!account || !user) return;
    const next = { teams, comps: follows.comps };
    setCached({ ...next, uid: user.uid });
    account.save(user.uid, next).catch(() => setError("Couldn't save your teams. Check your connection and try again."));
  }, [account, user, follows.comps, setCached]);

  const withAccount = (next: () => void) => {
    if (!account || !known) return;
    if (user) { next(); return; }
    after.current = next;
    setError(null);
    setSheet({ forTeams: true });
  };

  const signIn = async () => {
    if (!account) return;
    setBusy(true);
    setError(null);
    try { await account.signIn(); }
    catch (e) { if (!isCancelled(e)) setError("Couldn't sign in. Try again in a moment."); }
    finally { setBusy(false); }
  };

  const signOut = async () => {
    if (!account) return;
    await account.signOut();
    setCached({ ...NONE, uid: null });
  };

  return {
    /** False until accounts have loaded (and always when the beta is off or there's no Firebase project). */
    ready: !!account && known,
    user, teams: follows.teams, setTeams, withAccount, signIn, signOut, busy, error,
    sheet,
    openAccount: () => { setError(null); setSheet({ forTeams: false }); },
    closeAccount: () => { after.current = null; setSheet(null); },
  };
}

export type FollowsApi = ReturnType<typeof useFollows>;
