import type { Kind, Match } from '../types';
import { availableIn, awaitingIn, cutSec, fmtCount, fmtDay, fmtDuration, matchViews, pickCut, usable } from '../lib/format';
import { isDone, type Watched } from '../lib/watched';
import type { CondensedMap } from '../lib/moments';
import { countryName } from '../lib/region';
import { TeamBadge } from './TeamBadge';

interface Props {
  match: Match;
  /** One of the first cards on screen: its thumbnail is the page's main image, so fetch it first. */
  first?: boolean;
  pref: Kind;
  /** key moments by videoId, or null when Auto-condense is off */
  condensed: CondensedMap | null;
  region: string | null;
  avoid?: string[];
  spoilerFree: boolean;
  playing: boolean;
  queued: boolean;
  pinned: Kind | undefined;
  onPin: (kind: Kind) => void;
  onPlay: (kind: Kind | undefined) => void;
  onQueue: (kind: Kind | undefined) => void;
  /** YouTube view counts by videoId (shown in spoiler-free mode too); null while they load. */
  views?: Record<string, number> | null;
  /** How far this browser got with this match, if it watched it. */
  watched?: Watched;
}

const KINDS: Kind[] = ['short', 'extended'];
/** football-data.org statuses with a final result (AWARDED: a result given by the league). */
const FINAL = /^(FINISHED|AWARDED)$/;

export function MatchCard({ match, first = false, pref, condensed, region, avoid = [], spoilerFree, playing, queued, pinned, onPin, onPlay, onQueue, views = null, watched }: Props) {
  const picked = pickCut(match, pinned ?? pref, condensed, [], region, avoid);
  const hl = picked?.h ?? null;
  // Videos that won't embed for this viewer count as missing, chips and notes alike.
  const videos = usable(match, avoid);
  // The "short" slot holds the official short cut, or else the auto-condensed extended cut.
  const official = (k: Kind) => videos.find((h) => h.kind === k && availableIn(h, region));
  const shortSlot = official('short') ? null : pickCut(match, 'short', condensed, [], region, avoid);
  const condensedCut = shortSlot?.condensed ? shortSlot : null;
  const slot = picked?.condensed ? 'short' : hl?.kind;
  const fallback = hl && slot !== (pinned ?? pref);
  const blocked = !hl && videos.length > 0;
  // Only another country's cut so far: say it isn't out here yet, not that it never will be.
  const where = region ? countryName(region) : 'your country';
  const waiting = blocked && awaitingIn(match, region, avoid);
  const note = waiting ? `Not out in ${where} yet` : blocked ? `Not available in ${where}` : 'Highlights not in yet';
  const { home, away, score } = match;
  // Only the final score: a live one would be stale by the time the data is read.
  const showScore = !spoilerFree && FINAL.test(match.status) && score.home != null && score.away != null;
  const label = `${home.short} v ${away.short}`;
  const viewCount = hl ? matchViews(match, views) : undefined;
  const done = isDone(watched);

  return (
    <article className={`card${playing ? ' is-playing' : ''}${hl ? '' : ' is-empty'}`} data-match={match.id}>
      <button className="thumb" onClick={() => hl && onPlay(pinned)} disabled={!hl}
        aria-label={hl ? `Play ${label}` : `${label}: ${note}`}>
        {/* The crests, also under the thumbnail until it loads (as on the prerendered page). */}
        <span className="thumb-teams" aria-hidden={hl && !spoilerFree ? true : undefined}>
          <TeamBadge team={home} size={56} />
          <span className="vs">v</span>
          <TeamBadge team={away} size={56} />
        </span>
        {hl && !spoilerFree && (
          <img src={`https://i.ytimg.com/vi/${hl.videoId}/mqdefault.jpg`} alt="" width={320} height={180}
            loading={first ? 'eager' : 'lazy'} fetchPriority={first ? 'high' : 'auto'} decoding="async" />
        )}
        {picked && <span className="dur">{fmtDuration(cutSec(picked))}</span>}
        {hl && <span className="play-glyph" aria-hidden="true"><svg viewBox="0 0 24 24"><path d="M8 5v14l11-7z" /></svg></span>}
        {watched && hl && (
          <span className="watched-bar" aria-hidden="true"><i style={{ width: `${Math.max(4, Math.round((watched.e ? 1 : watched.f) * 100))}%` }} /></span>
        )}
        {playing && <span className="now-tag">Playing</span>}
        {!hl && <span className="no-hl">{note}</span>}
      </button>

      <div className="card-body">
        {/* One team per line, score on the right (never in spoiler-free mode); the loser is greyed out.
            Names get the card's full width and wrap rather than being cut off. */}
        <div className="teams">
          {([['home', home, score.home, score.away], ['away', away, score.away, score.home]] as const).map(([side, team, own, other]) => (
            <div key={side} className={`team-row${showScore && own! < other! ? ' lose' : ''}`}>
              <TeamBadge team={team} size={20} />
              <span className="tname" title={team.name}>{team.short}</span>
              {showScore && <span className="tscore">{own}</span>}
            </div>
          ))}
        </div>
        <div className="meta">
          <span>{fmtDay(match.utcDate)}</span>
          {hl && <span className="dot">·</span>}
          {hl && <span className="channel" title={hl.channel}>{hl.channel}</span>}
        </div>
        {/* Its own line, always there (so nothing moves when the counts arrive): YouTube views, and whether you've watched it. */}
        <div className="meta meta-2">
          {viewCount != null ? (
            <span className="views" title={`${viewCount.toLocaleString('en-US')} views on YouTube of all this match's highlights, short and extended (not on Rondo), rounded`}>
              {fmtCount(viewCount)} YouTube {viewCount === 1 ? 'view' : 'views'}
            </span>
          ) : <span>&nbsp;</span>}
          {done && hl && (
            <span className="watched-tag" title="You've watched this highlight to the end">
              <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 12.5l4.5 4.5L19 7.5" /></svg>Watched
            </span>
          )}
        </div>

        {hl && (
          <div className="card-actions">
            <div className="versions" role="radiogroup" aria-label="Highlight length for this match">
              {KINDS.map((k) => {
                const v = official(k);
                const cond = k === 'short' && !v ? condensedCut : null;
                const active = slot === k;
                const sec = cond ? cutSec(cond) : v?.durationSec;
                return (
                  <button key={k} role="radio" aria-checked={active} disabled={!v && !cond}
                    className={`chip${active ? ' active' : ''}${active && fallback ? ' fallback' : ''}${cond ? ' cond' : ''}`}
                    title={cond ? `Auto-condensed from ${cond.h.channel}'s extended cut: the key moments, found from YouTube's chapters. It can occasionally skip a goal.`
                      : v ? `${v.channel} · ${fmtDuration(v.durationSec)}` : `No ${k} cut available`}
                    onClick={() => onPin(k)}>
                    {cond ? <>Auto<sup>*</sup></> : k === 'short' ? 'Short' : 'Ext.'}
                    <span className="chip-dur">{sec != null ? fmtDuration(sec) : '—'}</span>
                  </button>
                );
              })}
            </div>
            <button className={`btn-icon${queued ? ' done' : ''}`} onClick={() => onQueue(pinned)}
              title={queued ? 'Remove from queue' : 'Add to queue'} aria-label={queued ? `Remove ${label} from queue` : `Add ${label} to queue`}>
              {queued ? (
                <svg viewBox="0 0 24 24"><path d="M9 16.2 4.8 12l-1.4 1.4L9 19 21 7l-1.4-1.4z" /></svg>
              ) : (
                <svg viewBox="0 0 24 24"><path d="M3 6h12v2H3zm0 5h12v2H3zm0 5h8v2H3zm14-3v-3h2v3h3v2h-3v3h-2v-3h-3v-2z" /></svg>
              )}
            </button>
          </div>
        )}
      </div>
    </article>
  );
}
