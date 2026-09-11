/**
 * The Run screen's right-hand event stream (spec 2.2): normalised events in
 * mono, auto-scrolling to the newest line unless the reader has paused it.
 *
 * `at` is a timestamp supplied by the caller (ultimately main, per the
 * "no Date.now() in the renderer for elapsed times" constraint) -- this
 * component only formats it, never generates one.
 */
import { useEffect, useRef } from 'react';
import type { RingTone } from '@/lib/orbState';

/** Re-exported for convenience; identical to `@/lib/orbState`'s `RingTone`. */
export type LogTone = RingTone;

export interface LogLine {
  at: number;
  text: string;
  tone?: RingTone;
}

export interface LogRailProps {
  lines: LogLine[];
  paused: boolean;
  onTogglePause: () => void;
  className?: string;
}

function formatClock(at: number): string {
  const d = new Date(at);
  const hh = String(d.getHours()).padStart(2, '0');
  const mm = String(d.getMinutes()).padStart(2, '0');
  const ss = String(d.getSeconds()).padStart(2, '0');
  return `${hh}:${mm}:${ss}`;
}

export function LogRail({ lines, paused, onTogglePause, className }: LogRailProps) {
  const bodyRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (paused) return;
    const el = bodyRef.current;
    if (!el) return;
    el.scrollTop = el.scrollHeight;
  }, [lines, paused]);

  return (
    <div className={['log-rail', className].filter(Boolean).join(' ')}>
      <div className="log-rail-header">
        <span className="label">Log</span>
        <button
          type="button"
          className="log-rail-pause label"
          onClick={onTogglePause}
          aria-pressed={paused}
        >
          {paused ? 'Resume' : 'Pause'}
        </button>
      </div>
      <div className="log-rail-body mono" ref={bodyRef}>
        {lines.map((line, i) => (
          <div
            key={`${line.at}-${i}`}
            className={['log-line', line.tone ? `log-line-${line.tone}` : ''].filter(Boolean).join(' ')}
          >
            <span className="log-line-time tnum">{formatClock(line.at)}</span>
            <span className="log-line-text">{line.text}</span>
          </div>
        ))}
      </div>
    </div>
  );
}
