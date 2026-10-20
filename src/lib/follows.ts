import { useCallback, useEffect, useRef, useState } from 'react';
import { accountsAvailable, isCancelled, loadAccount, type Account, type AccountUser, type Follows } from './account';
import { usePersistentState } from './storage';

const NONE: Follows = { teams: [], comps: [] };

/**
 * Your teams ("★ My teams"). Picking teams needs an account, so it comes first:
 * `withAccount(next)` runs `next` at once when signed in, else opens the sign-in sheet
 * and runs it once the sign-in finishes. The account's teams are also kept in
 * localStorage, so a reload shows them at once while the account loads.
 *
 * Firebase (~55 KB) only loads when it's needed: on the way to "My teams" or the account
 * sheet (`start`), or, for a browser that has signed in before, once the page is idle.
 */
export function useFollows() {
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
  // For callers waiting on `start`: state updates land after its promise resolves.
  const accountRef = useRef<Account | null>(null);
  const userRef = useRef<AccountUser | null>(null);
  const started = useRef<Promise<void> | null>(null);

  /** Load accounts (once); resolves when the first sign-in state is known. */
  const start = useCallback(() => {
    if (!accountsAvailable) return Promise.resolve();
    started.current ??= new Promise<void>((resolve) => {
      loadAccount().then((acc) => {
        if (!acc) { resolve(); return; }
        accountRef.current = acc;
        setAccount(acc);
        acc.onChange((u) => {
          userRef.current = u;
          setUser(u);
          setKnown(true);
          resolve();
          if (!u) return;
          acc.load(u.uid).then((remote) => {
            setCached({ ...remote, uid: u.uid });
            // Signed in from the sheet: carry on to where the person was going.
            const next = after.current;
            after.current = null;
            if (next) { setSheet(null); next(); }
          }, () => setError("Couldn't load your teams. Check your connection and try again."));
        });
      }, () => { started.current = null; resolve(); });
    });
    return started.current;
  }, [setCached]);

  // Signed in on an earlier visit: refresh the account's teams once the page is idle.
  const signedInBefore = !!cached.uid;
  useEffect(() => {
    if (!signedInBefore) return;
    if (window.requestIdleCallback) {
      const id = window.requestIdleCallback(() => { start(); }, { timeout: 5000 });
      return () => window.cancelIdleCallback(id);
    }
    const id = setTimeout(start, 3000);
    return () => clearTimeout(id);
  }, [signedInBefore, start]);

  /** Save the account's teams. */
  const setTeams = useCallback((teams: string[]) => {
    if (!account || !user) return;
    const next = { teams, comps: follows.comps };
    setCached({ ...next, uid: user.uid });
    account.save(user.uid, next).catch(() => setError("Couldn't save your teams. Check your connection and try again."));
  }, [account, user, follows.comps, setCached]);

  const withAccount = (next: () => void) => {
    start().then(() => {
      if (!accountRef.current) return;
      if (userRef.current) { next(); return; }
      after.current = next;
      setError(null);
      setSheet({ forTeams: true });
    });
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
    /** False until accounts have loaded and the sign-in state is known (always, when the build has no accounts). */
    ready: !!account && known,
    start, user, teams: follows.teams, setTeams, withAccount, signIn, signOut, busy, error,
    sheet,
    openAccount: () => { start().then(() => { if (accountRef.current) { setError(null); setSheet({ forTeams: false }); } }); },
    closeAccount: () => { after.current = null; setSheet(null); },
  };
}

export type FollowsApi = ReturnType<typeof useFollows>;
