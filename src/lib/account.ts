import { firebaseConfig } from './firebase-config';

// Accounts, for following teams and leagues (beta). Firebase (src/lib/account-firebase.ts)
// is its own chunk, loaded only in browsers that opted into the beta.

export interface AccountUser {
  uid: string;
  name: string;
  email: string;
  photo: string | null;
}

/** What an account follows: teams by full name ("Arsenal FC"), competitions by code ("PL"). */
export interface Follows {
  teams: string[];
  comps: string[];
}

export interface Account {
  /** Called now with the signed-in user (or null) and again on every sign-in and sign-out. */
  onChange(cb: (user: AccountUser | null) => void): () => void;
  /** Signing in for the first time creates the account. Call it straight from a click (it opens a popup). */
  signIn(): Promise<AccountUser>;
  signOut(): Promise<void>;
  load(uid: string): Promise<Follows>;
  save(uid: string, follows: Follows): Promise<void>;
}

/** The person closed the sign-in popup: not an error worth showing. */
export const isCancelled = (e: unknown) =>
  /popup-closed-by-user|cancelled-popup-request/.test(String((e as { code?: string })?.code ?? ''));

/** Firebase when it's configured; a local test account in `npm run dev` when it isn't; else none. */
export async function loadAccount(): Promise<Account | null> {
  if (firebaseConfig.apiKey) return (await import('./account-firebase')).firebaseAccount(firebaseConfig);
  return import.meta.env.DEV ? devAccount() : null;
}

/** `npm run dev` without a Firebase project: one test account, kept in localStorage. */
function devAccount(): Account {
  const USER = 'rondo:devAccount';
  const FOLLOWS = 'rondo:devFollows';
  const listeners = new Set<(u: AccountUser | null) => void>();
  const read = <T>(key: string): T | null => { try { return JSON.parse(localStorage.getItem(key) ?? 'null'); } catch { return null; } };
  const emit = () => listeners.forEach((cb) => cb(read<AccountUser>(USER)));
  return {
    onChange(cb) { listeners.add(cb); cb(read<AccountUser>(USER)); return () => listeners.delete(cb); },
    async signIn() {
      const user: AccountUser = { uid: 'dev', name: 'Test Account', email: 'test@localhost', photo: null };
      localStorage.setItem(USER, JSON.stringify(user));
      emit();
      return user;
    },
    async signOut() { localStorage.removeItem(USER); emit(); },
    async load() { return read<Follows>(FOLLOWS) ?? { teams: [], comps: [] }; },
    async save(_uid, follows) { localStorage.setItem(FOLLOWS, JSON.stringify(follows)); },
  };
}
