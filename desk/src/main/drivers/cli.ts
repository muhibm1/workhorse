import { spawn as nodeSpawn, type ChildProcess } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import type { RunEvent } from '@shared/types';
import { createNormaliser } from './normalise';
import type { RunDriver, RunHandle, StartArgs } from './types';

const DEFAULT_MAX_TURNS = 400;
const KILL_GRACE_MS = 3000;

/** A single-consumer, push-then-pull async queue: `push` never blocks, `next()` waits for the
 *  next push when the buffer is empty, and `close()` ends iteration once the buffer drains. */
class AsyncEventQueue implements AsyncIterable<RunEvent> {
  private readonly buffered: RunEvent[] = [];
  private readonly waiting: Array<(result: IteratorResult<RunEvent>) => void> = [];
  private closed = false;

  push(event: RunEvent): void {
    if (this.closed) return;
    const waiter = this.waiting.shift();
    if (waiter) waiter({ value: event, done: false });
    else this.buffered.push(event);
  }

  close(): void {
    if (this.closed) return;
    this.closed = true;
    while (this.waiting.length) {
      this.waiting.shift()!({ value: undefined, done: true });
    }
  }

  [Symbol.asyncIterator](): AsyncIterator<RunEvent> {
    return {
      next: (): Promise<IteratorResult<RunEvent>> => {
        if (this.buffered.length) return Promise.resolve({ value: this.buffered.shift()!, done: false });
        if (this.closed) return Promise.resolve({ value: undefined, done: true });
        return new Promise((resolve) => this.waiting.push(resolve));
      },
    };
  }
}

/** Splits a growing byte/text buffer into complete lines, holding back the trailing partial
 *  line (if any) for the next chunk. `\r\n` and bare `\n` both terminate a line. */
function takeLines(buffer: string): { lines: string[]; rest: string } {
  const parts = buffer.split('\n');
  const rest = parts.pop() ?? '';
  const lines = parts.map((l) => (l.endsWith('\r') ? l.slice(0, -1) : l));
  return { lines, rest };
}

export function createCliDriver(deps?: {
  spawn?: typeof nodeSpawn;
  claudeBin?: string;
  now?: () => number;
}): RunDriver {
  const spawn = deps?.spawn ?? nodeSpawn;
  const claudeBin = deps?.claudeBin ?? 'claude';
  const now = deps?.now ?? Date.now;

  return {
    name: 'cli',
    start(args: StartArgs): RunHandle {
      const id = randomBytes(8).toString('hex');
      const normalise = createNormaliser(now);
      const queue = new AsyncEventQueue();

      const cliArgs = [
        '-p', args.prompt,
        '--output-format', 'stream-json',
        '--verbose',
        '--include-hook-events',
        '--permission-mode', 'acceptEdits',
        '--allowedTools', args.allowedTools.join(','),
        '--plugin-dir', args.pluginPath,
        '--max-turns', String(args.maxTurns ?? DEFAULT_MAX_TURNS),
      ];

      // Explicit command + argument array; never a shell string (see spec 7, plan Global Constraints).
      const child: ChildProcess = spawn(claudeBin, cliArgs, {
        cwd: args.repoPath,
        stdio: ['ignore', 'pipe', 'pipe'],
        windowsHide: true,
      });

      let stdoutRest = '';
      let stderrRest = '';
      let exited = false;
      let resolveExited: () => void = () => {};
      const exitedPromise = new Promise<void>((resolve) => {
        resolveExited = resolve;
      });

      const handleStdout = (chunk: Buffer | string): void => {
        const { lines, rest } = takeLines(stdoutRest + chunk.toString());
        stdoutRest = rest;
        for (const line of lines) {
          if (!line.trim()) continue;
          let msg: unknown;
          try {
            msg = JSON.parse(line);
          } catch {
            continue; // Not a stream-json line (e.g. wrapped diagnostic output); not ours.
          }
          for (const event of normalise(msg)) queue.push(event);
        }
      };

      const handleStderr = (chunk: Buffer | string): void => {
        const { lines, rest } = takeLines(stderrRest + chunk.toString());
        stderrRest = rest;
        for (const line of lines) {
          if (!line.trim()) continue;
          queue.push({ t: 'notice', text: line, at: now() });
        }
      };

      child.stdout?.on('data', handleStdout);
      child.stderr?.on('data', handleStderr);

      child.on('close', (code: number | null) => {
        if (exited) return;
        exited = true;
        if (stdoutRest.trim()) {
          try {
            const msg = JSON.parse(stdoutRest);
            for (const event of normalise(msg)) queue.push(event);
          } catch {
            // Trailing partial line with no closing newline: nothing we can parse.
          }
        }
        if (stderrRest.trim()) queue.push({ t: 'notice', text: stderrRest.trim(), at: now() });
        queue.push({ t: 'exit', code, at: now() });
        queue.close();
        resolveExited();
      });

      return {
        id,
        events: queue,
        async stop(): Promise<void> {
          if (exited) return;
          child.kill('SIGTERM');
          const killTimer = setTimeout(() => {
            if (!exited) child.kill('SIGKILL');
          }, KILL_GRACE_MS);
          await exitedPromise;
          clearTimeout(killTimer);
        },
      };
    },
  };
}
