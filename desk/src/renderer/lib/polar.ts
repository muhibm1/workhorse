/**
 * The station ring: polar layout and the fourteen slots that surround the orb
 * on the Run screen (spec 2.2).
 */
import type { Gate, Phase } from '@shared/types';

/**
 * A point on a circle. 0 degrees is straight up and angles run clockwise,
 * which is how the ring is read: Onboard at the top, Build at the bottom.
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

/** The lifecycle in ring order, with the four human gates interleaved. */
export const STATIONS: readonly Station[] = [
  { key: 'onboard', label: '00 Onboard', kind: 'phase' },
  { key: 'intent', label: '01 Intent', kind: 'phase', phase: 'intent' },
  { key: 'g1', label: 'G1', kind: 'gate', gate: 'G1' },
  { key: 'spec', label: '02 Spec', kind: 'phase', phase: 'spec' },
  { key: 'g2', label: 'G2', kind: 'gate', gate: 'G2' },
  { key: 'plan', label: '03 Plan', kind: 'phase', phase: 'plan' },
  { key: 'g3', label: 'G3', kind: 'gate', gate: 'G3' },
  { key: 'build', label: '04 Build', kind: 'phase', phase: 'build' },
  { key: 'verify', label: '05 Verify', kind: 'phase', phase: 'verify' },
  { key: 'review', label: '06 Review', kind: 'phase', phase: 'review' },
  { key: 'g4', label: 'G4', kind: 'gate', gate: 'G4' },
  { key: 'deploy', label: '07 Deploy', kind: 'phase', phase: 'deploy' },
  { key: 'g5', label: 'G5', kind: 'gate', gate: 'G5' },
  { key: 'retro', label: '08 Retro', kind: 'phase', phase: 'done' },
] as const;

/** Evenly spaced slots, the first one straight up. */
export function stationAngle(i: number): number {
  return (i * 360) / STATIONS.length;
}

/** The radial menu sits on the diagonals, which no station slot occupies. */
export const MENU_ANGLES = [45, 135, 225, 315] as const;

/** Phases in the order a change moves through them. */
export const PHASE_ORDER: readonly Phase[] = [
  'intent', 'spec', 'plan', 'build', 'verify', 'review', 'deploy', 'done',
] as const;

/** Position of a phase in the lifecycle, or -1 when there is no active change. */
export function phaseIndex(phase: Phase | null | undefined): number {
  if (!phase) return -1;
  return PHASE_ORDER.indexOf(phase);
}
