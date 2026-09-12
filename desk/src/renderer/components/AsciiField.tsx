/**
 * A canvas of drifting ASCII noise (spec 4.3): the decorative background layer behind a Fleet
 * card and, later, the Run screen's grid dressing. `width`/`height`/`cell` lay out a character
 * grid; each cell samples `vnoise` (the local value-noise re-implementation in `lib/asciiMask.ts`
 * — see that file's header for why it is local rather than imported from `thinking-orbs/engine`)
 * at `(x / cell + t, y / cell)`, scales by `density` and by `mask(u, v)` when a mask is given,
 * and picks a ramp character with `rampChar`.
 *
 * Not interactive: the canvas sits under its sibling content, so it never intercepts pointer
 * events (`pointerEvents: 'none'`) and positioning (e.g. `position: absolute; inset: 0`) is left
 * to the consumer's `className`, matching how `Orb.tsx` only owns its own pixels.
 */
import { useEffect, useRef } from 'react';
import { vnoise, rampChar, DEFAULT_RAMP, type Mask } from '@/lib/asciiMask';

export interface AsciiFieldProps {
  /** CSS px. */
  width: number;
  /** CSS px. */
  height: number;
  /** Cell size in CSS px. @default 10 */
  cell?: number;
  /** Dark-to-light ramp; index 0 is space. @default DEFAULT_RAMP */
  ramp?: string;
  /** CSS colour (a token, e.g. `var(--cyan)`). */
  color: string;
  /** 0 to 1. @default 0.5 */
  density?: number;
  /** Shape to reveal, sampled in unit space; omit to fill the whole field. */
  mask?: Mask;
  /** Offsets the noise sample so distinct fields don't all show the same texture. @default 0 */
  seed?: number;
  /** Multiplies how fast the noise drifts. @default 1 */
  speed?: number;
  className?: string;
}

const FPS = 24;
const FRAME_MS = 1000 / FPS;
/** Large enough that adjacent integer seeds land in visibly unrelated parts of the noise field. */
const SEED_SPREAD = 1013.37;

function prefersReducedMotion(): boolean {
  return typeof matchMedia !== 'undefined' && matchMedia('(prefers-reduced-motion: reduce)').matches;
}

/**
 * Turns `var(--name)` (optionally `var(--name, fallback)`) into the computed colour a canvas can
 * use. Plain colours pass through unchanged.
 */
export function resolveCssColor(el: Element, value: string): string {
  const m = /^var\(\s*(--[\w-]+)\s*(?:,\s*([^)]+))?\)$/.exec(value.trim());
  if (!m) return value;
  const resolved = getComputedStyle(el).getPropertyValue(m[1]).trim();
  return resolved || (m[2] ? m[2].trim() : value);
}

export function AsciiField({
  width,
  height,
  cell = 10,
  ramp = DEFAULT_RAMP,
  color,
  density = 0.5,
  mask,
  seed = 0,
  speed = 1,
  className,
}: AsciiFieldProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || width <= 0 || height <= 0) return undefined;
    const ctx = canvas.getContext('2d');
    if (!ctx) return undefined;

    const dpr = Math.min(2, (typeof devicePixelRatio !== 'undefined' && devicePixelRatio) || 1);
    canvas.width = Math.round(width * dpr);
    canvas.height = Math.round(height * dpr);

    const cols = Math.ceil(width / cell);
    const rows = Math.ceil(height / cell);
    const seedOffset = seed * SEED_SPREAD;

    // A canvas cannot parse `var(--token)`: assigning one to fillStyle is silently ignored and
    // the field paints in the default black, which on a dark panel reads as nothing at all.
    // Resolve the token against this canvas so scoped overrides still apply.
    const ink = resolveCssColor(canvas, color);

    const draw = (elapsedSeconds: number) => {
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, width, height);
      ctx.fillStyle = ink;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.font = `${Math.max(1, cell - 2)}px 'JetBrains Mono', ui-monospace, monospace`;

      const t = elapsedSeconds * speed + seedOffset;
      for (let row = 0; row < rows; row++) {
        const y = row * cell;
        const v = y / height;
        for (let col = 0; col < cols; col++) {
          const x = col * cell;
          const u = x / width;
          const m = mask ? mask(u, v) : 1;
          if (m <= 0) continue;
          const n = vnoise(x / cell + t, y / cell);
          const ch = rampChar(ramp, n * density * m);
          if (ch === ' ') continue;
          ctx.fillText(ch, x + cell / 2, y + cell / 2);
        }
      }
    };

    if (prefersReducedMotion()) {
      draw(0);
      return undefined;
    }

    let visible = true;
    let observer: IntersectionObserver | undefined;
    if (typeof IntersectionObserver !== 'undefined') {
      observer = new IntersectionObserver(([entry]) => {
        visible = entry.isIntersecting;
      });
      observer.observe(canvas);
    }

    // 24fps cadence via setInterval; each tick requests one animation frame as the paint gate
    // (plan Task 7) rather than drawing straight from the interval callback, so painting still
    // lines up with the browser's own paint cycle.
    let start: number | null = null;
    let rafId = 0;
    const requestPaint = () => {
      rafId = requestAnimationFrame((ts) => {
        if (start === null) start = ts;
        if (visible) draw((ts - start) / 1000);
      });
    };
    requestPaint();
    const intervalId = window.setInterval(requestPaint, FRAME_MS);

    return () => {
      window.clearInterval(intervalId);
      cancelAnimationFrame(rafId);
      observer?.disconnect();
    };
  }, [width, height, cell, ramp, color, density, mask, seed, speed]);

  return (
    <canvas
      ref={canvasRef}
      className={className}
      style={{ width, height, display: 'block', pointerEvents: 'none' }}
      aria-hidden="true"
    />
  );
}
