import { describe, it, expect } from 'vitest';
import { IPC } from '@shared/types';
describe('IPC channel table', () => {
  it('has no duplicate channel names', () => {
    const values = Object.values(IPC);
    expect(new Set(values).size).toBe(values.length);
  });
});
