/**
 * The station ring: polar layout and the ten slots that surround the orb on the Run screen
 * (spec 2.2, reshaped by the two-gates design section 5: Design / Ship / Deploy gates, six
 * phases).
 */
import type { Gate, Phase } from '@shared/types';

/**
 * A point on a circle. 0 degrees is straight up and angles run clockwise,
 * which is how the ring is read: Onboard at the top, then clockwise through the lifecycle.
 */
export function polar(cx: number, cy: number, r: number, angleDeg: number): { x: number; y: number } {
  const rad = (angleDeg * Math.PI) / 180;
  return { x: cx + r * Math.sin(rad), y: cy - r * Math.cos(rad) };
}

export interface Station {
  key: string;
  label: string;
  kind: 'phase' | 'gate';
  /** The phase this slot represents. Absent on gates and on Onboard. */
  phase?: Phase;
  /** The gate this slot represents. Present only on gates. */
  gate?: Gate;
}

/**
 * The lifecycle in ring order, with the three human gates interleaved. Gate slots carry the
 * gate's name (what the person reads); the id lives on `gate` for state and tooltips. G1 and G3
 * keep their ids in state but no tier requires them, so they have no slot.
 */
export const STATIONS: readonly Station[] = [
  { key: 'onboard', label: '00 Onboard', kind: 'phase' },
  { key: 'design', label: '01 Design', kind: 'phase', phase: 'design' },
  { key: 'g2', label: 'Design', kind: 'gate', gate: 'G2' },
  { key: 'build', label: '02 Build', kind: 'phase', phase: 'build' },
  { key: 'verify', label: '03 Verify', kind: 'phase', phase: 'verify' },
  { key: 'review', label: '04 Review', kind: 'phase', phase: 'review' },
  { key: 'g4', label: 'Ship', kind: 'gate', gate: 'G4' },
  { key: 'deploy', label: '05 Deploy', kind: 'phase', phase: 'deploy' },
  { key: 'g5', label: 'Deploy', kind: 'gate', gate: 'G5' },
  { key: 'retro', label: '06 Retro', kind: 'phase', phase: 'done' },
] as const;

/** Evenly spaced slots, the first one straight up. */
export function stationAngle(i: number): number {
  return (i * 360) / STATIONS.length;
}

/** The radial menu sits on the diagonals, which no station slot occupies: ten slots sit on
 *  multiples of 36 degrees, and none of those is 45, 135, 225 or 315. */
export const MENU_ANGLES = [45, 135, 225, 315] as const;

/** Phases in the order a change moves through them (plugin 0.3). */
export const PHASE_ORDER: readonly Phase[] = ['design', 'build', 'verify', 'review', 'deploy', 'done'] as const;

/** The pre-0.3 design phases, which an older change's digest may still name. */
const LEGACY_DESIGN_PHASES: ReadonlySet<Phase> = new Set<Phase>(['intent', 'spec', 'plan']);

/** Position of a phase in the lifecycle, or -1 when there is no active change. A legacy
 *  `intent` / `spec` / `plan` phase reads as `design`. */
export function phaseIndex(phase: Phase | null | undefined): number {
  if (!phase) return -1;
  if (LEGACY_DESIGN_PHASES.has(phase)) return PHASE_ORDER.indexOf('design');
  return PHASE_ORDER.indexOf(phase);
}
