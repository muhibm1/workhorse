import { describe, it, expect } from 'vitest';
import { polar, STATIONS, stationAngle, MENU_ANGLES, PHASE_ORDER, phaseIndex } from '@/lib/polar';
import { formatElapsed } from '@/components/Satellite';
import { isLocalPath, slugify } from '@/components/Markdown';

const EPS = 1e-9;

describe('polar', () => {
  it('puts 0° straight up', () => {
    const p = polar(100, 100, 50, 0);
    expect(Math.abs(p.x - 100)).toBeLessThan(EPS);
    expect(Math.abs(p.y - 50)).toBeLessThan(EPS);
  });
  it('puts 90° to the right (clockwise)', () => {
    const p = polar(100, 100, 50, 90);
    expect(Math.abs(p.x - 150)).toBeLessThan(EPS);
    expect(Math.abs(p.y - 100)).toBeLessThan(EPS);
  });
  it('puts 180° at the bottom', () => {
    const p = polar(100, 100, 50, 180);
    expect(Math.abs(p.x - 100)).toBeLessThan(EPS);
    expect(Math.abs(p.y - 150)).toBeLessThan(EPS);
  });
  it('puts 270° to the left', () => {
    const p = polar(100, 100, 50, 270);
    expect(Math.abs(p.x - 50)).toBeLessThan(EPS);
    expect(Math.abs(p.y - 100)).toBeLessThan(EPS);
  });
  it('honours the centre and radius', () => {
    const p = polar(320, 320, 240, 0);
    expect(Math.abs(p.x - 320)).toBeLessThan(EPS);
    expect(Math.abs(p.y - 80)).toBeLessThan(EPS);
  });
});

describe('station ring', () => {
  it('has 14 slots in the spec 2.2 order', () => {
    expect(STATIONS).toHaveLength(14);
    expect(STATIONS.map((s) => s.label)).toEqual([
      '00 Onboard', '01 Intent', 'G1', '02 Spec', 'G2', '03 Plan', 'G3',
      '04 Build', '05 Verify', '06 Review', 'G4', '07 Deploy', 'G5', '08 Retro',
    ]);
  });
  it('places G1..G5 at indices 2, 4, 6, 10, 12', () => {
    const gates = STATIONS.map((s, i) => (s.kind === 'gate' ? i : -1)).filter((i) => i >= 0);
    expect(gates).toEqual([2, 4, 6, 10, 12]);
    expect(gates.map((i) => STATIONS[i].gate)).toEqual(['G1', 'G2', 'G3', 'G4', 'G5']);
  });
  it('gives every gate slot a gate and every phase slot except Onboard a phase', () => {
    for (const s of STATIONS) {
      if (s.kind === 'gate') { expect(s.gate).toBeDefined(); expect(s.phase).toBeUndefined(); }
      else { expect(s.gate).toBeUndefined(); }
    }
    expect(STATIONS[0].phase).toBeUndefined();
    expect(STATIONS[13].phase).toBe('done');
  });
  it('has unique keys', () => {
    expect(new Set(STATIONS.map((s) => s.key)).size).toBe(14);
  });
  it('stationAngle(7) is 180 (Build sits at the bottom)', () => {
    expect(stationAngle(7)).toBe(180);
    expect(STATIONS[7].label).toBe('04 Build');
  });
  it('spaces the 14 slots evenly from the top', () => {
    expect(stationAngle(0)).toBe(0);
    expect(Math.abs(stationAngle(1) - 360 / 14)).toBeLessThan(EPS);
    expect(Math.abs(stationAngle(14) - 360)).toBeLessThan(EPS);
  });
  it('orders phases intent..done and indexes them', () => {
    expect(PHASE_ORDER).toEqual(['intent', 'spec', 'plan', 'build', 'verify', 'review', 'deploy', 'done']);
    expect(phaseIndex('intent')).toBe(0);
    expect(phaseIndex('done')).toBe(7);
    expect(phaseIndex(null)).toBe(-1);
  });
});

describe('MENU_ANGLES', () => {
  it('is the four diagonals', () => {
    expect([...MENU_ANGLES]).toEqual([45, 135, 225, 315]);
  });
  it('never lands on a station slot', () => {
    const slots = STATIONS.map((_, i) => stationAngle(i));
    for (const a of MENU_ANGLES) {
      expect(slots.some((s) => Math.abs(s - a) < EPS)).toBe(false);
    }
  });
});

describe('formatElapsed', () => {
  it('renders mm:ss', () => {
    expect(formatElapsed(0)).toBe('00:00');
    expect(formatElapsed(59_999)).toBe('00:59');
    expect(formatElapsed(60_000)).toBe('01:00');
    expect(formatElapsed(83 * 60_000 + 7_000)).toBe('83:07');
  });
  it('clamps negative to zero', () => {
    expect(formatElapsed(-5_000)).toBe('00:00');
  });
});

describe('Markdown link policy', () => {
  it('treats docs/ and src/ and scheme-less hrefs as repo paths', () => {
    expect(isLocalPath('docs/sdlc/x/spec.md')).toBe(true);
    expect(isLocalPath('src/main/index.ts')).toBe(true);
    expect(isLocalPath('README.md')).toBe(true);
    expect(isLocalPath('./docs/a.md')).toBe(true);
  });
  it('treats anything with a scheme, protocol-relative, or anchors as not a path', () => {
    expect(isLocalPath('https://example.com')).toBe(false);
    expect(isLocalPath('mailto:a@b.c')).toBe(false);
    expect(isLocalPath('file:///C:/x')).toBe(false);
    expect(isLocalPath('C:\\Users\\x')).toBe(false);
    expect(isLocalPath('//cdn.example.com/x')).toBe(false);
    expect(isLocalPath('#section')).toBe(false);
    expect(isLocalPath('')).toBe(false);
  });
  it('slugifies headings the GitHub way', () => {
    expect(slugify('Diff tour')).toBe('diff-tour');
    expect(slugify('2. What changed (and why)')).toBe('2-what-changed-and-why');
    expect(slugify('  Risks & rollback  ')).toBe('risks--rollback');
  });
});
