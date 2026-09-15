import { describe, it, expect } from 'vitest';
import { resolvePreset, STATE_TO_MODE } from 'thinking-orbs/engine';
import { FULL_SIZE_PROFILES, fullSizePreset } from '../src/renderer/lib/orbProfile';
import type { OrbState } from '../src/renderer/lib/orbState';

const STATES = Object.keys(STATE_TO_MODE) as OrbState[];
/** Keys the presets add on top of a profile: per-state extras and the icon-size radius factor. */
const PRESET_ONLY = new Set(['rSizeMul', 'scanMul', 'dimBase', 'spin', 'bandMul', 'wobMul', 'spread']);

describe('FULL_SIZE_PROFILES mirrors the engine', () => {
  it('matches the one 64px preset the engine leaves unscaled (orbits: count 1, size 1)', () => {
    expect(resolvePreset('working', 64).opts).toEqual(FULL_SIZE_PROFILES.orbits);
  });

  it.each(STATES)('%s: same option names as the engine preset, same unscaled values', (state) => {
    const preset = resolvePreset(state, 64);
    const base = FULL_SIZE_PROFILES[preset.mode];
    const presetKeys = Object.keys(preset.opts).filter((k) => !PRESET_ONLY.has(k)).sort();
    expect(presetKeys).toEqual(Object.keys(base).sort());
    expect(preset.opts.rsPow).toBe(base.rsPow);
    expect(preset.opts.rMin).toBe(base.rMin);
  });
});

describe('fullSizePreset', () => {
  it.each(STATES)('%s: keeps the 64px motion and extras, restores full-size counts', (state) => {
    const preset = resolvePreset(state, 64);
    const full = fullSizePreset(state);
    expect(full.mode).toBe(preset.mode);
    expect(full.speed).toBe(preset.speed);
    expect(full.opts.rSizeMul).toBeUndefined();
    for (const key of Object.keys(preset.opts)) {
      if (PRESET_ONLY.has(key) && key !== 'rSizeMul') expect(full.opts[key]).toBe(preset.opts[key]);
    }
    for (const [key, value] of Object.entries(FULL_SIZE_PROFILES[preset.mode])) {
      expect(full.opts[key]).toBe(value);
    }
  });
});
