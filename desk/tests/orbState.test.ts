import { describe, it, expect } from 'vitest';
import { orbSpecFor } from '../src/renderer/lib/orbState';
import type { Phase } from '../src/shared/types';

const idle = { phase: null as Phase | null, blockingGate: null, running: false, error: false, done: false };

describe('orbSpecFor (spec 3.1 table)', () => {
  it('no active change -> breathing, 0.6, none', () => {
    expect(orbSpecFor(idle)).toEqual({ state: 'breathing', speed: 0.6, ring: 'none', pulse: false });
  });

  it('intent -> composing, 1, cyan', () => {
    expect(orbSpecFor({ ...idle, phase: 'intent', running: true })).toEqual({
      state: 'composing', speed: 1, ring: 'cyan', pulse: false,
    });
  });

  it('spec -> weaving, 1, cyan', () => {
    expect(orbSpecFor({ ...idle, phase: 'spec', running: true })).toEqual({
      state: 'weaving', speed: 1, ring: 'cyan', pulse: false,
    });
  });

  it('plan -> shaping, 1, cyan', () => {
    expect(orbSpecFor({ ...idle, phase: 'plan', running: true })).toEqual({
      state: 'shaping', speed: 1, ring: 'cyan', pulse: false,
    });
  });

  it('build -> working, 1.2, cyan', () => {
    expect(orbSpecFor({ ...idle, phase: 'build', running: true })).toEqual({
      state: 'working', speed: 1.2, ring: 'cyan', pulse: false,
    });
  });

  it('verify -> solving, 1, cyan', () => {
    expect(orbSpecFor({ ...idle, phase: 'verify', running: true })).toEqual({
      state: 'solving', speed: 1, ring: 'cyan', pulse: false,
    });
  });

  it('review -> searching, 1, cyan', () => {
    expect(orbSpecFor({ ...idle, phase: 'review', running: true })).toEqual({
      state: 'searching', speed: 1, ring: 'cyan', pulse: false,
    });
  });

  it('deploy -> connecting, 1, cyan', () => {
    expect(orbSpecFor({ ...idle, phase: 'deploy', running: true })).toEqual({
      state: 'connecting', speed: 1, ring: 'cyan', pulse: false,
    });
  });

  it('stopped at a gate -> breathing, 0.5, amber, pulsing', () => {
    expect(orbSpecFor({ ...idle, phase: 'spec', blockingGate: 'G2' })).toEqual({
      state: 'breathing', speed: 0.5, ring: 'amber', pulse: true,
    });
  });

  it('run error -> breathing, 0.3, coral, static', () => {
    expect(orbSpecFor({ ...idle, phase: 'build', error: true, running: true })).toEqual({
      state: 'breathing', speed: 0.3, ring: 'coral', pulse: false,
    });
  });

  it('done -> breathing, 0.6, mint', () => {
    expect(orbSpecFor({ ...idle, phase: 'done', done: true })).toEqual({
      state: 'breathing', speed: 0.6, ring: 'mint', pulse: false,
    });
  });

  describe('precedence: error > blockingGate > done > phase > idle', () => {
    it('error wins over a set phase and a blocking gate', () => {
      expect(orbSpecFor({ phase: 'build', blockingGate: 'G4', running: true, error: true, done: false })).toEqual({
        state: 'breathing', speed: 0.3, ring: 'coral', pulse: false,
      });
    });

    it('blockingGate wins over running and phase (running: true does not override it)', () => {
      expect(orbSpecFor({ phase: 'plan', blockingGate: 'G3', running: true, error: false, done: false })).toEqual({
        state: 'breathing', speed: 0.5, ring: 'amber', pulse: true,
      });
    });
  });
});
