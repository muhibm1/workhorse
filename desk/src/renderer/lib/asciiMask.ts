/**
 * Value noise, ramp mapping and shape masks for the ASCII fields (spec 4.3).
 *
 * The noise is local rather than imported from the orb engine: the engine's
 * `vnoise` is not on its public `engine` export, and this is twenty lines.
 */

/** Dark to light. Index 0 is empty space, the last index is solid. */
export const DEFAULT_RAMP = ' .:-=+*#%@';

/** A shape to reveal, sampled in unit space. 0 hides a cell, 1 shows it fully. */
export type Mask = (u: number, v: number) => number;

const clamp01 = (n: number): number => (n < 0 ? 0 : n > 1 ? 1 : n);

/** Deterministic hash of an integer lattice point, in [0, 1). */
function hash2(ix: number, iy: number): number {
  const n = Math.sin(ix * 127.1 + iy * 311.7) * 43758.5453123;
  return n - Math.floor(n);
}

/** Smoothstep, so the lattice interpolation has no visible creases. */
const smooth = (t: number): number => t * t * (3 - 2 * t);

/**
 * Value noise on a unit lattice: smooth, deterministic, cheap, and bounded
 * to [0, 1]. Continuous, so a small step in x or y moves the value only a
 * little, which is what keeps the character field from flickering.
 */
export function vnoise(x: number, y: number): number {
  const x0 = Math.floor(x);
  const y0 = Math.floor(y);
  const fx = smooth(x - x0);
  const fy = smooth(y - y0);

  const v00 = hash2(x0, y0);
  const v10 = hash2(x0 + 1, y0);
  const v01 = hash2(x0, y0 + 1);
  const v11 = hash2(x0 + 1, y0 + 1);

  const top = v00 + (v10 - v00) * fx;
  const bottom = v01 + (v11 - v01) * fx;
  return clamp01(top + (bottom - top) * fy);
}

/** Pick a ramp character for a value in [0, 1]; out-of-range values clamp. */
export function rampChar(ramp: string, value: number): string {
  if (ramp.length === 0) return ' ';
  const i = Math.floor(clamp01(value) * ramp.length);
  return ramp[Math.min(ramp.length - 1, i)];
}

/** Reveals everything. Also the fallback whenever a real mask cannot be built. */
export const none: Mask = () => 1;

/** How far past the radius a disc fades out, in unit space. */
const DISC_FEATHER = 0.08;

/** A circle of radius `r` centred in the unit square, feathered at its edge. */
export function disc(r: number): Mask {
  // Math.hypot on an exact-radius point can land a hair past r (0.8 from
  // (0.5,0.5) computes to 0.7999999999999993), so the inside test tolerates
  // floating-point noise rather than demanding an exact boundary.
  const EPS = 1e-9;
  return (u, v) => {
    const d = Math.hypot(u - 0.5, v - 0.5);
    if (d <= r + EPS) return 1;
    if (d >= r + DISC_FEATHER) return 0;
    return 1 - (d - r) / DISC_FEATHER;
  };
}

/**
 * Rasterises a character and samples its alpha, so a field can spell a glyph.
 * Returns `none` wherever there is no DOM (tests, main process) rather than
 * throwing, because a missing mask should soften the effect, not break a screen.
 */
export function glyph(char: string, font: string, resolution = 64): Mask {
  if (typeof document === 'undefined') return none;

  const canvas = document.createElement('canvas');
  canvas.width = resolution;
  canvas.height = resolution;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  if (!ctx) return none;

  ctx.clearRect(0, 0, resolution, resolution);
  ctx.fillStyle = '#fff';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.font = `${Math.round(resolution * 0.8)}px ${font}`;
  ctx.fillText(char, resolution / 2, resolution / 2);

  let alpha: Uint8ClampedArray;
  try {
    alpha = ctx.getImageData(0, 0, resolution, resolution).data;
  } catch {
    return none; // a tainted or zero-sized canvas is not worth failing over
  }

  return (u, v) => {
    if (u < 0 || u > 1 || v < 0 || v > 1) return 0;
    const px = Math.min(resolution - 1, Math.floor(u * resolution));
    const py = Math.min(resolution - 1, Math.floor(v * resolution));
    return alpha[(py * resolution + px) * 4 + 3] / 255;
  };
}
