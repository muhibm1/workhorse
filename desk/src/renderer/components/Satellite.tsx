/**
 * A running agent, shown as a chip on the ring outside the station circle.
 * Spawned by `agent:start` and retired on `agent:stop` (spec 2.2).
 */
import type { CSSProperties } from 'react';

/**
 * Elapsed milliseconds as mm:ss. Minutes are not clamped at 59, because a
 * builder that has been going for eighty minutes should say so rather than
 * wrap around to something reassuring.
 */
export function formatElapsed(ms: number): string {
  const total = Math.floor(Math.max(0, ms) / 1000);
  const minutes = Math.floor(total / 60);
  const seconds = total % 60;
  return `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
}

export interface SatelliteProps {
  label: string;
  startedAt: number;
  /** Current time, supplied by the screen so main owns the clock. */
  now: number;
  x: number;
  y: number;
  /** Fading out after its agent stopped. */
  retiring?: boolean;
  title?: string;
}

export function Satellite({ label, startedAt, now, x, y, retiring = false, title }: SatelliteProps) {
  const style: CSSProperties = { left: x, top: y };
  return (
    <div
      className={`satellite${retiring ? ' satellite-retiring' : ''}`}
      style={style}
      title={title ?? label}
      data-retiring={retiring || undefined}
    >
      <span className="satellite-label">{label}</span>
      <span className="satellite-time mono tnum">{formatElapsed(now - startedAt)}</span>
    </div>
  );
}
