import { readFile, realpath } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join as joinPath } from 'node:path';
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
import type { Studbook } from './studbook';
import { looksLikeConninfo } from './studbook/conninfo';
import { repoKeyFor } from './studbook/parser';
import { createAutoResume, createGateNotifier, createStallTimer, postNotification } from './autopilot';

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
  /** Optional so test fakes can omit it; when absent, anything that needs a confirmation is refused. */
  showMessageBox?(
    win: unknown,
    options: { type: string; buttons: string[]; defaultId: number; cancelId: number; message: string; detail: string },
  ): Promise<{ response: number }>;
}

/** Hosts gate notifications may go to without a confirmation dialog. */
const TRUSTED_NOTIFY_HOSTS = new Set(['ntfy.sh', 'localhost', '127.0.0.1']);
export interface WinLike {
  webContents: { send(channel: string, payload: unknown): void; isDestroyed?(): boolean };
  isDestroyed?(): boolean;
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
  /** Studbook's query path (main/studbook). Optional so tests of the other channels need no models. */
  studbook?: Studbook;
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
/** A repo is onboarded once `/workhorse:onboard` has written its profile. */
function isOnboarded(repoPath: string): boolean {
  return existsSync(joinPath(repoPath, '.workhorse', 'profile.yml'));
}

export function registerIpc(deps: IpcDeps): void {
  const { ipcMain, dialog, win, registry, settings, watcher, driverFor, pluginPath } = deps;

  /** At most one running run per repo (plan Task 10): keyed by repoId, cleared once the
   *  driver's event stream ends (including on `stop()`, which drains it to `exit`). */
  const activeRuns = new Map<string, RunHandle>();
  /** Last run id per repo, so autopilot notices land on the run the renderer is showing. */
  const lastRunId = new Map<string, string>();

  /**
   * Every send to the renderer goes through here. Timers (the stall watchdog, auto-resume) now
   * send with no user action, possibly after the window is gone (on macOS the app outlives its
   * window), and `send` on a destroyed webContents throws inside a bare timer callback, which
   * would crash main. Found by ecc-silent-failure-hunter.
   */
  function safeSend(channel: string, payload: unknown): void {
    if (win.isDestroyed?.() || win.webContents.isDestroyed?.()) return;
    try {
      win.webContents.send(channel, payload);
    } catch (err) {
      console.warn(`paddock: could not send ${channel} to the window: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  function sendNotice(repoId: string, text: string): void {
    const runId = lastRunId.get(repoId);
    if (!runId) return;
    const envelope: RunEnvelope = { runId, repoId, event: { t: 'notice', text, at: Date.now() } };
    safeSend(IPC.runEvent, envelope);
  }

  const autoResume = createAutoResume({
    resume: (repoId) => void startRun(repoId, RESUME_PROMPT),
    emit: sendNotice,
    hasActiveRun: (repoId) => activeRuns.has(repoId),
  });

  const STALL_MS = 10 * 60_000;

  async function pumpEvents(repoId: string, handle: RunHandle): Promise<void> {
    const stall = createStallTimer(STALL_MS, () =>
      sendNotice(repoId, 'no output for 10 minutes; the run may be stalled — check the log, or Stop and Resume'),
    );
    try {
      for await (const event of handle.events) {
        stall.poke();
        const envelope: RunEnvelope = { runId: handle.id, repoId, event };
        safeSend(IPC.runEvent, envelope);
        try {
          autoResume.onEvent(repoId, event);
        } catch (err) {
          // Autopilot is best-effort; it must never stop this run's events reaching the window.
          console.error(`paddock: auto-resume failed on a ${event.t} event: ${err instanceof Error ? err.message : String(err)}`);
        }
      }
    } finally {
      stall.stop();
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
    lastRunId.set(repoId, handle.id);
    void pumpEvents(repoId, handle);
    return { runId: handle.id };
  }

  // -- system --------------------------------------------------------------
  ipcMain.handle(IPC.systemCheck, () => deps.syscheck(pluginPath));

  // -- repos -----------------------------------------------------------------
  ipcMain.handle(IPC.reposList, () =>
    registry.list().map((r) => ({ ...r, onboarded: isOnboarded(r.path) })),
  );

  ipcMain.handle(IPC.reposAdd, (_e, path: string) => {
    const ref = registry.add(path);
    watcher.watch(ref);
    // A copy: the registry persists refs, and `onboarded` must never be written to disk.
    return { ...ref, onboarded: isOnboarded(ref.path) };
  });

  ipcMain.handle(IPC.reposRemove, (_e, id: string) => {
    // A removed repo must not wake up later: drop any scheduled auto-resume and its run id.
    autoResume.cancel(id);
    lastRunId.delete(id);
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
  // Any human action on a repo's runs supersedes a scheduled auto-resume for it.
  ipcMain.handle(IPC.runStart, (_e, repoId: string, prompt: string) => {
    autoResume.cancel(repoId);
    return startRun(repoId, buildStartPrompt(prompt));
  });

  ipcMain.handle(IPC.runResume, (_e, repoId: string) => {
    autoResume.cancel(repoId);
    return startRun(repoId, RESUME_PROMPT);
  });

  ipcMain.handle(IPC.runStop, async (_e, runId: string) => {
    const entry = [...activeRuns.entries()].find(([, handle]) => handle.id === runId);
    if (!entry) return;
    autoResume.cancel(entry[0]);
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
  ipcMain.handle(IPC.settingsSet, async (_e, patch: Partial<Settings>) => {
    // A notify host other than ntfy.sh or loopback is confirmed in a main-process dialog, which
    // renderer script cannot answer. Without it, script in a compromised renderer could point
    // gate notifications at its own server and get around the renderer's connect-src 'none'.
    // Flagged independently by wh-bug-reviewer and ecc-typescript-reviewer.
    const url = patch && typeof patch.notifyUrl === 'string' ? patch.notifyUrl.trim() : '';
    if (url && url !== settings.get().notifyUrl) {
      let host = '';
      try {
        host = new URL(url).hostname;
      } catch {
        // Not a URL: the settings sanitiser drops it, so there is nothing to confirm.
      }
      if (host && !TRUSTED_NOTIFY_HOSTS.has(host)) {
        const answer = dialog.showMessageBox
          ? await dialog.showMessageBox(win, {
              type: 'question',
              buttons: ['Allow', 'Cancel'],
              defaultId: 1,
              cancelId: 1,
              message: `Send gate notifications to ${host}?`,
              detail: 'Paddock will POST the repository name, change title, tier, and phase to this server whenever a gate is waiting on you.',
            })
          : { response: 1 };
        if (answer.response !== 0) {
          const { notifyUrl: _refused, ...rest } = patch;
          return settings.set(rest);
        }
      }
    }
    return settings.set(patch);
  });
  ipcMain.handle(IPC.settingsSetKey, (_e, key: string) => {
    settings.setApiKey(key);
  });
  ipcMain.handle(IPC.settingsHasKey, () => settings.hasApiKey());
  ipcMain.handle(IPC.settingsClearKey, () => {
    settings.clearApiKey();
  });

  // -- studbook ----------------------------------------------------------
  // The connection string is the one input a renderer supplies that main will use to open a
  // network connection. It is validated for shape, stored encrypted, and never read back over
  // IPC; the connection itself is always made with the pinned CA (main/studbook/index.ts), so a
  // renderer-supplied string cannot pick where the TLS trust comes from.
  const MAX_CONNINFO_LENGTH = 4096;
  ipcMain.handle(IPC.studbookSetConninfo, (_e, conninfo: unknown) => {
    if (typeof conninfo !== 'string' || !conninfo.trim() || conninfo.length > MAX_CONNINFO_LENGTH) {
      throw new Error('a connection string is required');
    }
    if (!looksLikeConninfo(conninfo)) {
      throw new Error('not a Postgres connection string: expected `host=... user=... password=... dbname=...` or postgres://...');
    }
    settings.setStudbookConninfo(conninfo.trim());
  });
  ipcMain.handle(IPC.studbookHasConninfo, () => settings.hasStudbookConninfo());
  ipcMain.handle(IPC.studbookClearConninfo, () => {
    settings.clearStudbookConninfo();
  });
  ipcMain.handle(IPC.studbookSetIngestConninfo, (_e, conninfo: unknown) => {
    if (typeof conninfo !== 'string' || !conninfo.trim() || conninfo.length > MAX_CONNINFO_LENGTH) {
      throw new Error('a connection string is required');
    }
    if (!looksLikeConninfo(conninfo)) {
      throw new Error('not a Postgres connection string: expected `host=... user=... password=... dbname=...` or postgres://...');
    }
    settings.setStudbookIngestConninfo(conninfo.trim());
  });
  ipcMain.handle(IPC.studbookHasIngestConninfo, () => settings.hasStudbookIngestConninfo());
  ipcMain.handle(IPC.studbookClearIngestConninfo, () => {
    settings.clearStudbookIngestConninfo();
  });
  // The repositories to refresh are Paddock's own registry -- never a renderer-supplied path --
  // keyed the way the store names them (folder name, lowercased).
  ipcMain.handle(IPC.studbookSync, () =>
    requireStudbook().sync(registry.list().map((r) => ({ key: repoKeyFor(r.path), path: r.path }))),
  );

  const MAX_QUESTION_LENGTH = 2000;
  function requireStudbook(): Studbook {
    if (!deps.studbook) throw new Error('Studbook is not available in this build');
    return deps.studbook;
  }
  function checkQuestion(question: unknown): string {
    if (typeof question !== 'string' || !question.trim()) throw new Error('a question is required');
    if (question.length > MAX_QUESTION_LENGTH) throw new Error(`questions are limited to ${MAX_QUESTION_LENGTH} characters`);
    return question.trim();
  }
  function checkScope(scope: unknown): { repo?: string | null; changeId?: string | null } {
    if (!scope || typeof scope !== 'object') return {};
    const s = scope as Record<string, unknown>;
    return {
      repo: typeof s.repo === 'string' && s.repo ? s.repo : null,
      changeId: typeof s.changeId === 'string' && s.changeId ? s.changeId : null,
    };
  }
  function checkTopK(topK: unknown): number | undefined {
    if (topK === undefined || topK === null) return undefined;
    const n = Number(topK);
    if (!Number.isInteger(n) || n < 1 || n > 20) throw new Error('topK must be an integer from 1 to 20');
    return n;
  }

  ipcMain.handle(IPC.studbookStatus, () => requireStudbook().status());
  ipcMain.handle(IPC.studbookCheck, () => requireStudbook().check());
  ipcMain.handle(IPC.studbookRepos, () => requireStudbook().repos());
  ipcMain.handle(IPC.studbookSearch, async (_e, question: unknown, scope?: unknown, topK?: unknown) => {
    const passages = await requireStudbook().search(checkQuestion(question), checkScope(scope), checkTopK(topK));
    return passages.map((p, i) => ({ number: i + 1, ...p }));
  });
  ipcMain.handle(IPC.studbookAsk, async (_e, question: unknown, scope?: unknown, topK?: unknown) => {
    const result = await requireStudbook().ask(checkQuestion(question), checkScope(scope), checkTopK(topK));
    return {
      question: result.question,
      answer: result.answer.text,
      refused: result.answer.refused,
      citations: result.answer.citations,
      passages: result.passages.map((p, i) => ({ number: i + 1, ...p })),
      model: result.answer.model,
      inputTokens: result.answer.inputTokens,
      outputTokens: result.answer.outputTokens,
    };
  });

  // -- watch -------------------------------------------------------------
  const gateNotifier = createGateNotifier({
    getUrl: () => settings.get().notifyUrl,
    // A failed push must not be silent: the user believes their phone is covering the gates.
    post: (url, n, repoId) =>
      void postNotification(url, n).then((ok) => {
        if (ok) return;
        console.warn(`paddock: phone notification to the configured URL failed (${n.title})`);
        sendNotice(repoId, 'phone notification failed; check the URL in Settings > Phone notifications');
      }),
  });

  watcher.on((e) => {
    const repo = registry.get(e.repoId);
    safeSend(IPC.watchDigest, { ...e, onboarded: repo ? isOnboarded(repo.path) : false });
    gateNotifier.onDigests(e.repoId, repo?.name ?? e.repoId, e.digests);
  });
}
