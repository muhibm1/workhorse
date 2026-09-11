/**
 * The centrepiece (spec 3): a palette-painted thinking orb. `thinking-orbs/engine` supplies pure
 * geometry only (`MODE_FRAMES`) — Paddock paints every frame itself so dots take the app's ring
 * colour instead of the library's built-in greyscale ink.
 *
 * Deviation from the plan, confirmed by inspecting `node_modules/thinking-orbs/dist/engine/*.d.ts`
 * and, since a `.d.ts` can list more than a bundle actually re-exports, the built
 * `dist/engine.cjs` module itself (`Object.keys(require('thinking-orbs/dist/engine.cjs'))`):
 * the runtime export list is exactly `MODE_DRAWS, MODE_FRAMES, STATE_TO_MODE, finalizeFrame,
 * makeProj, paint, paintFrame, paintLines, radiusScale, resolvePreset`. `scaleCounts` and
 * `scaleRadii` are declared in `engine/profiles.d.ts` but are NOT part of the `./engine`
 * subpath's public surface (dead-code-eliminated from the bundle since nothing exported from
 * `engine/index.ts` calls them) — `tests/asciiMask.test.ts`'s sibling module hit the same wall
 * with `vnoise` and left the same note. `scaleCounts`/`scaleRadii` are reimplemented locally
 * below, following the key-naming convention the library itself uses (visible by decompiling
 * `engine.cjs`): options ending in `N` are counts (`ghostN`, `nodeN`, `orbitN`, `strandN`),
 * options ending in `R` are base radii (`ghostR`, `nodeR`, `partR`). This is a best-effort match
 * to the library's unexported `scaleCounts`/`scaleRadii`, not a verified reproduction of them.
 */
import { useEffect, useMemo, useRef } from 'react';
import {
  MODE_FRAMES,
  STATE_TO_MODE,
  resolvePreset,
  radiusScale,
  type ModeOpts,
  type OrbFrame,
} from 'thinking-orbs/engine';
import type { OrbSpec, RingTone } from '@/lib/orbState';

export interface OrbProps {
  spec: OrbSpec;
  /** CSS px. @default 320 */
  size?: number;
  agentCount?: number;
}

const DEFAULT_SIZE = 320;
/** Preset opts are tuned for this size (the library ships exactly 64 and 20). */
const PRESET_SIZE = 64;
/** Plan Task 6: "clamped so counts at most triple". */
const MAX_COUNT_SCALE = 3;
const RING_INSET = 6;
const RING_WIDTH = 2;
const PULSE_PERIOD_S = 1.6;
const PULSE_MIN = 0.4;
const PULSE_MAX = 1;

const COUNT_KEY = /N$/;
const RADIUS_KEY = /R$/;

/** Local stand-in for the library's unexported `scaleCounts`; see header note. */
function scaleCounts(opts: ModeOpts, scale: number): ModeOpts {
  const out: ModeOpts = { ...opts };
  for (const key of Object.keys(out)) {
    if (!COUNT_KEY.test(key)) continue;
    const v = out[key];
    if (typeof v === 'number') out[key] = Math.max(1, Math.round(v * scale));
  }
  return out;
}

/** Local stand-in for the library's unexported `scaleRadii`; see header note. */
function scaleRadii(opts: ModeOpts, scale: number): ModeOpts {
  const out: ModeOpts = { ...opts };
  for (const key of Object.keys(out)) {
    if (!RADIUS_KEY.test(key)) continue;
    const v = out[key];
    if (typeof v === 'number') out[key] = v * scale;
  }
  return out;
}

function readTone(tone: Exclude<RingTone, 'none'>): string {
  if (typeof document === 'undefined') return '#7DE3F0';
  const varName = `--${tone}`;
  const value = getComputedStyle(document.documentElement).getPropertyValue(varName).trim();
  return value || '#7DE3F0';
}

/** `#rrggbb` -> `[r, g, b]`. Falls back to the cyan token's own values on a bad string. */
function hexToRgb(hex: string): [number, number, number] {
  const m = /^#?([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(hex.trim());
  if (!m) return [125, 227, 240];
  return [parseInt(m[1], 16), parseInt(m[2], 16), parseInt(m[3], 16)];
}

const clamp01 = (n: number): number => (n < 0 ? 0 : n > 1 ? 1 : n);

/**
 * Maps a dot's ink value to an alpha over the ring colour: 35% at `white = 0` up to 100% at
 * `white = 1`, nudged brighter for dots nearer the camera (`z`, normalised against the frame's
 * own extent so it self-scales to whichever mode is active).
 */
function paintPalette(ctx: CanvasRenderingContext2D, frame: OrbFrame, rgb: [number, number, number]): void {
  const [r, g, b] = rgb;
  let zMax = 0;
  for (const d of frame.dots) zMax = Math.max(zMax, Math.abs(d.z));
  const zSpan = zMax || 1;

  if (frame.lines.length > 0) {
    ctx.lineCap = 'round';
    for (const line of frame.lines) {
      const a = clamp01(0.4 * (line.a ?? 1));
      if (a <= 0.02) continue;
      ctx.strokeStyle = `rgba(${r},${g},${b},${a})`;
      ctx.lineWidth = line.w;
      ctx.beginPath();
      ctx.moveTo(line.x1, line.y1);
      ctx.lineTo(line.x2, line.y2);
      ctx.stroke();
    }
  }

  for (const dot of frame.dots) {
    const base = 0.35 + 0.65 * clamp01(dot.white);
    const zBoost = 0.08 * (dot.z / zSpan);
    const a = clamp01(base + zBoost) * (dot.a ?? 1);
    if (a <= 0.02) continue;
    ctx.fillStyle = `rgba(${r},${g},${b},${a})`;
    ctx.beginPath();
    ctx.arc(dot.x, dot.y, dot.r, 0, Math.PI * 2);
    ctx.fill();
  }
}

function drawRing(ctx: CanvasRenderingContext2D, size: number, rgb: [number, number, number], alpha: number): void {
  const [r, g, b] = rgb;
  ctx.strokeStyle = `rgba(${r},${g},${b},${clamp01(alpha)})`;
  ctx.lineWidth = RING_WIDTH;
  ctx.beginPath();
  ctx.arc(size / 2, size / 2, size / 2 - RING_INSET, 0, Math.PI * 2);
  ctx.stroke();
}

function prefersReducedMotion(): boolean {
  return typeof matchMedia !== 'undefined' && matchMedia('(prefers-reduced-motion: reduce)').matches;
}

export function Orb({ spec, size = DEFAULT_SIZE, agentCount }: OrbProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  const mode = STATE_TO_MODE[spec.state];

  // Opts tuned for the 64px preset, scaled to the size we actually render at. Counts scale
  // linearly (capped at 3x per the plan); radii use the library's own sub-linear `radiusScale`
  // curve so large orbs don't get comically fat dots.
  const opts = useMemo<ModeOpts>(() => {
    const base = resolvePreset(spec.state, PRESET_SIZE).opts;
    const countScale = Math.min(MAX_COUNT_SCALE, size / PRESET_SIZE);
    const radiusRatio = radiusScale(size, 0.6) / radiusScale(PRESET_SIZE, 0.6);
    return scaleRadii(scaleCounts(base, countScale), radiusRatio);
  }, [spec.state, size]);

  const baseSpeed = useMemo(() => resolvePreset(spec.state, PRESET_SIZE).speed, [spec.state]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return undefined;
    const ctx = canvas.getContext('2d');
    if (!ctx) return undefined;

    const dpr = Math.min(2, (typeof devicePixelRatio !== 'undefined' && devicePixelRatio) || 1);
    canvas.width = Math.round(size * dpr);
    canvas.height = Math.round(size * dpr);

    const frameFn = MODE_FRAMES[mode];
    const ringRgb = spec.ring === 'none' ? null : hexToRgb(readTone(spec.ring));

    const render = (tSeconds: number) => {
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, size, size);
      const frame = frameFn(size, tSeconds * spec.speed * baseSpeed, opts);
      if (ringRgb) {
        const ringAlpha = spec.pulse
          ? PULSE_MIN + (PULSE_MAX - PULSE_MIN) * (0.5 + 0.5 * Math.sin((tSeconds / PULSE_PERIOD_S) * 2 * Math.PI))
          : PULSE_MAX;
        paintPalette(ctx, frame, ringRgb);
        drawRing(ctx, size, ringRgb, ringAlpha);
      } else {
        paintPalette(ctx, frame, [125, 227, 240]);
      }
    };

    if (prefersReducedMotion()) {
      render(0);
      return undefined;
    }

    let raf = 0;
    let start: number | null = null;
    const tick = (ts: number) => {
      if (start === null) start = ts;
      render((ts - start) / 1000);
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [mode, opts, size, spec.speed, spec.pulse, spec.ring, baseSpeed]);

  return (
    <canvas
      ref={canvasRef}
      className="orb"
      style={{ width: size, height: size, display: 'block' }}
      role="img"
      aria-label={`orb: ${spec.state}`}
      data-agent-count={agentCount}
    />
  );
}
