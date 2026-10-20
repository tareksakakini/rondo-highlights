import { initializeApp, type FirebaseOptions } from 'firebase/app';
import { GoogleAuthProvider, getAuth, onAuthStateChanged, signInWithPopup, signOut, type User } from 'firebase/auth';
import { doc, getDoc, getFirestore, serverTimestamp, setDoc } from 'firebase/firestore/lite';
import type { Account, AccountUser, Follows } from './account';

// Accounts on Firebase: Google sign-in, and one Firestore document per account,
// follows/<uid> = { teams, comps, updated }, which only that account can read or
// write (firestore.rules). The lite Firestore client: plain reads and writes, no live sync.

const toUser = (u: User): AccountUser => ({ uid: u.uid, name: u.displayName ?? '', email: u.email ?? '', photo: u.photoURL });
const list = (v: unknown) => (Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : []);

export function firebaseAccount(config: FirebaseOptions): Account {
  const app = initializeApp(config);
  const auth = getAuth(app);
  const db = getFirestore(app);
  const ref = (uid: string) => doc(db, 'follows', uid);
  return {
    onChange: (cb) => onAuthStateChanged(auth, (u) => cb(u ? toUser(u) : null)),
    signIn: async () => toUser((await signInWithPopup(auth, new GoogleAuthProvider())).user),
    signOut: () => signOut(auth),
    async load(uid) {
      const data = (await getDoc(ref(uid))).data();
      return { teams: list(data?.teams), comps: list(data?.comps) };
    },
    async save(uid, f: Follows) {
      await setDoc(ref(uid), { teams: f.teams, comps: f.comps, updated: serverTimestamp() });
    },
  };
}
