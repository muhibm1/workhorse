import { readFile, realpath } from 'node:fs/promises';
import { isAbsolute, join, relative, resolve } from 'node:path';
import { IPC } from '@shared/types';
import type {
  ApproveResult,
  Backend,
  ChangeDigest,
  Gate,
  RepoRef,
  RunEnvelope,
  Settings,
  SysCheck,
} from '@shared/types';
import type { createRegistry } from './registry';
import type { createSettings } from './settings';
import type { Watcher } from './watcher';
import type { RunDriver, RunHandle } from './drivers';
import type { WhResult } from './wh';

/**
 * Structural (not `Electron.*`) types for the three Electron objects `registerIpc` touches, so
 * this module — and its tests — never need a running Electron process. The real `ipcMain`,
 * `dialog` and a `BrowserWindow` instance satisfy these shapes as-is when T15 wires the app.
 */
export interface IpcMainLike {
  handle(channel: string, listener: (event: unknown, ...args: any[]) => unknown): void;
}
export interface DialogLike {
  showOpenDialog(
    win: unknown,
    options: { properties: string[] },
  ): Promise<{ canceled: boolean; filePaths: string[] }>;
}
export interface WinLike {
  webContents: { send(channel: string, payload: unknown): void };
}

export interface IpcDeps {
  ipcMain: IpcMainLike;
  dialog: DialogLike;
  win: WinLike;
  registry: ReturnType<typeof createRegistry>;
  settings: ReturnType<typeof createSettings>;
  syscheck: (pluginPath: string) => Promise<SysCheck>;
  watcher: Watcher;
  driverFor: (backend: Backend) => RunDriver;
  pluginPath: string;
  digest: (pluginPath: string, repoPath: string) => Promise<ChangeDigest[]>;
  runWh: (pluginPath: string, repoPath: string, args: string[]) => Promise<WhResult>;
  /** Decrypts the stored API key; never exposed over IPC itself (see settings.ts). */
  safe: { readApiKey(): string | null };
}

/** Falls back to this list when `settings.allowedTools[repoId]` has no entry (plan Task 10). */
const DEFAULT_ALLOWED_TOOLS = [
  'Agent',
  'Read',
  'Glob',
  'Grep',
  'Edit',
  'Write',
  'Bash(node *)',
  'Bash(npm *)',
  'Bash(git *)',
];

/** `run:resume` always drives the same slash command with no argument (spec 5.4 / plan Task 10). */
const RESUME_PROMPT = '/workhorse:run';

/** Sentinel prompts the Fleet screen (Task 11) sends for onboarding and syncing a repo, mapped
 *  here to the slash commands that actually drive them. */
const SENTINEL_PROMPTS: Record<string, string> = {
  __onboard__: '/workhorse:onboard',
  __sync__: '/workhorse:sync',
};

/**
 * `__onboard__:<context>` carries the client description the onboard skill would otherwise stop
 * and ask for. That matters because runs are headless: a bare `/workhorse:onboard` reaches the
 * skill's "ask the user one question" step, finds nobody to answer, and ends the run with the
 * question sitting in the log. Passing the context up front means the run completes.
 */
const ONBOARD_PREFIX = '__onboard__:';

/** Only `\` and `"` can break out of the `"<prompt>"` quoted argument `/workhorse:run` parses;
 *  escape them so the user's text always round-trips as one argument. */
function escapeForQuotedArg(text: string): string {
  return text.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
}

function buildStartPrompt(prompt: string): string {
  if (prompt.startsWith(ONBOARD_PREFIX)) {
    const context = prompt.slice(ONBOARD_PREFIX.length).trim();
    return context ? `/workhorse:onboard ${context}` : SENTINEL_PROMPTS.__onboard__;
  }
  const sentinel = SENTINEL_PROMPTS[prompt];
  if (sentinel) return sentinel;
  return `/workhorse:run "${escapeForQuotedArg(prompt)}"`;
}

/** `docs/sdlc/<change>/<file...>`: two or more segments under `docs/sdlc/`, the first not
 *  starting with `.` (so `.git`, `..` and similar can never be the change directory). Combined
 *  with the explicit `..` check below (belt and suspenders — `..` is already excluded from any
 *  segment by `[^/]+`, but the guard must never depend on that alone). */
const ARTIFACT_PATH_RE = /^docs\/sdlc\/[^./][^/]*\/[^/]+(?:\/[^/]+)*$/;

function assertArtifactPath(relPath: string): void {
  if (typeof relPath !== 'string' || relPath.includes('..') || !ARTIFACT_PATH_RE.test(relPath)) {
    throw new Error(`artifact path must be under docs/sdlc/ with no ".." segment: ${String(relPath)}`);
  }
}

/**
 * The string guard above constrains the *path text*; this constrains where it actually lands.
 * A symlink inside the repo (one a prompt-injected run could have created) would otherwise let
 * `docs/sdlc/<change>/link` resolve to anything on disk. Resolving both sides and comparing
 * makes containment a property of the real filesystem, not of the spelling of the path.
 */
async function resolveInsideRepo(repoPath: string, relPath: string): Promise<string> {
  const root = await realpath(repoPath);
  let target: string;
  try {
    target = await realpath(join(root, relPath));
  } catch {
    // Missing file: fall back to the lexical path so the caller gets a normal ENOENT, but only
    // after confirming that path is still inside the repo.
    target = resolve(root, relPath);
  }
  const rel = relative(root, target);
  if (rel.startsWith('..') || isAbsolute(rel)) {
    throw new Error(`artifact path escapes the repository: ${relPath}`);
  }
  return target;
}

function requireRepo(registry: ReturnType<typeof createRegistry>, repoId: string): RepoRef {
  const repo = registry.get(repoId);
  if (!repo) throw new Error(`unknown repo: ${repoId}`);
  return repo;
}

function parseApproveResult(result: WhResult): ApproveResult {
  if (result.code !== 0) {
    throw new Error(result.stderr.trim() || `wh.js approve exited with code ${result.code}`);
  }
  try {
    return JSON.parse(result.stdout) as ApproveResult;
  } catch {
    throw new Error('wh.js approve did not return valid JSON');
  }
}

/**
 * Registers every channel in `IPC` on `deps.ipcMain`, and forwards watcher digests and run
 * events to the renderer. Never trusts a renderer-supplied filesystem path: every handler that
 * touches a repo takes a `repoId` and resolves the path through `deps.registry` (spec 5.1).
 */
export function registerIpc(deps: IpcDeps): void {
  const { ipcMain, dialog, win, registry, settings, watcher, driverFor, pluginPath } = deps;

  /** At most one running run per repo (plan Task 10): keyed by repoId, cleared once the
   *  driver's event stream ends (including on `stop()`, which drains it to `exit`). */
  const activeRuns = new Map<string, RunHandle>();

  async function pumpEvents(repoId: string, handle: RunHandle): Promise<void> {
    try {
      for await (const event of handle.events) {
        const envelope: RunEnvelope = { runId: handle.id, repoId, event };
        win.webContents.send(IPC.runEvent, envelope);
      }
    } finally {
      if (activeRuns.get(repoId) === handle) activeRuns.delete(repoId);
    }
  }

  function startRun(repoId: string, prompt: string): { runId: string } {
    if (activeRuns.has(repoId)) throw new Error('run already active');
    const repo = requireRepo(registry, repoId);
    const current = settings.get();
    const allowedTools = current.allowedTools[repoId] ?? DEFAULT_ALLOWED_TOOLS;
    const driver = driverFor(current.backend);
    const handle = driver.start({
      repoPath: repo.path,
      prompt,
      allowedTools,
      pluginPath,
      apiKey: deps.safe.readApiKey(),
    });
    activeRuns.set(repoId, handle);
    void pumpEvents(repoId, handle);
    return { runId: handle.id };
  }

  // -- system --------------------------------------------------------------
  ipcMain.handle(IPC.systemCheck, () => deps.syscheck(pluginPath));

  // -- repos -----------------------------------------------------------------
  ipcMain.handle(IPC.reposList, () => registry.list());

  ipcMain.handle(IPC.reposAdd, (_e, path: string) => {
    const ref = registry.add(path);
    watcher.watch(ref);
    return ref;
  });

  ipcMain.handle(IPC.reposRemove, (_e, id: string) => {
    watcher.unwatch(id);
    registry.remove(id);
  });

  ipcMain.handle(IPC.reposPick, async () => {
    const result = await dialog.showOpenDialog(win, { properties: ['openDirectory'] });
    if (result.canceled || result.filePaths.length === 0) return null;
    return result.filePaths[0];
  });

  // -- fleet -------------------------------------------------------------
  ipcMain.handle(IPC.fleetDigest, (_e, repoId: string) => {
    const repo = requireRepo(registry, repoId);
    return deps.digest(pluginPath, repo.path);
  });

  // -- artifact ------------------------------------------------------------
  ipcMain.handle(IPC.artifactRead, async (_e, repoId: string, relPath: string) => {
    assertArtifactPath(relPath);
    const repo = requireRepo(registry, repoId);
    const target = await resolveInsideRepo(repo.path, relPath);
    return readFile(target, 'utf8');
  });

  // -- run -------------------------------------------------------------------
  ipcMain.handle(IPC.runStart, (_e, repoId: string, prompt: string) =>
    startRun(repoId, buildStartPrompt(prompt)),
  );

  ipcMain.handle(IPC.runResume, (_e, repoId: string) => startRun(repoId, RESUME_PROMPT));

  ipcMain.handle(IPC.runStop, async (_e, runId: string) => {
    const entry = [...activeRuns.entries()].find(([, handle]) => handle.id === runId);
    if (!entry) return;
    await entry[1].stop();
  });

  // -- gate ------------------------------------------------------------------
  ipcMain.handle(IPC.gateApprove, async (_e, repoId: string, gate: Gate, notes: string) => {
    const repo = requireRepo(registry, repoId);
    const result = await deps.runWh(pluginPath, repo.path, ['approve', gate, notes]);
    return parseApproveResult(result);
  });

  ipcMain.handle(IPC.gateReject, async (_e, repoId: string, gate: Gate, notes: string) => {
    if (!notes || !notes.trim()) throw new Error('rejecting a gate requires notes');
    const repo = requireRepo(registry, repoId);
    const result = await deps.runWh(pluginPath, repo.path, ['approve', gate, '--reject', notes]);
    return parseApproveResult(result);
  });

  // -- settings ----------------------------------------------------------
  ipcMain.handle(IPC.settingsGet, () => settings.get());
  ipcMain.handle(IPC.settingsSet, (_e, patch: Partial<Settings>) => settings.set(patch));
  ipcMain.handle(IPC.settingsSetKey, (_e, key: string) => {
    settings.setApiKey(key);
  });
  ipcMain.handle(IPC.settingsHasKey, () => settings.hasApiKey());
  ipcMain.handle(IPC.settingsClearKey, () => {
    settings.clearApiKey();
  });

  // -- watch -------------------------------------------------------------
  watcher.on((e) => {
    win.webContents.send(IPC.watchDigest, e);
  });
}
