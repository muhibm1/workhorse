/**
 * The renderer's one Zustand store (spec 5.1: "the renderer is pure UI... fed by IPC events").
 *
 * Every call into `window.paddock` goes through the local `api()` accessor rather than touching
 * `window` directly, so `tests/store.test.ts` can drive the async actions by stubbing
 * `globalThis.window = { paddock: fakeApi } as Window` — no real preload bridge, no Electron.
 *
 * `applyEvent` is exported as a plain, pure function — `(run: RunState, envelope: RunEnvelope) =>
 * RunState` — separately from the store action of the same name, so tests can thread a sequence
 * of envelopes through it directly without touching Zustand at all. The store action is a thin
 * wrapper that looks up (or creates) the repo's `RunState` and calls this reducer.
 */
import { create } from 'zustand';
import type {
  ChangeDigest,
  Gate,
  PaddockApi,
  RepoRef,
  RunEnvelope,
  Settings,
  SysCheck,
} from '@shared/types';
import type { RingTone } from '@/lib/orbState';

export interface RunState {
  runId: string | null;
  running: boolean;
  error: string | null;
  agents: Record<string, { agentType: string; description: string; startedAt: number; stoppedAt?: number }>;
  log: { at: number; text: string; tone?: RingTone }[];
  costUsd: number;
  sessionId: string | null;
}

export type Screen =
  | { name: 'setup' }
  | { name: 'fleet' }
  | { name: 'run'; repoId: string }
  | { name: 'gate'; repoId: string; gate: Gate; artifact?: string }
  | { name: 'settings' };

export interface PaddockState {
  sys: SysCheck | null;
  settings: Settings | null;
  hasApiKey: boolean;
  repos: RepoRef[];
  digests: Record<string, ChangeDigest[]>;
  runs: Record<string, RunState>;
  screen: Screen;

  boot(): Promise<void>;
  go(screen: Screen): void;
  addRepo(): Promise<void>;
  addRepoPath(path: string): Promise<void>;
  removeRepo(id: string): Promise<void>;
  startRun(repoId: string, prompt: string): Promise<void>;
  resumeRun(repoId: string): Promise<void>;
  stopRun(repoId: string): Promise<void>;
  approve(repoId: string, gate: Gate, notes: string): Promise<void>;
  reject(repoId: string, gate: Gate, notes: string): Promise<void>;
  /** Merges one normalised run event into `runs[e.repoId]` via the pure `applyEvent` reducer. */
  applyEvent(e: RunEnvelope): void;
  /** Replaces `digests[repoId]`, newest `updated_at` first (see `activeDigest`). */
  applyDigest(repoId: string, digests: ChangeDigest[]): void;
  setOnboarded(repoId: string, onboarded: boolean): void;
  /** The newest digest for a repo by `updated_at`, or `null` when none has arrived yet. */
  activeDigest(repoId: string): ChangeDigest | null;
}

/** A freshly started (or resumed) run: nothing has happened yet, but it is running. */
export function createRunState(runId: string | null = null): RunState {
  return { runId, running: true, error: null, agents: {}, log: [], costUsd: 0, sessionId: null };
}

/**
 * `boot()` is called again by Setup's "Check again" button, so the IPC subscriptions must not be
 * registered per call: each extra registration would replay every run event and digest into the
 * reducer N times, duplicating log lines and agent chips. Registering once is enough — both
 * listeners live as long as the window does, so there is nothing to tear down.
 */
let subscribed = false;
function subscribeOnce(get: () => PaddockState): void {
  if (subscribed) return;
  subscribed = true;
  api().run.onEvent((e) => get().applyEvent(e));
  api().watch.onDigest((e) => {
    get().applyDigest(e.repoId, e.digests);
    get().setOnboarded(e.repoId, e.onboarded);
  });
}

/** Test-only: lets a test re-exercise the subscribe-once path. */
export function __resetSubscriptionsForTest(): void {
  subscribed = false;
}

const LOG_CAP = 500;

/** Appends one line, dropping the oldest once the log would exceed the 500-line cap. */
function appendLog(log: RunState['log'], line: RunState['log'][number]): RunState['log'] {
  const next = log.length === 0 ? [line] : [...log, line];
  return next.length > LOG_CAP ? next.slice(next.length - LOG_CAP) : next;
}

/** `wh-builder` -> `builder`, matching the short names the Run screen's satellites use (spec 2.2). */
function shortAgentName(agentType: string): string {
  return agentType.replace(/^wh-/, '');
}

/**
 * Pure reducer: one `RunState` plus one envelope in, the next `RunState` out. Always stamps
 * `runId` from the envelope, since a `RunState` in the store corresponds to exactly one run.
 *
 * Rules (plan Task 9): `agent:start` adds an agent; `agent:stop` sets its `stoppedAt`; `tool`
 * appends a `tool <name>` log line (prefixed with the agent's short name when attributed);
 * `text` appends its first 160 characters; `result` stops the run and records `costUsd`; `error`
 * records the error message; `exit` stops the run. `init`, `notice` and `error` also add a log
 * line so the rail has something to show; `agent:progress` and `tool:result` carry no field this
 * state shape tracks, so they only re-stamp `runId`.
 */
export function applyEvent(run: RunState, envelope: RunEnvelope): RunState {
  const { runId, event } = envelope;
  const base: RunState = { ...run, runId };

  switch (event.t) {
    case 'init':
      return { ...base, sessionId: event.sessionId };

    case 'agent:start':
      return {
        ...base,
        agents: {
          ...base.agents,
          [event.agentId]: { agentType: event.agentType, description: event.description, startedAt: event.at },
        },
      };

    case 'agent:progress':
      return base;

    case 'agent:stop': {
      const existing = base.agents[event.agentId] ?? {
        agentType: event.agentType,
        description: '',
        startedAt: event.at,
      };
      return { ...base, agents: { ...base.agents, [event.agentId]: { ...existing, stoppedAt: event.at } } };
    }

    case 'tool': {
      const agent = event.agentId ? base.agents[event.agentId] : undefined;
      const text = agent ? `[${shortAgentName(agent.agentType)}] tool ${event.name}` : `tool ${event.name}`;
      return { ...base, log: appendLog(base.log, { at: event.at, text }) };
    }

    case 'tool:result':
      return base;

    case 'text':
      return { ...base, log: appendLog(base.log, { at: event.at, text: event.text.slice(0, 160) }) };

    case 'notice':
      return { ...base, log: appendLog(base.log, { at: event.at, text: event.text, tone: 'amber' }) };

    case 'result':
      return {
        ...base,
        running: false,
        costUsd: event.costUsd ?? base.costUsd,
        log: appendLog(base.log, { at: event.at, text: `result: ${event.subtype}`, tone: 'mint' }),
      };

    case 'error':
      return {
        ...base,
        error: event.message,
        log: appendLog(base.log, { at: event.at, text: `error: ${event.message}`, tone: 'coral' }),
      };

    case 'exit':
      return { ...base, running: false };

    default:
      return base;
  }
}

/** Newest first, by `updated_at` (ISO-8601, so lexicographic order is chronological order). */
function sortByUpdatedAtDesc(digests: ChangeDigest[]): ChangeDigest[] {
  return [...digests].sort((a, b) => (a.updated_at < b.updated_at ? 1 : a.updated_at > b.updated_at ? -1 : 0));
}

/**
 * The only place this module reads `window.paddock`. Isolated so `boot`/`addRepo`/etc. can be
 * exercised in tests by stubbing `globalThis.window` — no Electron, no real preload bridge.
 */
function api(): PaddockApi {
  const w = (globalThis as typeof globalThis & { window?: Window }).window;
  const paddock = w?.paddock;
  if (!paddock) throw new Error('window.paddock is unavailable: no preload bridge on this window');
  return paddock;
}

export const usePaddockStore = create<PaddockState>()((set, get) => ({
  sys: null,
  settings: null,
  hasApiKey: false,
  repos: [],
  digests: {},
  runs: {},
  screen: { name: 'setup' },

  async boot() {
    const [sys, settings, hasApiKey, repos] = await Promise.all([
      api().system.check(),
      api().settings.get(),
      api().settings.hasApiKey(),
      api().repos.list(),
    ]);
    const ready = sys.node.ok && sys.claude.ok;
    set((s) => {
      // Not ready: always show Setup. Ready and still on the initial Setup screen: move on to
      // Fleet. Ready and already somewhere else (a "check again" re-boot): leave navigation alone.
      const screen: Screen = !ready ? { name: 'setup' } : s.screen.name === 'setup' ? { name: 'fleet' } : s.screen;
      return { sys, settings, hasApiKey, repos, screen };
    });

    await Promise.all(
      repos.map(async (repo) => {
        try {
          get().applyDigest(repo.id, await api().fleet.digest(repo.id));
        } catch {
          // left empty; the watcher's first emission (below) fills it in
        }
      }),
    );

    subscribeOnce(get);
  },

  go(screen) {
    set({ screen });
  },

  setOnboarded(repoId, onboarded) {
    set((s) => ({
      repos: s.repos.map((r) => (r.id === repoId && r.onboarded !== onboarded ? { ...r, onboarded } : r)),
    }));
  },

  async addRepo() {
    const path = await api().repos.pickFolder();
    if (path) await get().addRepoPath(path);
  },

  async addRepoPath(path) {
    const ref = await api().repos.add(path);
    set((s) => ({ repos: s.repos.some((r) => r.id === ref.id) ? s.repos : [...s.repos, ref] }));
    try {
      get().applyDigest(ref.id, await api().fleet.digest(ref.id));
    } catch {
      // left empty; the watcher fills it in once it has scanned the repo
    }
  },

  async removeRepo(id) {
    await api().repos.remove(id);
    set((s) => {
      const digests = { ...s.digests };
      const runs = { ...s.runs };
      delete digests[id];
      delete runs[id];
      return { repos: s.repos.filter((r) => r.id !== id), digests, runs };
    });
  },

  async startRun(repoId, prompt) {
    const { runId } = await api().run.start(repoId, prompt);
    set((s) => ({ runs: { ...s.runs, [repoId]: createRunState(runId) } }));
  },

  async resumeRun(repoId) {
    const { runId } = await api().run.resume(repoId);
    set((s) => ({ runs: { ...s.runs, [repoId]: createRunState(runId) } }));
  },

  async stopRun(repoId) {
    const runId = get().runs[repoId]?.runId;
    if (runId) await api().run.stop(runId);
  },

  async approve(repoId, gate, notes) {
    await api().gate.approve(repoId, gate, notes);
    get().applyDigest(repoId, await api().fleet.digest(repoId));
  },

  async reject(repoId, gate, notes) {
    await api().gate.reject(repoId, gate, notes);
    get().applyDigest(repoId, await api().fleet.digest(repoId));
  },

  applyEvent(e) {
    set((s) => {
      const prev = s.runs[e.repoId] ?? createRunState(e.runId);
      return { runs: { ...s.runs, [e.repoId]: applyEvent(prev, e) } };
    });
  },

  applyDigest(repoId, digests) {
    set((s) => ({ digests: { ...s.digests, [repoId]: sortByUpdatedAtDesc(digests) } }));
  },

  activeDigest(repoId) {
    return get().digests[repoId]?.[0] ?? null;
  },
}));
