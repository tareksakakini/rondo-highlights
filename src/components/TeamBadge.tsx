import type { Team } from '../types';

function hue(s: string) {
  let h = 0;
  for (const c of s) h = (h * 31 + c.charCodeAt(0)) % 360;
  return h;
}

export function TeamBadge({ team, size = 28 }: { team: Team; size?: number }) {
  if (team.crest) {
    return <img className="badge" src={team.crest} alt="" width={size} height={size} loading="lazy" />;
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
