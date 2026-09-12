import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { createNormaliser } from '../src/main/drivers/normalise';

const lines = readFileSync('fixtures/stream-json/explore-subagent.ndjson', 'utf8')
  .split(/\r?\n/).filter(Boolean).map((l) => JSON.parse(l));

function run() { const n = createNormaliser(() => 1000); return lines.flatMap(n); }

describe('normalise (explore-subagent fixture)', () => {
  it('emits init first with the workhorse plugin and its skills', () => {
    const ev = run();
    expect(ev[0]).toMatchObject({ t: 'init', plugins: expect.arrayContaining(['workhorse']) });
    expect((ev[0] as any).skills).toContain('workhorse:run');
  });
  it('pairs agent:start and agent:stop for the Explore subagent', () => {
    const ev = run();
    const start = ev.find((e) => e.t === 'agent:start') as any;
    const stop = ev.find((e) => e.t === 'agent:stop') as any;
    expect(start).toMatchObject({ agentType: 'Explore', agentId: 'a4902cef8f1357703' });
    expect(stop).toMatchObject({ agentType: 'Explore', agentId: 'a4902cef8f1357703' });
    expect(ev.filter((e) => e.t === 'agent:stop')).toHaveLength(1); // task_updated must not double-stop
  });
  it('attributes the subagent Bash tool call to the agent', () => {
    const ev = run();
    const tool = ev.find((e) => e.t === 'tool' && (e as any).name === 'Bash') as any;
    expect(tool.agentId).toBe('a4902cef8f1357703');
  });
  it('leaves top-level tool calls unattributed', () => {
    const ev = run();
    const agentTool = ev.find((e) => e.t === 'tool' && (e as any).name === 'Agent') as any;
    expect(agentTool.agentId).toBeUndefined();
  });
  it('ends with a result carrying cost', () => {
    const ev = run();
    const last = ev[ev.length - 1] as any;
    expect(last.t).toBe('result');
    expect(last.costUsd).toBeCloseTo(0.386728, 5);
  });
  it('ignores hook and thinking chatter', () => {
    const ev = run();
    expect(ev.some((e) => (e as any).t === 'hook')).toBe(false);
    expect(ev.filter((e) => e.t === 'text').map((e: any) => e.text)).toContain('done');
  });
  it('tolerates garbage input', () => {
    const n = createNormaliser(() => 0);
    expect(n(null)).toEqual([]); expect(n('x')).toEqual([]); expect(n({})).toEqual([]);
  });
});

describe('normalise (error results)', () => {
  const n = () => createNormaliser(() => 9);

  it('turns an is_error result into a result plus an error carrying the reason', () => {
    // The shape a run ended with 115 times in a live test: subtype "success", is_error true.
    const ev = n()({
      type: 'result', subtype: 'success', is_error: true, total_cost_usd: 0,
      result: "You've hit your session limit · resets 2:40am (America/Chicago)",
    });
    expect(ev).toEqual([
      { t: 'result', subtype: 'success', costUsd: 0, isError: true, at: 9 },
      { t: 'error', message: "You've hit your session limit · resets 2:40am (America/Chicago)", at: 9 },
    ]);
  });

  it('falls back to the errors list, then the subtype, when there is no result text', () => {
    expect(n()({ type: 'result', subtype: 'error_during_execution', errors: ['a', 'b'] })[1])
      .toEqual({ t: 'error', message: 'a; b', at: 9 });
    expect(n()({ type: 'result', subtype: 'error_max_turns' })[1])
      .toEqual({ t: 'error', message: 'run ended: error_max_turns', at: 9 });
  });

  it('a successful result stays a single event with no isError flag', () => {
    const ev = n()({ type: 'result', subtype: 'success', is_error: false, result: 'done' });
    expect(ev).toEqual([{ t: 'result', subtype: 'success', at: 9 }]);
  });
});
