import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, symlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { IPC } from '@shared/types';
import type { ChangeDigest, RepoRef, RunEvent, Settings } from '@shared/types';
import { registerIpc, type IpcDeps, type IpcMainLike } from '../src/main/ipc';
import type { RunDriver, RunHandle } from '../src/main/drivers';
import type { WhResult } from '../src/main/wh';

/** Records every `ipcMain.handle` registration and lets a test invoke a handler directly,
 *  mirroring what real `ipcMain.invoke` from the renderer would do. */
function createFakeIpcMain(): { ipcMain: IpcMainLike; invoke: (channel: string, ...args: unknown[]) => Promise<unknown> } {
  const handlers = new Map<string, (event: unknown, ...args: any[]) => unknown>();
  return {
    ipcMain: {
      handle(channel, listener) {
        handlers.set(channel, listener);
      },
    },
    async invoke(channel, ...args) {
      const handler = handlers.get(channel);
      if (!handler) throw new Error(`no handler registered for ${channel}`);
      return handler({}, ...args);
    },
  };
}

/** A registry-shaped fake backed by an in-memory list; only the methods ipc.ts calls. */
function createFakeRegistry(refs: RepoRef[]): IpcDeps['registry'] {
  return {
    list: () => refs,
    add: (path: string) => {
      const ref: RepoRef = { id: `id-${path}`, path, name: path, addedAt: new Date(0).toISOString() };
      refs.push(ref);
      return ref;
    },
    remove: (id: string) => {
      const i = refs.findIndex((r) => r.id === id);
      if (i >= 0) refs.splice(i, 1);
    },
    get: (id: string) => refs.find((r) => r.id === id),
  } as unknown as IpcDeps['registry'];
}

function createFakeSettings(initial: Settings): IpcDeps['settings'] {
  let current = { ...initial };
  let key: string | null = null;
  return {
    get: () => current,
    set: (patch: Partial<Settings>) => {
      current = { ...current, ...patch };
      return current;
    },
    setApiKey: (k: string) => {
      key = k;
    },
    hasApiKey: () => key !== null,
    clearApiKey: () => {
      key = null;
    },
    readApiKey: () => key,
  } as unknown as IpcDeps['settings'];
}

function neverEndingHandle(id: string): RunHandle {
  return {
    id,
    events: { [Symbol.asyncIterator]: () => ({ next: () => new Promise<IteratorResult<RunEvent>>(() => {}) }) },
    stop: async () => {},
  };
}

function finishedHandle(id: string, events: RunEvent[]): RunHandle {
  let i = 0;
  return {
    id,
    events: {
      [Symbol.asyncIterator]: () => ({
        next: async (): Promise<IteratorResult<RunEvent>> =>
          i < events.length ? { value: events[i++], done: false } : { value: undefined, done: true },
      }),
    },
    stop: async () => {},
  };
}

function makeDeps(overrides: Partial<IpcDeps> = {}): {
  deps: IpcDeps;
  invoke: (channel: string, ...args: unknown[]) => Promise<unknown>;
  sent: { channel: string; payload: unknown }[];
  repos: RepoRef[];
  watcherOn: ((e: { repoId: string; digests: ChangeDigest[] }) => void)[];
} {
  const { ipcMain, invoke } = createFakeIpcMain();
  const repos: RepoRef[] = [{ id: 'repo-1', path: '/repos/one', name: 'one', addedAt: new Date(0).toISOString() }];
  const sent: { channel: string; payload: unknown }[] = [];
  const watcherOn: ((e: { repoId: string; digests: ChangeDigest[] }) => void)[] = [];

  const deps: IpcDeps = {
    ipcMain,
    dialog: { showOpenDialog: vi.fn(async () => ({ canceled: true, filePaths: [] })) },
    win: { webContents: { send: (channel: string, payload: unknown) => sent.push({ channel, payload }) } },
    registry: createFakeRegistry(repos),
    settings: createFakeSettings({ backend: 'cli', pluginPath: null, allowedTools: {}, theme: 'dark' }),
    syscheck: vi.fn(async () => ({
      node: { ok: true, version: 'v20', path: 'node' },
      claude: { ok: true, version: '1.0', path: 'claude' },
      plugin: { path: '/plugin', version: '0.2.0', bundled: true },
    })),
    watcher: {
      watch: vi.fn(),
      unwatch: vi.fn(),
      on: (cb) => {
        watcherOn.push(cb);
        return () => {};
      },
      close: vi.fn(async () => {}),
    },
    driverFor: vi.fn((): RunDriver => ({ name: 'cli', start: () => neverEndingHandle('run-x') })),
    pluginPath: '/plugin',
    digest: vi.fn(async () => [] as ChangeDigest[]),
    runWh: vi.fn(async (): Promise<WhResult> => ({ code: 0, stdout: '{}', stderr: '' })),
    safe: { readApiKey: () => null },
    ...overrides,
  };

  registerIpc(deps);
  return { deps, invoke, sent, repos, watcherOn };
}

describe('registerIpc', () => {
  let dir: string;
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'paddock-ipc-'));
  });
  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  describe('artifact:read path guard', () => {
    it('reads a file under docs/sdlc/<change>/<file>', async () => {
      const changeDir = join(dir, 'docs', 'sdlc', 'change-1');
      mkdirSync(changeDir, { recursive: true });
      writeFileSync(join(changeDir, 'intent.md'), '# intent');

      const repos: RepoRef[] = [{ id: 'repo-1', path: dir, name: 'r', addedAt: new Date(0).toISOString() }];
      const { invoke } = makeDeps({ registry: createFakeRegistry(repos) });

      const content = await invoke(IPC.artifactRead, 'repo-1', 'docs/sdlc/change-1/intent.md');
      expect(content).toBe('# intent');
    });

    it('reads a nested artifact path', async () => {
      const nested = join(dir, 'docs', 'sdlc', 'change-1', 'sub');
      mkdirSync(nested, { recursive: true });
      writeFileSync(join(nested, 'notes.md'), 'nested');
      const repos: RepoRef[] = [{ id: 'repo-1', path: dir, name: 'r', addedAt: new Date(0).toISOString() }];
      const { invoke } = makeDeps({ registry: createFakeRegistry(repos) });

      const content = await invoke(IPC.artifactRead, 'repo-1', 'docs/sdlc/change-1/sub/notes.md');
      expect(content).toBe('nested');
    });

    it.each([
      ['..'], // bare traversal, not even docs/sdlc-shaped
      ['docs/sdlc/change-1/../../../etc/passwd'],
      ['docs/other/file.md'], // not under docs/sdlc/
      ['docs/sdlc/.git/config'], // change dir starts with a dot
      ['docs/sdlc/change-1'], // no file segment
      ['/etc/passwd'],
    ])('rejects %s', async (relPath) => {
      const { invoke } = makeDeps();
      await expect(invoke(IPC.artifactRead, 'repo-1', relPath)).rejects.toThrow();
    });

    // The string guard passes here: the path is spelled correctly. Only resolving the symlink
    // catches it, which is the point of the containment check.
    it('rejects a string-legal path that symlinks outside the repo', async () => {
      const changeDir = join(dir, 'docs', 'sdlc', 'change-1');
      mkdirSync(changeDir, { recursive: true });
      const outside = mkdtempSync(join(tmpdir(), 'paddock-outside-'));
      writeFileSync(join(outside, 'secret.txt'), 'SECRET');

      let linked = false;
      try {
        symlinkSync(join(outside, 'secret.txt'), join(changeDir, 'leak.md'), 'file');
        linked = true;
      } catch {
        // Windows without Developer Mode refuses symlink creation for unprivileged users.
      }
      if (!linked) return;

      const repos: RepoRef[] = [{ id: 'repo-1', path: dir, name: 'r', addedAt: new Date(0).toISOString() }];
      const { invoke } = makeDeps({ registry: createFakeRegistry(repos) });
      await expect(invoke(IPC.artifactRead, 'repo-1', 'docs/sdlc/change-1/leak.md')).rejects.toThrow(
        /escapes the repository/,
      );
      rmSync(outside, { recursive: true, force: true });
    });
  });

  describe('onboard prompt', () => {
    it('passes the client context through as an argument so the skill never has to ask', async () => {
      const started: string[] = [];
      const { invoke } = makeDeps({
        driverFor: () => ({
          name: 'cli' as const,
          start: (a: { prompt: string }) => {
            started.push(a.prompt);
            return { id: 'r1', events: (async function* () {})(), stop: async () => {} };
          },
        }),
      });
      await invoke(IPC.runStart, 'repo-1', '__onboard__:fintech, UK users, AWS eu-west-2');
      expect(started[0]).toBe('/workhorse:onboard fintech, UK users, AWS eu-west-2');
    });

    it('falls back to the bare command when no context is given', async () => {
      const started: string[] = [];
      const { invoke } = makeDeps({
        driverFor: () => ({
          name: 'cli' as const,
          start: (a: { prompt: string }) => {
            started.push(a.prompt);
            return { id: 'r1', events: (async function* () {})(), stop: async () => {} };
          },
        }),
      });
      await invoke(IPC.runStart, 'repo-1', '__onboard__:   ');
      expect(started[0]).toBe('/workhorse:onboard');
    });
  });

  describe('run:start', () => {
    it('rejects a second start on a repo with a run already active', async () => {
      const { invoke } = makeDeps();
      const first = await invoke(IPC.runStart, 'repo-1', 'do the thing');
      expect(first).toEqual({ runId: 'run-x' });

      await expect(invoke(IPC.runStart, 'repo-1', 'again')).rejects.toThrow('run already active');
    });

    it('allows starting a different repo while one is active', async () => {
      const repos: RepoRef[] = [
        { id: 'repo-1', path: '/one', name: 'one', addedAt: new Date(0).toISOString() },
        { id: 'repo-2', path: '/two', name: 'two', addedAt: new Date(0).toISOString() },
      ];
      const { invoke } = makeDeps({ registry: createFakeRegistry(repos) });
      await invoke(IPC.runStart, 'repo-1', 'a');
      await expect(invoke(IPC.runStart, 'repo-2', 'b')).resolves.toEqual({ runId: 'run-x' });
    });

    it('builds the /workhorse:run prompt with the user prompt quoted and escaped', async () => {
      const startArgsSeen: any[] = [];
      const driverFor = vi.fn(
        (): RunDriver => ({
          name: 'cli',
          start: (args) => {
            startArgsSeen.push(args);
            return neverEndingHandle('run-x');
          },
        }),
      );
      const { invoke } = makeDeps({ driverFor });
      await invoke(IPC.runStart, 'repo-1', 'say "hi" \\ ok');
      expect(startArgsSeen[0].prompt).toBe('/workhorse:run "say \\"hi\\" \\\\ ok"');
    });

    it('run:resume drives the bare /workhorse:run prompt', async () => {
      const startArgsSeen: any[] = [];
      const driverFor = vi.fn(
        (): RunDriver => ({
          name: 'cli',
          start: (args) => {
            startArgsSeen.push(args);
            return neverEndingHandle('run-x');
          },
        }),
      );
      const { invoke } = makeDeps({ driverFor });
      await invoke(IPC.runResume, 'repo-1');
      expect(startArgsSeen[0].prompt).toBe('/workhorse:run');
    });

    it('falls back to the documented default allowed tools when settings has none for the repo', async () => {
      const startArgsSeen: any[] = [];
      const driverFor = vi.fn(
        (): RunDriver => ({
          name: 'cli',
          start: (args) => {
            startArgsSeen.push(args);
            return neverEndingHandle('run-x');
          },
        }),
      );
      const { invoke } = makeDeps({ driverFor });
      await invoke(IPC.runStart, 'repo-1', 'x');
      expect(startArgsSeen[0].allowedTools).toEqual([
        'Agent',
        'Read',
        'Glob',
        'Grep',
        'Edit',
        'Write',
        'Bash(node *)',
        'Bash(npm *)',
        'Bash(git *)',
      ]);
    });

    it('reads settings.allowedTools[repoId] when present', async () => {
      const startArgsSeen: any[] = [];
      const driverFor = vi.fn(
        (): RunDriver => ({
          name: 'cli',
          start: (args) => {
            startArgsSeen.push(args);
            return neverEndingHandle('run-x');
          },
        }),
      );
      const settings = createFakeSettings({
        backend: 'cli',
        pluginPath: null,
        allowedTools: { 'repo-1': ['Read', 'Grep'] },
        theme: 'dark',
      });
      const { invoke } = makeDeps({ driverFor, settings });
      await invoke(IPC.runStart, 'repo-1', 'x');
      expect(startArgsSeen[0].allowedTools).toEqual(['Read', 'Grep']);
    });

    it('frees the repo for a new run once the driver event stream ends', async () => {
      const driverFor = vi.fn(
        (): RunDriver => ({ name: 'cli', start: () => finishedHandle('run-x', [{ t: 'exit', code: 0, at: 1 }]) }),
      );
      const { invoke } = makeDeps({ driverFor });
      await invoke(IPC.runStart, 'repo-1', 'a');
      // Let pumpEvents drain the (already-finished) async iterable.
      await new Promise((r) => setTimeout(r, 10));
      await expect(invoke(IPC.runStart, 'repo-1', 'b')).resolves.toEqual({ runId: 'run-x' });
    });

    it('forwards run events to the renderer as RunEnvelope on run:event', async () => {
      const events: RunEvent[] = [
        { t: 'init', sessionId: 's1', plugins: ['workhorse'], skills: [], at: 1 },
        { t: 'exit', code: 0, at: 2 },
      ];
      const driverFor = vi.fn((): RunDriver => ({ name: 'cli', start: () => finishedHandle('run-x', events) }));
      const { invoke, sent } = makeDeps({ driverFor });
      await invoke(IPC.runStart, 'repo-1', 'a');
      await new Promise((r) => setTimeout(r, 10));

      const forwarded = sent.filter((s) => s.channel === IPC.runEvent);
      expect(forwarded).toHaveLength(2);
      expect(forwarded[0].payload).toEqual({ runId: 'run-x', repoId: 'repo-1', event: events[0] });
      expect(forwarded[1].payload).toEqual({ runId: 'run-x', repoId: 'repo-1', event: events[1] });
    });
  });

  describe('run:stop', () => {
    it('calls stop() on the matching run handle', async () => {
      const stop = vi.fn(async () => {});
      const driverFor = vi.fn(
        (): RunDriver => ({
          name: 'cli',
          start: () => ({ ...neverEndingHandle('run-x'), stop }),
        }),
      );
      const { invoke } = makeDeps({ driverFor });
      await invoke(IPC.runStart, 'repo-1', 'a');
      await invoke(IPC.runStop, 'run-x');
      expect(stop).toHaveBeenCalledTimes(1);
    });
  });

  describe('gate:approve / gate:reject', () => {
    it('approve invokes runWh with wh.js approve <gate> <notes> in the repo cwd', async () => {
      const runWh = vi.fn(async (): Promise<WhResult> => ({ code: 0, stdout: '{"gate":"G3","status":"approved","who":"m","at":"t","committed":true}', stderr: '' }));
      const { invoke } = makeDeps({ runWh });
      const result = await invoke(IPC.gateApprove, 'repo-1', 'G3', 'looks good');
      expect(runWh).toHaveBeenCalledWith('/plugin', '/repos/one', ['approve', 'G3', 'looks good']);
      expect(result).toEqual({ gate: 'G3', status: 'approved', who: 'm', at: 't', committed: true });
    });

    it('reject invokes runWh with wh.js approve <gate> --reject <notes>', async () => {
      const runWh = vi.fn(async (): Promise<WhResult> => ({ code: 0, stdout: '{"gate":"G3","status":"rejected","who":"m","at":"t","committed":false}', stderr: '' }));
      const { invoke } = makeDeps({ runWh });
      const result = await invoke(IPC.gateReject, 'repo-1', 'G3', 'needs more tests');
      expect(runWh).toHaveBeenCalledWith('/plugin', '/repos/one', ['approve', 'G3', '--reject', 'needs more tests']);
      expect(result).toMatchObject({ gate: 'G3', status: 'rejected' });
    });

    it('rejects an empty-notes reject before ever calling runWh', async () => {
      const runWh = vi.fn(async (): Promise<WhResult> => ({ code: 0, stdout: '{}', stderr: '' }));
      const { invoke } = makeDeps({ runWh });
      await expect(invoke(IPC.gateReject, 'repo-1', 'G3', '')).rejects.toThrow('notes');
      await expect(invoke(IPC.gateReject, 'repo-1', 'G3', '   ')).rejects.toThrow('notes');
      expect(runWh).not.toHaveBeenCalled();
    });

    it('surfaces a non-zero runWh exit as a rejection', async () => {
      const runWh = vi.fn(async (): Promise<WhResult> => ({ code: 1, stdout: '', stderr: 'gate not ready' }));
      const { invoke } = makeDeps({ runWh });
      await expect(invoke(IPC.gateApprove, 'repo-1', 'G3', 'notes')).rejects.toThrow('gate not ready');
    });
  });

  describe('repos', () => {
    it('add watches the new repo and remove unwatches it', async () => {
      const { invoke, deps } = makeDeps();
      const ref = (await invoke(IPC.reposAdd, '/some/path')) as RepoRef;
      expect(ref.onboarded).toBe(false); // no .workhorse/profile.yml at that path
      const watched = (deps.watcher.watch as ReturnType<typeof vi.fn>).mock.calls[0][0] as RepoRef;
      expect(watched).toMatchObject({ id: ref.id, path: ref.path });
      // onboarded is computed for the renderer only; the persisted ref must never carry it
      expect(watched).not.toHaveProperty('onboarded');

      await invoke(IPC.reposRemove, ref.id);
      expect(deps.watcher.unwatch).toHaveBeenCalledWith(ref.id);
    });

    it('list returns the registry contents, each marked with whether it is onboarded', async () => {
      const { invoke, repos } = makeDeps();
      await expect(invoke(IPC.reposList)).resolves.toEqual(repos.map((r) => ({ ...r, onboarded: false })));
    });

    it('marks a repo onboarded once .workhorse/profile.yml exists, on add, list and watcher events', async () => {
      const repoDir = mkdtempSync(join(tmpdir(), 'paddock-onboarded-'));
      try {
        mkdirSync(join(repoDir, '.workhorse'), { recursive: true });
        writeFileSync(join(repoDir, '.workhorse', 'profile.yml'), 'client:\n  name: "x"\n');
        const { invoke, sent, watcherOn } = makeDeps();

        const ref = (await invoke(IPC.reposAdd, repoDir)) as RepoRef;
        expect(ref.onboarded).toBe(true);

        const listed = (await invoke(IPC.reposList)) as RepoRef[];
        expect(listed.find((r) => r.id === ref.id)?.onboarded).toBe(true);

        watcherOn[0]({ repoId: ref.id, digests: [] });
        expect(sent).toContainEqual({
          channel: IPC.watchDigest,
          payload: { repoId: ref.id, digests: [], onboarded: true },
        });
      } finally {
        rmSync(repoDir, { recursive: true, force: true });
      }
    });

    it('reports a freshly onboarded repo as onboarded even though it has no changes yet', async () => {
      // The bug this guards: Fleet used to infer onboarding from "has digests", so a repo with a
      // profile but no changes kept offering to be onboarded again.
      const repoDir = mkdtempSync(join(tmpdir(), 'paddock-nochanges-'));
      try {
        mkdirSync(join(repoDir, '.workhorse'), { recursive: true });
        writeFileSync(join(repoDir, '.workhorse', 'profile.yml'), 'client: {}\n');
        const digest = vi.fn(async () => [] as ChangeDigest[]);
        const { invoke } = makeDeps({ digest });
        const ref = (await invoke(IPC.reposAdd, repoDir)) as RepoRef;
        await expect(invoke(IPC.fleetDigest, ref.id)).resolves.toEqual([]);
        expect(ref.onboarded).toBe(true);
      } finally {
        rmSync(repoDir, { recursive: true, force: true });
      }
    });

    it('pickFolder returns null when the dialog is cancelled, else the chosen path', async () => {
      const { invoke } = makeDeps({
        dialog: { showOpenDialog: vi.fn(async () => ({ canceled: false, filePaths: ['/chosen'] })) },
      });
      await expect(invoke(IPC.reposPick)).resolves.toBe('/chosen');
    });
  });

  describe('fleet:digest and watch:digest', () => {
    it('fleet:digest resolves the repo path and calls digest(pluginPath, repoPath)', async () => {
      const digest = vi.fn(async () => [{ change_id: 'c1' } as unknown as ChangeDigest]);
      const { invoke } = makeDeps({ digest });
      const result = await invoke(IPC.fleetDigest, 'repo-1');
      expect(digest).toHaveBeenCalledWith('/plugin', '/repos/one');
      expect(result).toEqual([{ change_id: 'c1' }]);
    });

    it('forwards watcher emissions to the renderer on watch:digest', () => {
      const { sent, watcherOn } = makeDeps();
      watcherOn[0]({ repoId: 'repo-1', digests: [{ change_id: 'c1' } as unknown as ChangeDigest] });
      expect(sent).toContainEqual({
        channel: IPC.watchDigest,
        payload: { repoId: 'repo-1', digests: [{ change_id: 'c1' }], onboarded: false },
      });
    });
  });

  describe('settings', () => {
    it('get/set round-trip and the api key never appears on the settings object', async () => {
      const { invoke } = makeDeps();
      const initial = (await invoke(IPC.settingsGet)) as Settings;
      expect(initial.backend).toBe('cli');

      const patched = (await invoke(IPC.settingsSet, { backend: 'sdk' })) as Settings;
      expect(patched.backend).toBe('sdk');
      expect((patched as unknown as Record<string, unknown>).apiKey).toBeUndefined();

      expect(await invoke(IPC.settingsHasKey)).toBe(false);
      await invoke(IPC.settingsSetKey, 'sk-test');
      expect(await invoke(IPC.settingsHasKey)).toBe(true);
      await invoke(IPC.settingsClearKey);
      expect(await invoke(IPC.settingsHasKey)).toBe(false);
    });
  });

  describe('system:check', () => {
    it('delegates to deps.syscheck with the plugin path', async () => {
      const { invoke, deps } = makeDeps();
      const result = await invoke(IPC.systemCheck);
      expect(deps.syscheck).toHaveBeenCalledWith('/plugin');
      expect(result).toMatchObject({ node: { ok: true } });
    });
  });
});
