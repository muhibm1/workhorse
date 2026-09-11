import { afterEach, describe, expect, it } from 'vitest';
import { applyEvent, createRunState, usePaddockStore, type RunState } from '../src/renderer/store';
import type { ChangeDigest, PaddockApi, RunEnvelope, RunEvent, SysCheck } from '../src/shared/types';

function envelope(event: RunEvent, repoId = 'repo1', runId = 'run1'): RunEnvelope {
  return { runId, repoId, event };
}

describe('applyEvent (pure reducer)', () => {
  it('threads a hand-written start/tool/progress/stop/result sequence to the expected state', () => {
    let run = createRunState();

    run = applyEvent(run, envelope({ t: 'agent:start', agentId: 'a1', agentType: 'wh-builder', description: 'build it', toolUseId: 'tu1', at: 10 }));
    expect(run.agents.a1).toEqual({ agentType: 'wh-builder', description: 'build it', startedAt: 10 });
    expect(run.runId).toBe('run1');

    run = applyEvent(run, envelope({ t: 'tool', toolUseId: 'tu2', name: 'Bash', agentId: 'a1', at: 20 }));
    expect(run.log).toEqual([{ at: 20, text: '[builder] tool Bash' }]);

    run = applyEvent(run, envelope({ t: 'agent:progress', agentId: 'a1', lastTool: 'Bash', totalTokens: 500, toolUses: 1, at: 25 }));
    // agent:progress carries no field RunState tracks: agents and log are unchanged.
    expect(run.agents.a1).toEqual({ agentType: 'wh-builder', description: 'build it', startedAt: 10 });
    expect(run.log).toHaveLength(1);

    run = applyEvent(run, envelope({ t: 'agent:stop', agentId: 'a1', agentType: 'wh-builder', summary: 'done', totalTokens: 900, durationMs: 30, at: 40 }));
    expect(run.agents.a1).toEqual({ agentType: 'wh-builder', description: 'build it', startedAt: 10, stoppedAt: 40 });
    expect(run.running).toBe(true); // agent:stop alone does not stop the run

    run = applyEvent(run, envelope({ t: 'result', subtype: 'success', costUsd: 0.42, numTurns: 3, durationMs: 100, sessionId: 's1', at: 50 }));
    expect(run.running).toBe(false);
    expect(run.costUsd).toBe(0.42);
    expect(run.log.at(-1)).toEqual({ at: 50, text: 'result: success', tone: 'mint' });
  });

  it('attributes a tool call to the right agent by short name, and leaves an unattributed one plain', () => {
    let run = createRunState('run1');
    run = applyEvent(run, envelope({ t: 'agent:start', agentId: 'a1', agentType: 'wh-verifier', description: '', toolUseId: 'tu1', at: 1 }));
    run = applyEvent(run, envelope({ t: 'tool', toolUseId: 'tu2', name: 'Read', agentId: 'a1', at: 2 }));
    run = applyEvent(run, envelope({ t: 'tool', toolUseId: 'tu3', name: 'Agent', at: 3 }));
    expect(run.log).toEqual([
      { at: 2, text: '[verifier] tool Read' },
      { at: 3, text: 'tool Agent' },
    ]);
  });

  it('agent:stop for an agent with no recorded start still records a stoppedAt', () => {
    let run = createRunState('run1');
    run = applyEvent(run, envelope({ t: 'agent:stop', agentId: 'ghost', agentType: 'wh-fixer', at: 5 }));
    expect(run.agents.ghost).toEqual({ agentType: 'wh-fixer', description: '', startedAt: 5, stoppedAt: 5 });
  });

  it('text appends only the first 160 characters', () => {
    let run = createRunState('run1');
    const long = 'x'.repeat(200);
    run = applyEvent(run, envelope({ t: 'text', text: long, at: 1 }));
    expect(run.log[0].text).toBe('x'.repeat(160));
    expect(run.log[0].text).toHaveLength(160);
  });

  it('error records the message and a coral log line, but does not itself stop the run', () => {
    let run = createRunState('run1');
    run = applyEvent(run, envelope({ t: 'error', message: 'boom', at: 1 }));
    expect(run.error).toBe('boom');
    expect(run.running).toBe(true);
    expect(run.log[0]).toEqual({ at: 1, text: 'error: boom', tone: 'coral' });

    run = applyEvent(run, envelope({ t: 'exit', code: 1, at: 2 }));
    expect(run.running).toBe(false);
  });

  it('caps the log at 500 lines, dropping the oldest first', () => {
    let run = createRunState('run1');
    for (let i = 0; i < 520; i += 1) {
      run = applyEvent(run, envelope({ t: 'text', text: `line ${i}`, at: i }));
    }
    expect(run.log).toHaveLength(500);
    expect(run.log[0].text).toBe('line 20'); // the first 20 (0..19) were dropped
    expect(run.log.at(-1)?.text).toBe('line 519');
  });
});

function digest(change_id: string, updated_at: string): ChangeDigest {
  return {
    change_id, title: change_id, client: 'c', repo: 'r',
    tier: 1, tier_reason: '', phase: 'build', mode: 'normal',
    status_label: '', waiting_on: '', blocking_gate: null,
    gates: { G1: 'approved', G2: 'approved', G3: 'approved', G4: 'pending', G5: 'pending' },
    required_human_gates: [], verification: 'none',
    branch: '', pr_url: '', commit: '',
    problem: '', outcome: '', tldr: '', decisions: [],
    last_approval: null, artifacts: [], artifact_dir: '',
    tracker: { provider: '', database: '', page_id: null },
    updated_at,
  };
}

describe('applyDigest / activeDigest', () => {
  afterEach(() => {
    usePaddockStore.setState({ digests: {}, runs: {}, repos: [], sys: null, settings: null, hasApiKey: false, screen: { name: 'setup' } });
  });

  it('stores a repo\'s digests ordered newest updated_at first, regardless of input order', () => {
    const oldest = digest('c1', '2026-01-01T00:00:00.000Z');
    const middle = digest('c2', '2026-01-02T00:00:00.000Z');
    const newest = digest('c3', '2026-01-03T00:00:00.000Z');

    usePaddockStore.getState().applyDigest('repo1', [oldest, newest, middle]);

    expect(usePaddockStore.getState().digests.repo1.map((d) => d.change_id)).toEqual(['c3', 'c2', 'c1']);
  });

  it('activeDigest returns the newest by updated_at, and null when none has arrived', () => {
    expect(usePaddockStore.getState().activeDigest('repo1')).toBeNull();

    const older = digest('c1', '2026-01-01T00:00:00.000Z');
    const newer = digest('c2', '2026-01-05T00:00:00.000Z');
    usePaddockStore.getState().applyDigest('repo1', [older, newer]);

    expect(usePaddockStore.getState().activeDigest('repo1')?.change_id).toBe('c2');
  });
});

describe('window.paddock isolation via the api() accessor', () => {
  afterEach(() => {
    delete (globalThis as { window?: unknown }).window;
    usePaddockStore.setState({ digests: {}, runs: {}, repos: [], sys: null, settings: null, hasApiKey: false, screen: { name: 'setup' } });
  });

  it('boot() drives entirely off a stubbed globalThis.window.paddock, no real preload bridge', async () => {
    const sys: SysCheck = {
      node: { ok: true, version: '20.0.0', path: '/usr/bin/node' },
      claude: { ok: true, version: '1.0.0', path: '/usr/bin/claude' },
      plugin: { path: '/plugin', version: '0.2.0', bundled: true },
    };
    // A plain `let` reassigned only inside a nested closure keeps TypeScript's control-flow
    // analysis convinced it is still `null` at every later read (a known CFA limitation) — a
    // property on a captured object sidesteps that, since property narrowing isn't affected.
    const captured: {
      onEvent: ((e: RunEnvelope) => void) | null;
      onDigest: ((e: { repoId: string; digests: ChangeDigest[] }) => void) | null;
    } = { onEvent: null, onDigest: null };

    const fakePaddock: Partial<PaddockApi> = {
      system: { check: async () => sys },
      settings: {
        get: async () => ({ backend: 'cli', pluginPath: null, allowedTools: {}, theme: 'dark' }),
        set: async (p) => ({ backend: 'cli', pluginPath: null, allowedTools: {}, theme: 'dark', ...p }),
        setApiKey: async () => {},
        hasApiKey: async () => false,
        clearApiKey: async () => {},
      },
      repos: {
        list: async () => [{ id: 'repo1', path: '/repo1', name: 'repo1', addedAt: '2026-01-01T00:00:00.000Z' }],
        add: async (path) => ({ id: 'repo1', path, name: 'repo1', addedAt: '2026-01-01T00:00:00.000Z' }),
        remove: async () => {},
        pickFolder: async () => null,
      },
      fleet: { digest: async () => [digest('c1', '2026-01-01T00:00:00.000Z')] },
      run: {
        start: async () => ({ runId: 'run1' }),
        resume: async () => ({ runId: 'run1' }),
        stop: async () => {},
        onEvent: (cb) => {
          captured.onEvent = cb;
          return () => { captured.onEvent = null; };
        },
      },
      watch: {
        onDigest: (cb) => {
          captured.onDigest = cb;
          return () => { captured.onDigest = null; };
        },
      },
    };
    (globalThis as { window?: unknown }).window = { paddock: fakePaddock as PaddockApi };

    await usePaddockStore.getState().boot();

    const state = usePaddockStore.getState();
    expect(state.sys).toEqual(sys);
    expect(state.hasApiKey).toBe(false);
    expect(state.repos).toEqual([{ id: 'repo1', path: '/repo1', name: 'repo1', addedAt: '2026-01-01T00:00:00.000Z' }]);
    expect(state.digests.repo1?.[0].change_id).toBe('c1');
    expect(state.screen).toEqual({ name: 'fleet' });

    // boot() subscribed to both streams; feeding them drives the store further.
    expect(captured.onEvent).not.toBeNull();
    captured.onEvent?.({ runId: 'run1', repoId: 'repo1', event: { t: 'init', sessionId: 's1', plugins: [], skills: [], at: 1 } });
    expect((usePaddockStore.getState().runs.repo1 as RunState).sessionId).toBe('s1');

    expect(captured.onDigest).not.toBeNull();
    captured.onDigest?.({ repoId: 'repo1', digests: [digest('c2', '2026-02-01T00:00:00.000Z')] });
    expect(usePaddockStore.getState().digests.repo1?.[0].change_id).toBe('c2');
  });
});
