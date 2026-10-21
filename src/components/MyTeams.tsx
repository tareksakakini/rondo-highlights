import { useEffect, useMemo, useState } from 'react';
import type { DataIndex, Kind, Match, Team } from '../types';
import type { FollowsApi } from '../lib/follows';
import { awaitingIn, cutSec, fmtRange, fmtTotal, pickHighlight, usable, type Cut } from '../lib/format';
import { groupSlates, loadRecentRounds, loadTeamMatches, teamDirectory, teamId, type PickerGroup, type Slate, type TeamMatch } from '../lib/digest';
import { SlateRow } from './SlateRow';
import { TeamsLoading } from './TeamsLoading';
import { TeamPicker } from './TeamPicker';
import { TeamWheel } from './TeamWheel';

/** A slate's heading: "This weekend", "Midweek"… */
const slateName = (s: Slate) => (s.current ? `This ${s.kind}` : s.kind === 'weekend' ? 'Weekend' : 'Midweek');

/** The last teams' matches loaded, so coming back to the page shows them at once. */
let last: { key: string; tm: TeamMatch[] } | null = null;

/**
 * "★ My teams": the favorites digest (src/lib/digest.ts), your teams' matches in weekend
 * and midweek rows, and the team picker. Its own chunk, loaded the first time it's opened
 * (see App.tsx); the cards and playing them stay with the app.
 */
export function MyTeams({ index, fol, tabs, arrival, onArrived, openMyTeams, pref, region, avoid, cutFor, renderCard, onPlay }: {
  index: DataIndex;
  fol: FollowsApi;
  tabs: React.ReactNode;
  /** How "★ My teams" was opened: `pick` for the picker straight away, else only when no teams are picked yet. */
  arrival: { pick: boolean } | null;
  onArrived: () => void;
  openMyTeams: (pick?: boolean) => void;
  pref: Kind;
  region: string | null;
  avoid: string[];
  cutFor: (m: Match) => Cut | null;
  renderCard: (m: Match, first: boolean, ctx: { comp: TeamMatch['comp']; roundLabel: string }) => React.ReactNode;
  onPlay: (ms: TeamMatch[]) => void;
}) {
  // The teams this browser was last signed in with load straight away, alongside the account.
  const teams = fol.savedTeams;
  const teamsKey = teams.join('|');
  // Which teams, whatever their order: reordering them needs no new data.
  const teamSetKey = [...teams].sort().join('|');
  const [teamMatches, setTeamMatches] = useState<TeamMatch[] | null>(() => (last?.key === teamSetKey ? last.tm : null));
  useEffect(() => {
    if (!teams.length) return;
    if (last?.key === teamSetKey) { setTeamMatches(last.tm); return; }
    let alive = true;
    setTeamMatches(null);
    const done = (tm: TeamMatch[]) => { last = { key: teamSetKey, tm }; if (alive) setTeamMatches(tm); };
    loadTeamMatches(index, teams).then(done, () => { if (alive) setTeamMatches([]); });
    return () => { alive = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [index, teamSetKey]);
  const slates = useMemo(() => (teamMatches ? groupSlates(teamMatches, teams) : null), [teamMatches, teamsKey]);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [pickerGroups, setPickerGroups] = useState<PickerGroup[] | null>(null);
  useEffect(() => {
    if (!pickerOpen || pickerGroups) return;
    let alive = true;
    loadRecentRounds(index).then((r) => { if (alive) setPickerGroups(teamDirectory(r, index.competitions)); });
    return () => { alive = false; };
  }, [pickerOpen, index, pickerGroups]);
  // Just opened (see `arrival`): the picker when asked for, or when no teams are picked yet.
  useEffect(() => {
    if (!arrival || !fol.user) return;
    if (arrival.pick || !fol.teams.length) setPickerOpen(true);
    onArrived();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [arrival, fol.user, fol.teams.length]);
  const closePicker = (teams: string[]) => {
    setPickerOpen(false);
    if (teams.join('|') !== teamsKey) fol.setTeams(teams);
  };
  /** Your teams, with their crests where the digest has them. */
  const teamCrests = useMemo(() => {
    // The football-data side's name and crest (a Highlightly club only stands in for it).
    const byId = new Map<string, Team>();
    for (const t of (teamMatches ?? []).flatMap((tm) => [tm.match.home, tm.match.away])) {
      if (!byId.has(teamId(t)) || byId.get(teamId(t))!.key) byId.set(teamId(t), t);
    }
    return teams.map((id) => ({ id, team: byId.get(id) ?? { name: id, short: id, tla: id.slice(0, 3).toUpperCase(), crest: null } }));
  }, [teamMatches, teamsKey]);

  // One wait, then the whole page: the account, and your teams' matches when you have teams.
  const picker = pickerOpen && <TeamPicker groups={pickerGroups} selected={fol.teams} onClose={closePicker} />;
  if (!fol.ready || (fol.user && fol.teams.length > 0 && !slates)) return <><TeamsLoading tabs={tabs} />{picker}</>;

  return (
    <>
      <section className="browse digest" aria-label="My teams">
        {tabs}
        <div className="digest-body">
        <div className="digest-head">
          <div>
            <h1>My teams <span className="beta-tag">Beta</span></h1>
            <p className="muted">Favorites digest: your teams from every league and cup, weekend by weekend.</p>
          </div>
          {fol.user && fol.teams.length > 0 && <button className="btn-ghost" onClick={() => setPickerOpen(true)}>Edit teams</button>}
        </div>

        {!fol.user ? (
          <div className="digest-empty">
            <p>Pick your teams to get their highlights from every competition, grouped weekend by weekend and midweek by midweek.</p>
            <button className="btn-primary" onClick={() => openMyTeams(true)}>Pick your teams</button>
          </div>
        ) : !fol.teams.length ? (
          <div className="digest-empty">
            <p>You haven&apos;t picked any teams yet.</p>
            <button className="btn-primary" onClick={() => setPickerOpen(true)}>Pick your teams</button>
          </div>
        ) : (
          <>
            <TeamWheel teams={teamCrests} onReorder={fol.setTeams} />
            {slates && !slates.length && (
              <p className="muted digest-none">No matches for your teams in the last four weeks.</p>
            )}
            {slates?.map((sl) => {
              // Playable first, then not in yet, then not available here (as on a round's page);
              // your team order within each. A match waiting on its local cut counts as not in yet.
              const tier = (m: Match) => (pickHighlight(m, pref, [], region, avoid) ? 0 : !usable(m, avoid).length || awaitingIn(m, region, avoid) ? 1 : 2);
              const tiered = sl.matches.map((tm) => ({ tm, t: tier(tm.match) })).sort((a, b) => a.t - b.t);
              const cards = tiered.map(({ tm }) => tm);
              const ready = tiered.filter(({ t }) => t === 0).map(({ tm }) => tm);
              const total = ready.reduce((t, tm) => { const c = cutFor(tm.match); return t + (c ? cutSec(c) : 0); }, 0);
              // First and last kick-off (the cards aren't in date order).
              const dates = sl.matches.map((tm) => tm.match.utcDate).sort();
              const days = fmtRange(dates[0], dates[dates.length - 1]);
              return (
                <section key={sl.start} className="slate" aria-label={`${slateName(sl)}, ${days}`}>
                  <SlateRow label={slateName(sl)} head={<>
                    <h2>{slateName(sl)} <span className="slate-days">{days}</span></h2>
                    <span className="slate-meta muted">{ready.length}/{sl.matches.length} playable{total > 0 ? ` · ${fmtTotal(total)}` : ''}</span>
                    <button className="btn-ghost sm slate-play" disabled={!ready.length} onClick={() => onPlay(ready)}>
                      <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M8 5v14l11-7z" /></svg>Play all
                    </button>
                  </>}>
                    {cards.map((tm) => renderCard(tm.match, false, { comp: tm.comp, roundLabel: tm.roundLabel }))}
                  </SlateRow>
                </section>
              );
            })}
          </>
        )}
        </div>
      </section>
      {picker}
    </>
  );
}
