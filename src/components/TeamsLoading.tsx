import { LoadingMark } from './Logo';

/**
 * While "★ My teams" loads (its chunk, the account, your teams' matches): the startup
 * wheel. Out of the My teams chunk, so it shows while that loads too.
 */
export const TeamsLoading = ({ tabs }: { tabs: React.ReactNode }) => (
  <section className="browse digest" aria-label="My teams" aria-busy="true">
    {tabs}
    <div className="digest-loading"><LoadingMark label="Loading your teams" /></div>
  </section>
);
