/**
 * The centrepiece (spec 3): a `thinking-orbs` orb at the quality libraries.dev/orbs shows.
 *
 * Geometry, depth shading and motion are the library's own: `MODE_FRAMES` at the 64px preset's
 * speed, on the full-size profile (`lib/orbProfile.ts`), painted the way the engine's `paint`
 * paints (matte ink per dot, near dots brighter on dark, far to near). The only change is the
 * ink: instead of grey, each dot's brightness scales a Dracula gradient for the run's tone, so
 * the shading survives the colour. Idle (`ring: 'none'`) paints with the engine's grey
 * `paintFrame` untouched. The tone's ring and its gate pulse are CSS (`.orb-ring`).
 */
import { useEffect, useMemo, useRef } from 'react';
import { MODE_FRAMES, paintFrame, type OrbFrame } from 'thinking-orbs/engine';
import type { OrbSpec, RingTone } from '@/lib/orbState';
import { fullSizePreset } from '@/lib/orbProfile';

export interface OrbProps {
  spec: OrbSpec;
  /** CSS px. @default 320 */
  size?: number;
  agentCount?: number;
}

const DEFAULT_SIZE = 320;
/** The engine's own cap: past 2x the extra pixels cost frames and add nothing visible. */
const MAX_DPR = 2;

type Rgb = [number, number, number];

/** Gradient stops per tone, top-left to bottom-right, as theme.css tokens. */
const TONE_STOPS: Record<Exclude<RingTone, 'none'>, [string, string]> = {
  cyan: ['--cyan', '--violet'],
  amber: ['--amber', '--pink'],
  coral: ['--coral', '--pink'],
  mint: ['--mint', '--cyan'],
};

function hexToRgb(hex: string, fallback: Rgb): Rgb {
  const m = /^#?([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(hex.trim());
  return m ? [parseInt(m[1], 16), parseInt(m[2], 16), parseInt(m[3], 16)] : fallback;
}

function readToken(name: string, fallback: Rgb): Rgb {
  if (typeof document === 'undefined') return fallback;
  return hexToRgb(getComputedStyle(document.documentElement).getPropertyValue(name), fallback);
}

const clamp01 = (n: number): number => (n < 0 ? 0 : n > 1 ? 1 : n);

/**
 * The engine's `paint` + `paintLines` with coloured ink. The engine mirrors `white` on dark
 * themes (ink = 1 - white); that brightness multiplies the gradient colour at the dot's position,
 * so a near dot is the full tone and a far one a dim version of it, exactly where the grey
 * original is bright or dim. Alpha and draw order are the engine's, unchanged.
 */
function paintTinted(ctx: CanvasRenderingContext2D, frame: OrbFrame, size: number, from: Rgb, to: Rgb): void {
  const ink = (x: number, y: number, white: number): string => {
    const lum = 1 - clamp01(white);
    const k = clamp01((x + y) / (2 * size));
    const r = Math.round((from[0] + (to[0] - from[0]) * k) * lum);
    const g = Math.round((from[1] + (to[1] - from[1]) * k) * lum);
    const b = Math.round((from[2] + (to[2] - from[2]) * k) * lum);
    return `${r},${g},${b}`;
  };
  for (const line of frame.lines) {
    ctx.strokeStyle = `rgba(${ink((line.x1 + line.x2) / 2, (line.y1 + line.y2) / 2, line.white)},${line.a ?? 1})`;
    ctx.lineWidth = line.w;
    ctx.beginPath();
    ctx.moveTo(line.x1, line.y1);
    ctx.lineTo(line.x2, line.y2);
    ctx.stroke();
  }
  for (const dot of frame.dots) {
    ctx.fillStyle = `rgba(${ink(dot.x, dot.y, dot.white)},${dot.a ?? 1})`;
    ctx.beginPath();
    ctx.arc(dot.x, dot.y, dot.r, 0, Math.PI * 2);
    ctx.fill();
  }
}

function prefersReducedMotion(): boolean {
  return typeof matchMedia !== 'undefined' && matchMedia('(prefers-reduced-motion: reduce)').matches;
}

export function Orb({ spec, size = DEFAULT_SIZE, agentCount }: OrbProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const preset = useMemo(() => fullSizePreset(spec.state), [spec.state]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return undefined;
    const ctx = canvas.getContext('2d');
    if (!ctx) return undefined;

    const dpr = Math.min(MAX_DPR, (typeof devicePixelRatio !== 'undefined' && devicePixelRatio) || 1);
    canvas.width = Math.round(size * dpr);
    canvas.height = Math.round(size * dpr);

    const frameFn = MODE_FRAMES[preset.mode];
    const stops = spec.ring === 'none' ? null : TONE_STOPS[spec.ring];
    const from = stops ? readToken(stops[0], [139, 233, 253]) : null;
    const to = stops ? readToken(stops[1], [189, 147, 249]) : null;
    const rate = preset.speed * spec.speed;

    const render = (tSeconds: number) => {
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, size, size);
      const frame = frameFn(size, tSeconds * rate, preset.opts);
      if (from && to) paintTinted(ctx, frame, size, from, to);
      else paintFrame(ctx, frame, true);
    };

    if (prefersReducedMotion()) {
      render(0);
      return undefined;
    }

    let raf = 0;
    const tick = (ts: number) => {
      // The library's clock: seconds since page load, so a state change keeps the orb's phase
      // instead of snapping it back to t = 0.
      render(ts / 1000);
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [preset, size, spec.speed, spec.ring]);

  return (
    <div className="orb" data-tone={spec.ring} data-pulse={spec.pulse || undefined} style={{ width: size, height: size }}>
      {spec.ring !== 'none' && <span className="orb-ring" aria-hidden="true" />}
      <canvas
        ref={canvasRef}
        className="orb-canvas"
        style={{ width: size, height: size }}
        role="img"
        aria-label={`orb: ${spec.state}`}
        data-agent-count={agentCount}
      />
    </div>
  );
}
