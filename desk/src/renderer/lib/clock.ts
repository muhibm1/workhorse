/**
 * The clock block on the Run screen, as data: what `digest.clock` (the plugin's `WH clock`,
 * hooks/scripts/lib.js `computeClock`) says, formatted the way the plugin formats it, so the
 * Run screen and `ship.md` read the same. Pure so it is testable without a DOM; Run.tsx only
 * lays the rows out.
 */
import type { Clock } from '@shared/types';

/** "26 m", "1 h 05 m": mirrors `fmtMinutes` in hooks/scripts/lib.js. */
export function formatMinutes(minutes: number): string {
  const n = Math.max(0, Math.round(minutes));
  return n >= 60 ? `${Math.floor(n / 60)} h ${String(n % 60).padStart(2, '0')} m` : `${n} m`;
}

export interface ClockRow {
  key: 'agents' | 'waiting' | 'dead' | 'human';
  label: string;
  value: string;
}

/** The rows the block shows, in order. "Your time" appears only once a gate opened in Paddock
 *  has been decided (`human_minutes` non-null). */
export function clockRows(clock: Clock | null | undefined): ClockRow[] {
  if (!clock) return [];
  const rows: ClockRow[] = [
    { key: 'agents', label: 'Agents', value: `${formatMinutes(clock.agent_minutes)} of ${formatMinutes(clock.budget_minutes)}` },
    { key: 'waiting', label: 'Waiting on you', value: formatMinutes(clock.waiting_minutes) },
    { key: 'dead', label: 'Dead', value: formatMinutes(clock.dead_minutes) },
  ];
  if (clock.human_minutes !== null && clock.human_minutes !== undefined) {
    rows.push({ key: 'human', label: 'Your time', value: formatMinutes(clock.human_minutes) });
  }
  return rows;
}

/** Width of the budget bar, 0..1: agent minutes over the budget, clamped at full. A zero budget
 *  (a profile override of 0) reads as full once any agent minute has been spent. */
export function budgetFraction(clock: Clock | null | undefined): number {
  if (!clock) return 0;
  if (clock.budget_minutes <= 0) return clock.agent_minutes > 0 ? 1 : 0;
  return Math.min(clock.agent_minutes / clock.budget_minutes, 1);
}

/** The bar turns coral once the agents are over budget. Reads the plugin's own verdict rather
 *  than recomputing it, so a rounding difference can never make the two disagree. */
export function overBudget(clock: Clock | null | undefined): boolean {
  return Boolean(clock) && !clock!.within_budget;
}
