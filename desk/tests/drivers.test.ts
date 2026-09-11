import { EventEmitter } from 'node:events';
import { readFileSync } from 'node:fs';
import { PassThrough } from 'node:stream';
import type { ChildProcess } from 'node:child_process';
import { describe, it, expect, vi } from 'vitest';
import type { RunEvent } from '@shared/types';
import { createNormaliser } from '../src/main/drivers/normalise';
import { createCliDriver } from '../src/main/drivers/cli';
import { createSdkDriver } from '../src/main/drivers/sdk';

// Hoisted by vitest above these imports; intercepts createSdkDriver's dynamic import of the
// SDK for every test in this file (only the "import fails" test below ever triggers it).
vi.mock('@anthropic-ai/claude-agent-sdk', () => {
  throw new Error('sdk not installed');
});

const FIXTURE_PATH = 'fixtures/stream-json/explore-subagent.ndjson';
const FIXTURE_RAW = readFileSync(FIXTURE_PATH, 'utf8');
const FIXTURE_MESSAGES = FIXTURE_RAW.split(/\r?\n/).filter(Boolean).map((l) => JSON.parse(l));

/** Waits a tick so pending stream 'data' events (and their driver-side handlers) have run. */
function flush(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

/** A fake child_process.ChildProcess: an EventEmitter (for 'close') with PassThrough
 *  stdout/stderr (writable by the test to simulate the process's output, readable by the
 *  driver) and a spied `kill`. */
function fakeChild() {
  const child = new EventEmitter() as EventEmitter & Partial<ChildProcess>;
  child.stdout = new PassThrough();
  child.stderr = new PassThrough();
  child.kill = vi.fn(() => true);
  return child as unknown as ChildProcess & { stdout: PassThrough; stderr: PassThrough; kill: ReturnType<typeof vi.fn> };
}

async function collect(events: AsyncIterable<RunEvent>): Promise<RunEvent[]> {
  const out: RunEvent[] = [];
  for await (const e of events) out.push(e);
  return out;
}

describe('createCliDriver', () => {
  it('normalises stdout split mid-line across two writes, then yields exit', async () => {
    const child = fakeChild();
    const spawnCalls: { command: string; args: string[]; options: unknown }[] = [];
    const spawn = vi.fn((command: string, args: string[], options: unknown) => {
      spawnCalls.push({ command, args, options });
      return child;
    });

    const driver = createCliDriver({ spawn: spawn as never, claudeBin: 'claude', now: () => 1000 });
    const handle = driver.start({
      repoPath: '/repo',
      prompt: 'do the thing',
      allowedTools: ['Read', 'Bash'],
      pluginPath: '/plugin',
      maxTurns: 10,
    });

    const collected = collect(handle.events);

    // Split the fixture at a point inside a line (not on a newline) to force the driver to
    // buffer a partial line across chunks.
    let mid = Math.floor(FIXTURE_RAW.length / 2);
    while (FIXTURE_RAW[mid] === '\n') mid += 1;
    child.stdout.write(FIXTURE_RAW.slice(0, mid));
    await flush();
    child.stdout.write(FIXTURE_RAW.slice(mid));
    await flush();
    child.emit('close', 0);

    const events = await collected;
    const expected = [...FIXTURE_MESSAGES.flatMap(createNormaliser(() => 1000)), { t: 'exit', code: 0, at: 1000 }];
    expect(events).toEqual(expected);

    expect(spawnCalls).toHaveLength(1);
    const { command, args, options } = spawnCalls[0];
    expect(command).toBe('claude');
    expect(Array.isArray(args)).toBe(true);
    expect(args).toContain('--plugin-dir');
    expect(args[args.indexOf('--plugin-dir') + 1]).toBe('/plugin');
    expect(args).toContain('Read,Bash'); // joined allow list, not spawned one tool at a time
    expect((options as { shell?: boolean } | undefined)?.shell).not.toBe(true);
  });

  it('turns stderr lines into notice events', async () => {
    const child = fakeChild();
    const spawn = vi.fn(() => child);
    const driver = createCliDriver({ spawn: spawn as never, claudeBin: 'claude', now: () => 2000 });
    const handle = driver.start({ repoPath: '/repo', prompt: 'p', allowedTools: [], pluginPath: '/plugin' });

    const collected = collect(handle.events);
    child.stderr.write('warning: something\n');
    await flush();
    child.emit('close', 0);

    const events = await collected;
    expect(events).toEqual([
      { t: 'notice', text: 'warning: something', at: 2000 },
      { t: 'exit', code: 0, at: 2000 },
    ]);
  });

  it('stop() sends SIGTERM and resolves once the process has closed', async () => {
    const child = fakeChild();
    const spawn = vi.fn(() => child);
    const driver = createCliDriver({ spawn: spawn as never, claudeBin: 'claude', now: () => 3000 });
    const handle = driver.start({ repoPath: '/repo', prompt: 'p', allowedTools: [], pluginPath: '/plugin' });

    // Drain events in the background so the queue never backs up.
    const collected = collect(handle.events);

    let stopResolved = false;
    const stopPromise = handle.stop().then(() => {
      stopResolved = true;
    });
    await flush();

    expect(child.kill).toHaveBeenCalledWith('SIGTERM');
    expect(stopResolved).toBe(false); // still waiting on the process to actually exit

    child.emit('close', null);
    await stopPromise;
    expect(stopResolved).toBe(true);

    await collected;
  });

  it('never invokes spawn with a shell string in place of a command+args array', async () => {
    const child = fakeChild();
    const spawn = vi.fn(() => child);
    const driver = createCliDriver({ spawn: spawn as never, claudeBin: 'claude', now: () => 4000 });
    driver.start({ repoPath: '/repo', prompt: 'p', allowedTools: [], pluginPath: '/plugin' });

    expect(spawn).toHaveBeenCalledTimes(1);
    const call = spawn.mock.calls[0] as unknown[];
    expect(typeof call[0]).toBe('string'); // command
    expect(Array.isArray(call[1])).toBe(true); // argv, never a single shell string
    (call[1] as string[]).forEach((a) => expect(typeof a).toBe('string'));
  });
});

describe('createSdkDriver', () => {
  it('yields error then exit when the dynamic import of the SDK fails', async () => {
    const driver = createSdkDriver({ now: () => 5000 });
    const handle = driver.start({ repoPath: '/repo', prompt: 'p', allowedTools: [], pluginPath: '/plugin' });

    const events = await collect(handle.events);
    // The thrown message is vitest's own "error when mocking a module" wording, not ours —
    // assert the shape createSdkDriver produces on a failed import, not vitest's exact text.
    expect(events).toHaveLength(2);
    expect(events[0]).toMatchObject({ t: 'error', at: 5000 });
    expect(typeof (events[0] as { message: string }).message).toBe('string');
    expect((events[0] as { message: string }).message.length).toBeGreaterThan(0);
    expect(events[1]).toEqual({ t: 'exit', code: null, at: 5000 });
  });

  it('name is "sdk" and start() returns a fresh id per call', () => {
    const driver = createSdkDriver({ now: () => 0 });
    const a = driver.start({ repoPath: '/repo', prompt: 'p', allowedTools: [], pluginPath: '/plugin' });
    const b = driver.start({ repoPath: '/repo', prompt: 'p', allowedTools: [], pluginPath: '/plugin' });
    expect(driver.name).toBe('sdk');
    expect(a.id).not.toBe(b.id);
  });
});
