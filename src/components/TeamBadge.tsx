import type { Team } from '../types';
import { crestSrc } from '../lib/data';

/** A crest the site doesn't have yet (added after the last build): load the jsDelivr copy, once. */
function loadFallback(e: { currentTarget: HTMLImageElement }) {
  const img = e.currentTarget;
  const fallback = img.dataset.fallback;
  if (!fallback) return;
  img.removeAttribute('data-fallback');
  img.src = fallback;
}

function hue(s: string) {
  let h = 0;
  for (const c of s) h = (h * 31 + c.charCodeAt(0)) % 360;
  return h;
}

export function TeamBadge({ team, size = 28 }: { team: Team; size?: number }) {
  if (team.crest) {
    const { src, fallback } = crestSrc(team.crest);
    return (
      <img className="badge" src={src} data-fallback={fallback} onError={fallback ? loadFallback : undefined}
        alt="" width={size} height={size} loading="lazy" decoding="async" />
    );
  }
  const h = hue(team.name);
  return (
    <span
      className="badge badge-text"
      style={{ width: size, height: size, background: `hsl(${h} 45% 28%)`, borderColor: `hsl(${h} 55% 45%)`, fontSize: size * 0.32 }}
      aria-hidden="true"
    >
      {team.tla}
    </span>
  );
}
