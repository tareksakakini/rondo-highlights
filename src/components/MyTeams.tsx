import { useEffect, useMemo, useState } from 'react';
import type { DataIndex, Kind, Match, Team } from '../types';
import type { FollowsApi } from '../lib/follows';
import { cutSec, fmtRange, fmtTotal, pickHighlight, type Cut } from '../lib/format';
import { groupSlates, loadRecentRounds, loadTeamMatches, teamDirectory, teamId, type PickerGroup, type Slate, type TeamMatch } from '../lib/digest';
import { SlateRow } from './SlateRow';
import { TeamPicker } from './TeamPicker';
import { TeamWheel } from './TeamWheel';

/** A slate's heading: "This weekend", "Midweek"… */
const slateName = (s: Slate) => (s.current ? `This ${s.kind}` : s.kind === 'weekend' ? 'Weekend' : 'Midweek');

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
  const [teamMatches, setTeamMatches] = useState<TeamMatch[] | null>(null);
  const teamsKey = fol.teams.join('|');
  // Which teams, whatever their order: reordering them needs no new data.
  const teamSetKey = [...fol.teams].sort().join('|');
  useEffect(() => {
    if (!fol.user || !fol.teams.length) return;
    let alive = true;
    setTeamMatches(null);
    loadTeamMatches(index, fol.teams).then((tm) => { if (alive) setTeamMatches(tm); }, () => { if (alive) setTeamMatches([]); });
    return () => { alive = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [index, fol.user?.uid, teamSetKey]);
  const slates = useMemo(() => (teamMatches ? groupSlates(teamMatches, fol.teams) : null), [teamMatches, teamsKey]);
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
    return fol.teams.map((id) => ({ id, team: byId.get(id) ?? { name: id, short: id, tla: id.slice(0, 3).toUpperCase(), crest: null } }));
  }, [teamMatches, teamsKey]);

  return (
    <>
      <section className="browse digest" aria-label="My teams">
        {tabs}
        <div className="digest-head">
          <div>
            <h1>My teams <span className="beta-tag">Beta</span></h1>
            <p className="muted">Favorites digest: your teams from every league and cup, weekend by weekend.</p>
          </div>
          {fol.user && fol.teams.length > 0 && <button className="btn-ghost" onClick={() => setPickerOpen(true)}>Edit teams</button>}
        </div>

        {!fol.ready ? null : !fol.user ? (
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
            {!slates && (
              <div className="slate-row loading">{Array.from({ length: 4 }, (_, i) => <div key={i} className="card skeleton" />)}</div>
            )}
            {slates && !slates.length && (
              <p className="muted digest-none">No matches for your teams in the last four weeks.</p>
            )}
            {slates?.map((sl) => {
              const ready = sl.matches.filter((tm) => pickHighlight(tm.match, pref, [], region, avoid));
              const total = ready.reduce((t, tm) => { const c = cutFor(tm.match); return t + (c ? cutSec(c) : 0); }, 0);
              // First and last kick-off (the cards are in your team order, not by date).
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
                    {sl.matches.map((tm) => renderCard(tm.match, false, { comp: tm.comp, roundLabel: tm.roundLabel }))}
                  </SlateRow>
                </section>
              );
            })}
          </>
        )}
      </section>
      {pickerOpen && <TeamPicker groups={pickerGroups} selected={fol.teams} onClose={closePicker} />}
    </>
  );
}
