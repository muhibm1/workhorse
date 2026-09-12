export type Phase = 'intent' | 'spec' | 'plan' | 'build' | 'verify' | 'review' | 'deploy' | 'done';
export type Gate = 'G1' | 'G2' | 'G3' | 'G4' | 'G5';
export type GateStatus = 'pending' | 'auto' | 'approved' | 'rejected' | 'n/a';
export type Backend = 'cli' | 'sdk';

export interface RepoRef {
  id: string;
  path: string;
  name: string;
  addedAt: string;
  /**
   * Whether `.workhorse/profile.yml` exists. Computed by main on list, add, and every watcher
   * event, never persisted: it changes mid-session when an onboarding run writes the profile.
   * Inferring it from "has any change digests" was wrong, since a freshly onboarded repo has a
   * profile but no changes yet and so kept offering to be onboarded again.
   */
  onboarded?: boolean;
}

/** Exactly what `wh.js digest` prints. */
export interface ChangeDigest {
  change_id: string; title: string; client: string; repo: string;
  tier: number; tier_reason: string; phase: Phase; mode: 'normal' | 'fix';
  status_label: string; waiting_on: string; blocking_gate: Gate | null;
  gates: Record<Gate, GateStatus>; required_human_gates: Gate[];
  verification: 'none' | 'red' | 'green' | string;
  branch: string; pr_url: string; commit: string;
  problem: string; outcome: string; tldr: string; decisions: string[];
  last_approval: { gate: Gate; status: 'approved' | 'rejected'; who: string; at: string; notes: string } | null;
  artifacts: string[]; artifact_dir: string;
  tracker: { provider: string; database: string; page_id: string | null };
  updated_at: string;
}

export type RunEvent =
  | { t: 'init'; sessionId: string; plugins: string[]; skills: string[]; at: number }
  | { t: 'agent:start'; agentId: string; agentType: string; description: string; toolUseId: string; at: number }
  | { t: 'agent:progress'; agentId: string; lastTool?: string; totalTokens?: number; toolUses?: number; at: number }
  | { t: 'agent:stop'; agentId: string; agentType: string; summary?: string; totalTokens?: number; durationMs?: number; at: number }
  | { t: 'tool'; toolUseId: string; name: string; agentId?: string; at: number }
  | { t: 'tool:result'; toolUseId: string; isError: boolean; agentId?: string; at: number }
  | { t: 'text'; text: string; agentId?: string; at: number }
  | { t: 'notice'; text: string; at: number }
  | { t: 'result'; subtype: string; costUsd?: number; numTurns?: number; durationMs?: number; sessionId?: string; at: number }
  | { t: 'error'; message: string; at: number }
  | { t: 'exit'; code: number | null; at: number };

export interface RunEnvelope { runId: string; repoId: string; event: RunEvent; }

export interface SysCheck {
  node: { ok: boolean; version: string | null; path: string | null };
  claude: { ok: boolean; version: string | null; path: string | null };
  plugin: { path: string; version: string | null; bundled: boolean };
}

export interface Settings {
  backend: Backend;
  pluginPath: string | null;
  allowedTools: Record<string, string[]>;
  theme: 'dark';
}

export interface ApproveResult { gate: Gate; status: 'approved' | 'rejected'; who: string; at: string; committed: string | boolean; }

export interface PaddockApi {
  system: { check(): Promise<SysCheck> };
  repos: {
    list(): Promise<RepoRef[]>;
    add(path: string): Promise<RepoRef>;
    remove(id: string): Promise<void>;
    pickFolder(): Promise<string | null>;
  };
  fleet: { digest(repoId: string): Promise<ChangeDigest[]> };
  artifact: { read(repoId: string, relPath: string): Promise<string> };
  run: {
    start(repoId: string, prompt: string): Promise<{ runId: string }>;
    resume(repoId: string): Promise<{ runId: string }>;
    stop(runId: string): Promise<void>;
    onEvent(cb: (e: RunEnvelope) => void): () => void;
  };
  gate: {
    approve(repoId: string, gate: Gate, notes: string): Promise<ApproveResult>;
    reject(repoId: string, gate: Gate, notes: string): Promise<ApproveResult>;
  };
  settings: {
    get(): Promise<Settings>;
    set(patch: Partial<Settings>): Promise<Settings>;
    setApiKey(key: string): Promise<void>;
    hasApiKey(): Promise<boolean>;
    clearApiKey(): Promise<void>;
  };
  watch: { onDigest(cb: (e: { repoId: string; digests: ChangeDigest[]; onboarded: boolean }) => void): () => void };
}

declare global { interface Window { paddock: PaddockApi } }

/** Channel names shared by ipc.ts and preload. One string per handler. */
export const IPC = {
  systemCheck: 'system:check',
  reposList: 'repos:list', reposAdd: 'repos:add', reposRemove: 'repos:remove', reposPick: 'repos:pick',
  fleetDigest: 'fleet:digest',
  artifactRead: 'artifact:read',
  runStart: 'run:start', runResume: 'run:resume', runStop: 'run:stop', runEvent: 'run:event',
  gateApprove: 'gate:approve', gateReject: 'gate:reject',
  settingsGet: 'settings:get', settingsSet: 'settings:set', settingsSetKey: 'settings:setKey',
  settingsHasKey: 'settings:hasKey', settingsClearKey: 'settings:clearKey',
  watchDigest: 'watch:digest',
} as const;
