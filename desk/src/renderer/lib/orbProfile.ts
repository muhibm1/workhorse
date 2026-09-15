// Draw options for the Run screen's 320px orb. Pure: no DOM, no timers.
import { resolvePreset, type ModeKey, type ModeOpts, type Resolved } from 'thinking-orbs/engine';
import type { OrbState } from './orbState';

/**
 * thinking-orbs 0.3.1's full-size profiles, the dot counts and radii its author tuned for a
 * 300pt frame. The engine declares them (`BASE_PROFILES` in `engine/profiles.d.ts`) but the
 * bundle does not export them: only the 64px and 20px presets reach the public surface, and
 * those thin the dots out for icon sizes. Copied verbatim from `dist/engine.es.js`;
 * tests/orbProfile.test.ts fails if a library upgrade drifts from them.
 */
export const FULL_SIZE_PROFILES: Record<ModeKey, ModeOpts> = {
  globe: { latRings: 17, lonDensity: 44, rBase: 0.6, rDepth: 1.7, rBoost: 1, inkFar: 0.62, inkSpan: 0.54, rsPow: 0.6, rMin: 0.3 },
  orbits: { orbitN: 12, ghostN: 40, ghostR: 0.9, ghostA: 0.5, particles: 3, partR: 1.2, partRDepth: 1.6, rsPow: 0.6, rMin: 0.3 },
  rubik: {
    latRings: 15, lonDensity: 40, moveCount: 14, rBase: 0.6, rDepth: 1.7, rActive: 0.3, inkFar: 0.62, inkSpan: 0.54,
    rsPow: 0.6, rMin: 0.3,
  },
  wave: { rings: 15, lonDensity: 40, rBase: 0.6, rDepth: 1.7, rsPow: 0.6, rMin: 0.3 },
  web: { nodeN: 30, thr: 0.72, signals: 5, nodeR: 1.4, nodeRDepth: 1.8, lineW: 0.8, rsPow: 0.6, rMin: 0.3 },
  braid: { strandN: 52, turns: 3, ghostN: 150, rBase: 1.2, rDepth: 1.8, rsPow: 0.6, rMin: 0.3 },
  ribbon: { lanes: 5, segs: 88, ghostN: 150, rBase: 1.1, rDepth: 1.7, rsPow: 0.6, rMin: 0.3 },
  ring: { lanes: 5, segs: 88, ghostN: 0, faceOn: 1, rBase: 1.1, rDepth: 1.7, rsPow: 0.6, rMin: 0.3 },
  morph: { rDot: 0.021, iconD: 1, rMin: 0.25 },
};

/**
 * The 64px preset's motion (its `speed`, the one libraries.dev/orbs animates at) and its
 * per-state extras (spin, band and scan tuning), laid over the full-size profile. The preset's
 * count and radius multipliers are dropped: they exist to keep a 64px orb legible and make a
 * 320px one sparse.
 */
export function fullSizePreset(state: OrbState): Resolved {
  const preset = resolvePreset(state, 64);
  const { rSizeMul: _iconSizeOnly, ...opts } = { ...preset.opts, ...FULL_SIZE_PROFILES[preset.mode] };
  return { mode: preset.mode, speed: preset.speed, opts };
}
