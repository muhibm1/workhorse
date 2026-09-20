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

describe('station ring (two-gates design, section 5)', () => {
  it('has 10 slots: six phases, three named gates, Onboard first', () => {
    expect(STATIONS).toHaveLength(10);
    expect(STATIONS.map((s) => s.label)).toEqual([
      '00 Onboard', '01 Design', 'Design', '02 Build', '03 Verify', '04 Review', 'Ship', '05 Deploy', 'Deploy', '06 Retro',
    ]);
  });
  it('places the Design, Ship and Deploy gates at indices 2, 6, 8 with their ids', () => {
    const gates = STATIONS.map((s, i) => (s.kind === 'gate' ? i : -1)).filter((i) => i >= 0);
    expect(gates).toEqual([2, 6, 8]);
    expect(gates.map((i) => STATIONS[i].gate)).toEqual(['G2', 'G4', 'G5']);
  });
  it('has no slot for G1 or G3, which no tier requires', () => {
    expect(STATIONS.some((s) => s.gate === 'G1' || s.gate === 'G3')).toBe(false);
  });
  it('gives every gate slot a gate and every phase slot except Onboard a phase', () => {
    for (const s of STATIONS) {
      if (s.kind === 'gate') { expect(s.gate).toBeDefined(); expect(s.phase).toBeUndefined(); }
      else { expect(s.gate).toBeUndefined(); }
    }
    expect(STATIONS[0].phase).toBeUndefined();
    expect(STATIONS.slice(1).filter((s) => s.kind === 'phase').map((s) => s.phase)).toEqual(PHASE_ORDER);
    expect(STATIONS[9].phase).toBe('done');
  });
  it('has unique keys', () => {
    expect(new Set(STATIONS.map((s) => s.key)).size).toBe(10);
  });
  it('spaces the 10 slots evenly from the top, 36 degrees apart', () => {
    expect(stationAngle(0)).toBe(0);
    expect(Math.abs(stationAngle(1) - 36)).toBeLessThan(EPS);
    expect(stationAngle(5)).toBe(180);
    expect(STATIONS[5].label).toBe('04 Review');
    expect(Math.abs(stationAngle(10) - 360)).toBeLessThan(EPS);
  });
  it('orders phases design..done and indexes them', () => {
    expect(PHASE_ORDER).toEqual(['design', 'build', 'verify', 'review', 'deploy', 'done']);
    expect(phaseIndex('design')).toBe(0);
    expect(phaseIndex('build')).toBe(1);
    expect(phaseIndex('done')).toBe(5);
    expect(phaseIndex(null)).toBe(-1);
    expect(phaseIndex(undefined)).toBe(-1);
  });
  it('reads the legacy intent, spec and plan phases as design, so an older change still lights the ring', () => {
    expect(phaseIndex('intent')).toBe(phaseIndex('design'));
    expect(phaseIndex('spec')).toBe(phaseIndex('design'));
    expect(phaseIndex('plan')).toBe(phaseIndex('design'));
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
