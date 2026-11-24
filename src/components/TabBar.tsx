import { TAB_ICONS } from '../lib/tab-icons';

export type Tab = 'matches' | 'teams' | 'queue';

const Icon = ({ d }: { d: string }) => <svg viewBox="0 0 24 24" aria-hidden="true"><path d={d} /></svg>;

/** A plain click runs `go`; modified clicks (new tab etc.) follow the link. */
function nav(e: React.MouseEvent, go: () => void) {
  if (e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
  e.preventDefault();
  go();
}

/**
 * Phones: the site's navigation, along the bottom of the screen where a thumb reaches it.
 * Matches (the competitions and their rounds), My teams, Up next (what's playing and the
 * queue, with how many are queued) and Settings. Wide screens don't show it (styles.css).
 */
export function TabBar({ active, matchesHref, teamsHref, queued, playing, onMatches, onTeams, onQueue, onSettings }: {
  active: Tab;
  matchesHref: string;
  /** null: this build has no accounts, so no "My teams". */
  teamsHref: string | null;
  queued: number;
  playing: boolean;
  onMatches: () => void;
  onTeams: () => void;
  onQueue: () => void;
  onSettings: () => void;
}) {
  return (
    <nav className="tabbar" aria-label="Main">
      <a href={matchesHref} className="tab" aria-current={active === 'matches' ? 'page' : undefined} onClick={(e) => nav(e, onMatches)}>
        <Icon d={TAB_ICONS.matches} />
        <span>Matches</span>
      </a>
      {teamsHref && (
        <a href={teamsHref} className="tab" aria-current={active === 'teams' ? 'page' : undefined} onClick={(e) => nav(e, onTeams)}>
          <Icon d={TAB_ICONS.teams} />
          <span>My teams</span>
        </a>
      )}
      <button className="tab" aria-current={active === 'queue' ? 'page' : undefined} onClick={onQueue}
        aria-label={`Up next${playing ? ', playing' : ''}${queued ? `, ${queued} queued` : ''}`}>
        <span className="tab-icon">
          <Icon d={TAB_ICONS.queue} />
          {queued > 0 ? <b className="tab-badge">{queued}</b> : playing ? <i className="tab-live" /> : null}
        </span>
        <span>Up next</span>
      </button>
      <button className="tab" onClick={onSettings}>
        <Icon d={TAB_ICONS.settings} />
        <span>Settings</span>
      </button>
    </nav>
  );
}
