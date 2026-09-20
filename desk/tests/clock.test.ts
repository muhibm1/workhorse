/**
 * The clock block on the Run screen, as data (renderer/lib/clock.ts). There is no DOM test
 * harness in this suite (vitest runs in the node environment), so the block's rows, bar width
 * and over-budget verdict are tested here and Run.tsx only lays them out.
 */
import { describe, expect, it } from 'vitest';
import { budgetFraction, clockRows, formatMinutes, overBudget } from '@/lib/clock';
import type { Clock } from '@shared/types';

function clock(overrides: Partial<Clock> = {}): Clock {
  return {
    agent_minutes: 26, waiting_minutes: 12, dead_minutes: 0, gap_minutes: 0, wall_minutes: 40,
    human_minutes: null, budget_minutes: 30, within_budget: true, tier: 1, done: false,
    phases: [{ phase: 'design', agent_minutes: 10 }, { phase: 'build', agent_minutes: 16 }],
    gaps: [], events: 9,
    started_at: '2026-09-19T09:00:00.000Z', ended_at: '2026-09-19T09:40:00.000Z',
    ...overrides,
  };
}

describe('formatMinutes', () => {
  it('formats the way the plugin does: "26 m", "1 h 05 m"', () => {
    expect(formatMinutes(26)).toBe('26 m');
    expect(formatMinutes(26.4)).toBe('26 m');
    expect(formatMinutes(0)).toBe('0 m');
    expect(formatMinutes(65)).toBe('1 h 05 m');
    expect(formatMinutes(180)).toBe('3 h 00 m');
  });
  it('never shows a negative time', () => {
    expect(formatMinutes(-3)).toBe('0 m');
  });
});

describe('clockRows', () => {
  it('shows agents against the budget, waiting and dead time', () => {
    expect(clockRows(clock())).toEqual([
      { key: 'agents', label: 'Agents', value: '26 m of 30 m' },
      { key: 'waiting', label: 'Waiting on you', value: '12 m' },
      { key: 'dead', label: 'Dead', value: '0 m' },
    ]);
  });
  it('adds "Your time" only once a gate opened in Paddock has been decided', () => {
    expect(clockRows(clock({ human_minutes: 4.6 })).at(-1)).toEqual({ key: 'human', label: 'Your time', value: '5 m' });
    expect(clockRows(clock({ human_minutes: 0 })).at(-1)).toEqual({ key: 'human', label: 'Your time', value: '0 m' });
    expect(clockRows(clock({ human_minutes: null })).map((r) => r.key)).not.toContain('human');
  });
  it('is empty for a digest from a plugin before 0.3.0', () => {
    expect(clockRows(undefined)).toEqual([]);
    expect(clockRows(null)).toEqual([]);
  });
});

describe('budgetFraction / overBudget', () => {
  it('is agent minutes over the budget, clamped at full', () => {
    expect(budgetFraction(clock({ agent_minutes: 15, budget_minutes: 30 }))).toBeCloseTo(0.5);
    expect(budgetFraction(clock({ agent_minutes: 45, budget_minutes: 30 }))).toBe(1);
    expect(budgetFraction(clock({ agent_minutes: 0 }))).toBe(0);
    expect(budgetFraction(undefined)).toBe(0);
  });
  it('treats a zero budget as full once anything was spent', () => {
    expect(budgetFraction(clock({ agent_minutes: 0, budget_minutes: 0 }))).toBe(0);
    expect(budgetFraction(clock({ agent_minutes: 1, budget_minutes: 0 }))).toBe(1);
  });
  it('turns coral on the plugin\'s own within_budget verdict, not a recomputation', () => {
    expect(overBudget(clock({ within_budget: true }))).toBe(false);
    expect(overBudget(clock({ within_budget: false }))).toBe(true);
    expect(overBudget(undefined)).toBe(false);
  });
});
