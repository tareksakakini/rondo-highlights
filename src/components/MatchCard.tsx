import type { Kind, Match } from '../types';
import { fmtDay, fmtDuration, pickHighlight } from '../lib/format';
import { TeamBadge } from './TeamBadge';

interface Props {
  match: Match;
  pref: Kind;
  spoilerFree: boolean;
  playing: boolean;
  queued: boolean;
  pinned: Kind | undefined;
  onPin: (kind: Kind) => void;
  onPlay: (kind: Kind | undefined) => void;
  onQueue: (kind: Kind | undefined) => void;
}

const KINDS: Kind[] = ['short', 'extended'];

export function MatchCard({ match, pref, spoilerFree, playing, queued, pinned, onPin, onPlay, onQueue }: Props) {
  const hl = pickHighlight(match, pinned ?? pref);
  const has = (k: Kind) => match.highlights.find((h) => h.kind === k);
  const fallback = hl && hl.kind !== (pinned ?? pref);
  const { home, away, score } = match;
  const showScore = !spoilerFree && score.home != null && score.away != null;

  return (
    <article className={`card${playing ? ' is-playing' : ''}${hl ? '' : ' is-empty'}`}>
      <button className="thumb" onClick={() => hl && onPlay(pinned)} disabled={!hl}
        aria-label={hl ? `Play ${home.short} v ${away.short} highlights and continue with the rest` : 'No highlights yet'}>
        {hl && !spoilerFree ? (
          <img src={`https://i.ytimg.com/vi/${hl.videoId}/mqdefault.jpg`} alt="" loading="lazy" />
        ) : (
          <span className="thumb-teams">
            <TeamBadge team={home} size={44} />
            <span className="vs">v</span>
            <TeamBadge team={away} size={44} />
          </span>
        )}
        {hl && <span className="dur">{fmtDuration(hl.durationSec)}</span>}
        {hl && <span className="play-glyph" aria-hidden="true"><svg viewBox="0 0 24 24"><path d="M8 5v14l11-7z" /></svg></span>}
        {playing && <span className="now-tag">Now playing</span>}
        {!hl && <span className="no-hl">Highlights not in yet</span>}
      </button>

      <div className="card-body">
        <div className="fixture">
          {[{ t: home, g: score.home }, { t: away, g: score.away }].map(({ t, g }, i) => (
            <div className="line" key={i}>
              <TeamBadge team={t} size={22} />
              <span className="tname" title={t.name}>{t.short}</span>
              <span className={`goals${showScore ? '' : ' hidden'}`}>{showScore ? g : spoilerFree ? '•' : ''}</span>
            </div>
          ))}
        </div>
        <div className="meta">
          <span>{fmtDay(match.utcDate)}</span>
          {hl && <span className="dot">·</span>}
          {hl && <span className="channel" title={hl.channel}>{hl.channel}</span>}
        </div>

        {match.highlights.length > 0 && (
          <div className="card-actions">
            <div className="versions" role="radiogroup" aria-label="Highlight length for this match">
              {KINDS.map((k) => {
                const v = has(k);
                const active = hl?.kind === k;
                return (
                  <button key={k} role="radio" aria-checked={active} disabled={!v}
                    className={`chip${active ? ' active' : ''}${active && fallback ? ' fallback' : ''}`}
                    title={v ? `${v.channel} · ${fmtDuration(v.durationSec)}` : `No ${k} cut for this match`}
                    onClick={() => onPin(k)}>
                    {k === 'short' ? 'Short' : 'Ext.'}
                    <span className="chip-dur">{v ? fmtDuration(v.durationSec) : '—'}</span>
                  </button>
                );
              })}
            </div>
            <button className={`btn-icon${queued ? ' done' : ''}`} onClick={() => onQueue(pinned)}
              title={queued ? 'Add again to queue' : 'Add to queue'} aria-label="Add to queue">
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
