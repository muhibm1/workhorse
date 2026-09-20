/**
 * Gate names, as the person reads them. The digest carries `gate_names` from plugin 0.3.0 on
 * (hooks/scripts/lib.js `GATE_NAMES`); an older plugin's digest has none, so every reader goes
 * through here and falls back to the same table the plugin ships.
 */
import type { ChangeDigest, Gate } from './types';

/** Mirrors `GATE_NAMES` in hooks/scripts/lib.js. G1 and G3 keep their ids for state and
 *  approvals but no tier requires them (two-gates design, section 2). */
export const GATE_NAME_FALLBACK: Readonly<Record<Gate, string>> = {
  G1: 'Intent',
  G2: 'Design',
  G3: 'Plan',
  G4: 'Ship',
  G5: 'Deploy',
};

export const GATE_IDS: readonly Gate[] = ['G1', 'G2', 'G3', 'G4', 'G5'];

export function isGate(value: unknown): value is Gate {
  return typeof value === 'string' && (GATE_IDS as readonly string[]).includes(value);
}

/** "Ship" for G4: the digest's own name when it has one, else the fallback table. */
export function gateName(digest: Pick<ChangeDigest, 'gate_names'> | null | undefined, gate: Gate): string {
  const named = digest?.gate_names?.[gate];
  return typeof named === 'string' && named.trim() !== '' ? named : GATE_NAME_FALLBACK[gate];
}

/** "Ship (G4)": the name and the id together, for anywhere a gate is shown to the person. */
export function gateLabel(digest: Pick<ChangeDigest, 'gate_names'> | null | undefined, gate: Gate): string {
  return `${gateName(digest, gate)} (${gate})`;
}
