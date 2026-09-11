import type { Backend, RunEvent } from '@shared/types';

/** Arguments to start one run. `apiKey` and `maxTurns` are optional; the SDK driver uses
 *  `apiKey` for `ANTHROPIC_API_KEY`, both drivers default `maxTurns` to 400. */
export interface StartArgs {
  repoPath: string;
  prompt: string;
  allowedTools: string[];
  pluginPath: string;
  apiKey?: string | null;
  maxTurns?: number;
}

/** A running (or just-finished) run. `events` is a single-consumer async stream: iterate it
 *  once, start to close. `stop()` resolves once the driver has yielded its final `exit` event. */
export interface RunHandle {
  id: string;
  events: AsyncIterable<RunEvent>;
  stop(): Promise<void>;
}

export interface RunDriver {
  name: Backend;
  start(args: StartArgs): RunHandle;
}
