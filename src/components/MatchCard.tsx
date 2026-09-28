import type { Kind, Match } from '../types';
import { availableIn, fmtDay, fmtDuration, pickHighlight } from '../lib/format';
import { countryName } from '../lib/region';
import { TeamBadge } from './TeamBadge';

interface Props {
  match: Match;
  pref: Kind;
  region: string | null;
  avoid?: string[];
  spoilerFree: boolean;
  playing: boolean;
  queued: boolean;
  pinned: Kind | undefined;
  onPin: (kind: Kind) => void;
  onPlay: (kind: Kind | undefined) => void;
  onQueue: (kind: Kind | undefined) => void;
}

const KINDS: Kind[] = ['short', 'extended'];

export function MatchCard({ match, pref, region, avoid = [], spoilerFree, playing, queued, pinned, onPin, onPlay, onQueue }: Props) {
  const hl = pickHighlight(match, pinned ?? pref, [], region, avoid);
  const cut = (k: Kind) => match.highlights.find((h) => h.kind === k && availableIn(h, region));
  const fallback = hl && hl.kind !== (pinned ?? pref);
  const blocked = !hl && match.highlights.length > 0;
  const { home, away, score } = match;
  const showScore = !spoilerFree && score.home != null && score.away != null;
  const label = `${home.short} v ${away.short}`;

  return (
    <article className={`card${playing ? ' is-playing' : ''}${hl ? '' : ' is-empty'}`}>
      <button className="thumb" onClick={() => hl && onPlay(pinned)} disabled={!hl}
        aria-label={hl ? `Play ${label} and continue with the rest of the round` : blocked ? `${label}: not available in your country` : `${label}: no highlights yet`}>
        {hl && !spoilerFree ? (
          <img src={`https://i.ytimg.com/vi/${hl.videoId}/mqdefault.jpg`} alt="" loading="lazy" />
        ) : (
          <span className="thumb-teams">
            <TeamBadge team={home} size={40} />
            <span className="vs">v</span>
            <TeamBadge team={away} size={40} />
          </span>
        )}
        {hl && <span className="dur">{fmtDuration(hl.durationSec)}</span>}
        {hl && <span className="play-glyph" aria-hidden="true"><svg viewBox="0 0 24 24"><path d="M8 5v14l11-7z" /></svg></span>}
        {playing && <span className="now-tag">Playing</span>}
        {!hl && <span className="no-hl">{blocked ? `Not available in ${region ? countryName(region) : 'your country'}` : 'Highlights not in yet'}</span>}
      </button>

      <div className="card-body">
        <div className="fixture">
          {[{ t: home, g: score.home }, { t: away, g: score.away }].map(({ t, g }, i) => (
            <div className="line" key={i}>
              <TeamBadge team={t} size={22} />
              <span className="tname" title={t.name}>{t.short}</span>
              <span className={`goals${showScore ? '' : ' hidden'}`}>{showScore ? g : spoilerFree && score.home != null ? '•' : ''}</span>
            </div>
          ))}
        </div>
        <div className="meta">
          <span>{fmtDay(match.utcDate)}</span>
          {hl && <span className="dot">·</span>}
          {hl && <span className="channel" title={hl.channel}>{hl.channel}</span>}
        </div>

        {hl && (
          <div className="card-actions">
            <div className="versions" role="radiogroup" aria-label="Highlight length for this match">
              {KINDS.map((k) => {
                const v = cut(k);
                const active = hl.kind === k;
                return (
                  <button key={k} role="radio" aria-checked={active} disabled={!v}
                    className={`chip${active ? ' active' : ''}${active && fallback ? ' fallback' : ''}`}
                    title={v ? `${v.channel} · ${fmtDuration(v.durationSec)}` : `No ${k} cut available`}
                    onClick={() => onPin(k)}>
                    {k === 'short' ? 'Short' : 'Ext.'}
                    <span className="chip-dur">{v ? fmtDuration(v.durationSec) : '—'}</span>
                  </button>
                );
              })}
            </div>
            <button className={`btn-icon${queued ? ' done' : ''}`} onClick={() => onQueue(pinned)}
              title={queued ? 'Add again to queue' : 'Add to queue'} aria-label={`Add ${label} to queue`}>
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
