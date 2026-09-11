import { describe, it, expect } from 'vitest';
import { disc, none, glyph, vnoise, rampChar, DEFAULT_RAMP } from '@/lib/asciiMask';

describe('disc mask', () => {
  it('is 1 at the centre', () => {
    expect(disc(0.3)(0.5, 0.5)).toBe(1);
  });
  it('is 1 anywhere inside the radius, including on it', () => {
    expect(disc(0.3)(0.65, 0.5)).toBe(1);
    expect(disc(0.3)(0.5, 0.25)).toBe(1);
    expect(disc(0.3)(0.8, 0.5)).toBe(1); // exactly r from the centre
  });
  it('is 0 well outside the radius', () => {
    expect(disc(0.3)(0.95, 0.5)).toBe(0);
    expect(disc(0.3)(0, 0)).toBe(0);
  });
  it('softens over 0.08 past the radius, monotonically', () => {
    const m = disc(0.3);
    const edge = [0.81, 0.83, 0.85, 0.87].map((x) => m(x, 0.5));
    for (const v of edge) {
      expect(v).toBeGreaterThan(0);
      expect(v).toBeLessThan(1);
    }
    for (let i = 1; i < edge.length; i++) expect(edge[i]).toBeLessThan(edge[i - 1]);
    expect(m(0.5 + 0.3 + 0.08, 0.5)).toBe(0);
  });
});

describe('none mask', () => {
  it('returns 1 everywhere, even outside the unit square', () => {
    for (const [u, v] of [[0, 0], [0.5, 0.5], [1, 1], [-3, 7], [0.13, 0.97]]) {
      expect(none(u, v)).toBe(1);
    }
  });
});

describe('glyph mask', () => {
  it('falls back to none when there is no DOM', () => {
    expect(typeof document).toBe('undefined');
    expect(glyph('A', "'JetBrains Mono', monospace")).toBe(none);
  });
});

describe('vnoise (local value noise)', () => {
  it('is deterministic and within [0, 1] over a 20x20 grid', () => {
    for (let j = 0; j < 20; j++) {
      for (let i = 0; i < 20; i++) {
        const x = i * 0.37 - 2.5;
        const y = j * 0.53 - 1.1;
        const a = vnoise(x, y);
        const b = vnoise(x, y);
        expect(a).toBe(b);
        expect(a).toBeGreaterThanOrEqual(0);
        expect(a).toBeLessThanOrEqual(1);
        expect(Number.isFinite(a)).toBe(true);
      }
    }
  });
  it('is continuous: a tiny step moves the value only a little', () => {
    for (let i = 0; i < 50; i++) {
      const x = i * 0.61;
      const y = i * 0.29;
      expect(Math.abs(vnoise(x + 1e-3, y) - vnoise(x, y))).toBeLessThan(0.02);
      expect(Math.abs(vnoise(x, y + 1e-3) - vnoise(x, y))).toBeLessThan(0.02);
    }
  });
  it('is not constant', () => {
    const values = new Set<number>();
    for (let i = 0; i < 20; i++) values.add(vnoise(i * 0.7, i * 1.3));
    expect(values.size).toBeGreaterThan(10);
  });
});

describe('rampChar', () => {
  it('maps 0 to the first glyph and 1 to the last', () => {
    expect(rampChar(DEFAULT_RAMP, 0)).toBe(' ');
    expect(rampChar(DEFAULT_RAMP, 1)).toBe('@');
  });
  it('clamps out-of-range values', () => {
    expect(rampChar(DEFAULT_RAMP, -0.5)).toBe(' ');
    expect(rampChar(DEFAULT_RAMP, 1.7)).toBe('@');
  });
  it('walks the ramp in order', () => {
    const seen = [0, 0.15, 0.35, 0.55, 0.75, 0.95].map((v) => rampChar(DEFAULT_RAMP, v));
    const idx = seen.map((c) => DEFAULT_RAMP.indexOf(c));
    for (let i = 1; i < idx.length; i++) expect(idx[i]).toBeGreaterThan(idx[i - 1]);
  });
});
