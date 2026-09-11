/**
 * One slot on the fourteen-station ring around the orb (spec 2.2, 3.2).
 * Positioned absolutely at `(x, y)` -- typically the output of
 * `polar(cx, cy, 240, stationAngle(i))` from `@/lib/polar` -- inside a
 * `position: relative` stage. A phase station is a 28px circle; a gate
 * station is a 24px diamond (a rotated square sized so its diagonal is 24px).
 */
import type { MouseEventHandler } from 'react';

export interface StationProps {
  label: string;
  kind: 'phase' | 'gate';
  /** This station has been reached (phase) or resolved (gate: approved/auto). */
  lit?: boolean;
  /** This is where the run is right now. */
  current?: boolean;
  x: number;
  y: number;
  onClick?: MouseEventHandler<HTMLButtonElement>;
  /** Tooltip text; defaults to `label`. Spec: names the station's artifact when lit. */
  title?: string;
  className?: string;
}

export function Station({ label, kind, lit = false, current = false, x, y, onClick, title, className }: StationProps) {
  const cls = ['station', `station-${kind}`, lit ? 'station-lit' : '', current ? 'station-current' : '', className]
    .filter(Boolean)
    .join(' ');
  return (
    <button
      type="button"
      className={cls}
      style={{ left: x, top: y }}
      onClick={onClick}
      title={title ?? label}
      aria-label={label}
      data-current={current || undefined}
      data-lit={lit || undefined}
    >
      <span className="station-shape" aria-hidden="true" />
      <span className="station-label label">{label}</span>
    </button>
  );
}
