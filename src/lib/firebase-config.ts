// The Firebase project that holds accounts and follows (beta, see src/lib/beta.ts).
// A web app's Firebase config is public by design: what each account may read and
// write is decided by firestore.rules, not by keeping these secret.
// Empty apiKey: accounts are off in production builds, and `npm run dev` signs in a local test account.
export const firebaseConfig = {
  apiKey: 'AIzaSyCC48S2ElaUA0m7pK-yxSBdkJqzxSyrvGg',
  authDomain: 'rondo-highlights.firebaseapp.com',
  projectId: 'rondo-highlights',
  appId: '1:714435767554:web:488515a71819011a59e61b',
};
