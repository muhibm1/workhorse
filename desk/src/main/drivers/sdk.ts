import { randomBytes } from 'node:crypto';
import type { RunEvent } from '@shared/types';
import { createNormaliser } from './normalise';
import type { RunDriver, RunHandle, StartArgs } from './types';

const DEFAULT_MAX_TURNS = 400;

/** Optional runtime dependency: only imported inside `start()` so a machine without it
 *  installed can still run the CLI backend (see plan Task 5 / spec 5.5). */
export function createSdkDriver(deps?: { now?: () => number }): RunDriver {
  const now = deps?.now ?? Date.now;

  return {
    name: 'sdk',
    start(args: StartArgs): RunHandle {
      const id = randomBytes(8).toString('hex');
      let stopped = false;

      async function* run(): AsyncGenerator<RunEvent> {
        const normalise = createNormaliser(now);

        let sdk: typeof import('@anthropic-ai/claude-agent-sdk');
        try {
          sdk = await import('@anthropic-ai/claude-agent-sdk');
        } catch (err) {
          yield { t: 'error', message: message(err), at: now() };
          yield { t: 'exit', code: null, at: now() };
          return;
        }

        try {
          const stream = sdk.query({
            prompt: args.prompt,
            options: {
              cwd: args.repoPath,
              allowedTools: args.allowedTools,
              permissionMode: 'acceptEdits',
              plugins: [{ type: 'local', path: args.pluginPath }],
              maxTurns: args.maxTurns ?? DEFAULT_MAX_TURNS,
              env: { ...process.env, ANTHROPIC_API_KEY: args.apiKey ?? undefined },
            },
          });
          for await (const msg of stream) {
            if (stopped) break;
            for (const event of normalise(msg)) yield event;
          }
          yield { t: 'exit', code: 0, at: now() };
        } catch (err) {
          yield { t: 'error', message: message(err), at: now() };
          yield { t: 'exit', code: null, at: now() };
        }
      }

      const generator = run();

      return {
        id,
        events: generator,
        async stop(): Promise<void> {
          stopped = true;
          await generator.return(undefined);
        },
      };
    },
  };
}

function message(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}
