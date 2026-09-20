import { describe, expect, it } from 'vitest';
import { GATE_NAME_FALLBACK, gateLabel, gateName, isGate } from '@shared/gates';

describe('gate names (shared/gates.ts)', () => {
  it('falls back to the plugin\'s own table when the digest carries no gate_names', () => {
    expect(GATE_NAME_FALLBACK).toEqual({ G1: 'Intent', G2: 'Design', G3: 'Plan', G4: 'Ship', G5: 'Deploy' });
    expect(gateName(null, 'G4')).toBe('Ship');
    expect(gateName(undefined, 'G2')).toBe('Design');
    expect(gateName({}, 'G5')).toBe('Deploy');
  });

  it('prefers the digest\'s gate_names, and ignores a blank one', () => {
    const names = { G1: 'Intent', G2: 'Blueprint', G3: 'Plan', G4: '', G5: 'Deploy' };
    expect(gateName({ gate_names: names }, 'G2')).toBe('Blueprint');
    expect(gateName({ gate_names: names }, 'G4')).toBe('Ship');
  });

  it('labels a gate with its name and id, "Ship (G4)"', () => {
    expect(gateLabel(null, 'G4')).toBe('Ship (G4)');
    expect(gateLabel({ gate_names: { G1: 'Intent', G2: 'Design', G3: 'Plan', G4: 'Release', G5: 'Deploy' } }, 'G4')).toBe('Release (G4)');
  });

  it('isGate admits only G1..G5', () => {
    for (const g of ['G1', 'G2', 'G3', 'G4', 'G5']) expect(isGate(g)).toBe(true);
    for (const bad of ['G0', 'G6', 'g4', 'G4.x', '', null, undefined, 4]) expect(isGate(bad)).toBe(false);
  });
});
