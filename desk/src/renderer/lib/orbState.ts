// Pure mapping from run state to what the orb should render. No DOM, no timers: the animation
// itself (fades, frame painting) lives in components/Orb.tsx. Spec: 2026-09-10-paddock-desktop-design.md 3.1.
import type { Phase, Gate } from '@shared/types';

/**
 * The nine states the `thinking-orbs` engine ships (its own `OrbState` union, re-declared here
 * so this module has no import-time dependency on the animation library). Kept byte-for-byte
 * equal to `thinking-orbs`' `OrbState` — Orb.tsx uses this type interchangeably with the
 * library's own via `thinking-orbs/engine`'s `STATE_TO_MODE` lookup.
 */
export type OrbState =
  | 'working'
  | 'searching'
  | 'solving'
  | 'listening'
  | 'connecting'
  | 'weaving'
  | 'composing'
  | 'breathing'
  | 'shaping';

export type RingTone = 'none' | 'cyan' | 'amber' | 'coral' | 'mint';

export interface OrbSpec {
  state: OrbState;
  speed: number;
  ring: RingTone;
  pulse: boolean;
}

export interface OrbSpecInput {
  phase: Phase | null;
  blockingGate: Gate | null;
  running: boolean;
  error: boolean;
  done: boolean;
}

/**
 * Phase rows of the spec 3.1 table. `done` is handled by the `done` flag, not by this map.
 * Plugin 0.3 folded intent, spec and plan into one `design` phase; it takes the spec row's
 * state, and the three legacy rows stay so an older change's digest still gets a phase orb.
 */
const PHASE_ORB: Partial<Record<Phase, { state: OrbState; speed: number }>> = {
  design: { state: 'weaving', speed: 1 },
  intent: { state: 'composing', speed: 1 },
  spec: { state: 'weaving', speed: 1 },
  plan: { state: 'shaping', speed: 1 },
  build: { state: 'working', speed: 1 },
  verify: { state: 'solving', speed: 1 },
  review: { state: 'searching', speed: 1 },
  deploy: { state: 'connecting', speed: 1 },
};

/**
 * Resolve the orb's visual spec from merged run state, per spec 3.1's table.
 *
 * Precedence — first match wins: `error` > `blockingGate` > `done` > `phase` > idle
 * ("no active change"). `running` is accepted for shape-completeness (it mirrors the field the
 * store carries) but does not gate a branch of its own: the table has no row that depends on
 * "running" independent of phase/blockingGate/done/error, so it is intentionally unused here.
 */
export function orbSpecFor(input: OrbSpecInput): OrbSpec {
  // Every speed is 1: the orb moves at the library's own tuned rate (libraries.dev/orbs), and
  // the state it shows, its colour and the gate pulse carry the meaning instead.
  if (input.error) {
    return { state: 'breathing', speed: 1, ring: 'coral', pulse: false };
  }
  if (input.blockingGate) {
    return { state: 'breathing', speed: 1, ring: 'amber', pulse: true };
  }
  if (input.done) {
    return { state: 'breathing', speed: 1, ring: 'mint', pulse: false };
  }
  const mapped = input.phase ? PHASE_ORB[input.phase] : undefined;
  if (mapped) {
    return { state: mapped.state, speed: mapped.speed, ring: 'cyan', pulse: false };
  }
  return { state: 'breathing', speed: 1, ring: 'none', pulse: false };
}
