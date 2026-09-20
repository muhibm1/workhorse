/**
 * The pipeline phases of plugin 0.3 (two-gates design, section 3). `intent`, `spec` and `plan`
 * are the pre-0.3 design phases: a change started under an older plugin still carries one in
 * its digest, so they stay in the union and read as `design` wherever a position matters
 * (`phaseIndex` in renderer/lib/polar.ts).
 */
export type Phase = 'design' | 'build' | 'verify' | 'review' | 'deploy' | 'done' | 'intent' | 'spec' | 'plan';
export type Gate = 'G1' | 'G2' | 'G3' | 'G4' | 'G5';

/**
 * What `WH clock` measures (hooks/scripts/lib.js `computeClock`): minutes the agents worked,
 * minutes the change waited on the human, dead time from service cut-offs, unexplained gaps,
 * and the wall total, against the tier's agent-minute budget. `human_minutes` is the time between
 * Paddock opening a packet (`gate_opened.<G>` in state) and the approval, or null when no gate
 * has been both opened here and decided.
 */
export interface Clock {
  agent_minutes: number;
  waiting_minutes: number;
  dead_minutes: number;
  gap_minutes: number;
  wall_minutes: number;
  human_minutes: number | null;
  budget_minutes: number;
  within_budget: boolean;
  tier: number;
  done: boolean;
  phases: { phase: string; agent_minutes: number }[];
  gaps: { from: string; to: string; minutes: number }[];
  /** Log rows plus approvals the clock was computed from; 0 means "no events yet". */
  events: number;
  started_at: string | null;
  ended_at: string | null;
}
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
  /** Plugin 0.3.0 and later. Optional so a digest from an older plugin still parses; read them
   *  through `gateName` / `gateLabel` (shared/gates.ts) and with a fallback, never bare. */
  gate_names?: Record<Gate, string>;
  /** Why the Ship document is not yet presentable (verification not green, an open finding). */
  ship_blockers?: string[];
  clock?: Clock;
  verification: 'none' | 'red' | 'green' | string;
  branch: string; pr_url: string; commit: string;
  problem: string; outcome: string; tldr: string; decisions: string[];
  decision_items?: { id: string; decision: string; recommendation: string; alternative: string }[];
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
  | { t: 'result'; subtype: string; costUsd?: number; numTurns?: number; durationMs?: number; sessionId?: string; isError?: boolean; at: number }
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
  /** ntfy-style push URL for "a gate is waiting on you" notifications; null = off. */
  notifyUrl: string | null;
}

export interface ApproveResult { gate: Gate; status: 'approved' | 'rejected'; who: string; at: string; committed: string | boolean; }

// ---------------------------------------------------------------- Studbook (main/studbook)

/** One retrieved passage: the receipt an answer's `[n]` chip opens. */
export interface StudbookPassage {
  number: number;
  chunkId: string;
  headingPath: string;
  repo: string;
  docType: string;
  body: string;
}

export interface StudbookCitation { number: number; chunkId: string; headingPath: string; repo: string; docType: string; }

export interface StudbookAnswer {
  question: string;
  answer: string;
  /** The answer is "Not in the record: ..." — retrieved passages are still listed, so it is checkable. */
  refused: boolean;
  citations: StudbookCitation[];
  passages: StudbookPassage[];
  model: string;
  inputTokens: number;
  outputTokens: number;
  /** What retrieval searched for. A fresh question searches for itself; a follow-up is rewritten
   *  into a standalone question, or falls back to the thread's questions joined together when the
   *  rewrite added words the thread does not contain (`rejected` is that rewrite) or the call
   *  failed. */
  search: StudbookSearch;
}

export interface StudbookSearch {
  query: string;
  method: 'fresh' | 'rewritten' | 'unchanged' | 'fallback-guard' | 'fallback-error';
  rejected?: string;
}

export interface StudbookScope { repo?: string | null; changeId?: string | null; }

/** One prior exchange, as the tab sends it back so a follow-up can resolve "it" or "that change". */
export interface StudbookHistoryTurn { question: string; answer: string; }

/** A turn in the tab's transcript: the answer (which carries its own question, citations and
 *  passages) plus the scope it was asked under, so the transcript shows what each answer saw. */
export interface StudbookTurn { answer: StudbookAnswer; scope: StudbookScope; at: number; }

export interface StudbookRepo { repo: string; changes: { changeId: string; documents: number }[]; }

export interface StudbookSyncProgress {
  repo: string;
  stage: 'walking' | 'embedding' | 'writing' | 'done';
  embedded?: number;
  toEmbed?: number;
}

export interface StudbookSyncStats {
  repo: string;
  documents: number;
  documentsDeleted: number;
  chunksEmbedded: number;
  chunksUnchanged: number;
  chunksDeleted: number;
}

export interface StudbookStatus {
  /** A database connection string is stored (Settings > Studbook). */
  configured: boolean;
  /** The ingest role's connection string is stored; "Refresh the record" needs it. */
  ingestConfigured: boolean;
  /** An Anthropic key is stored; asking needs it, searching does not. */
  hasApiKey: boolean;
  models: 'cold' | 'loading' | 'ready';
  progress: { stage: 'downloading' | 'loading' | 'ready'; file?: string; percent?: number } | null;
  corpus: { documents: number; chunks: number } | null;
  /** Non-null while a refresh is running. */
  sync: StudbookSyncProgress | null;
  /** Per-repo results of the last completed refresh, or null if none has run this session. */
  lastSync: StudbookSyncStats[] | null;
  lastError: string | null;
}

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
    /** Records `gate_opened.<G>` in the change's state so the clock can measure the human's
     *  reading time. Best effort: main logs a failure and resolves anyway. */
    opened(repoId: string, gate: Gate): Promise<void>;
  };
  settings: {
    get(): Promise<Settings>;
    set(patch: Partial<Settings>): Promise<Settings>;
    setApiKey(key: string): Promise<void>;
    hasApiKey(): Promise<boolean>;
    clearApiKey(): Promise<void>;
  };
  watch: { onDigest(cb: (e: { repoId: string; digests: ChangeDigest[]; onboarded: boolean }) => void): () => void };
  studbook: {
    status(): Promise<StudbookStatus>;
    /** Connects, counts the corpus, disconnects: proves the stored connection string works. */
    check(): Promise<StudbookStatus>;
    repos(): Promise<StudbookRepo[]>;
    search(question: string, scope?: StudbookScope, topK?: number): Promise<StudbookPassage[]>;
    /** `history` is the thread so far, oldest first; omit it (or pass none) for a fresh thread,
     *  which behaves exactly as a single question always has. `askId` tags the answer's chunks on
     *  `onAnswerChunk`, so a caller can show the answer arriving; it resolves complete either way. */
    ask(
      question: string,
      scope?: StudbookScope,
      topK?: number,
      history?: StudbookHistoryTurn[],
      askId?: string,
    ): Promise<StudbookAnswer>;
    /** Text deltas for an in-flight `ask`, tagged with the `askId` that asked for them. */
    onAnswerChunk(cb: (e: { askId: string; delta: string; snapshot: string }) => void): () => void;
    /** The Postgres connection string; stored encrypted in main and never readable back over IPC. */
    setConninfo(conninfo: string): Promise<void>;
    hasConninfo(): Promise<boolean>;
    clearConninfo(): Promise<void>;
    /** The ingest role's connection string, same rules. Needed only by `sync`. */
    setIngestConninfo(conninfo: string): Promise<void>;
    hasIngestConninfo(): Promise<boolean>;
    clearIngestConninfo(): Promise<void>;
    /** Re-ingests every registered repository into the store; resolves with per-repo results. */
    sync(): Promise<StudbookSyncStats[]>;
  };
}

declare global { interface Window { paddock: PaddockApi } }

/** Channel names shared by ipc.ts and preload. One string per handler. */
export const IPC = {
  systemCheck: 'system:check',
  reposList: 'repos:list', reposAdd: 'repos:add', reposRemove: 'repos:remove', reposPick: 'repos:pick',
  fleetDigest: 'fleet:digest',
  artifactRead: 'artifact:read',
  runStart: 'run:start', runResume: 'run:resume', runStop: 'run:stop', runEvent: 'run:event',
  gateApprove: 'gate:approve', gateReject: 'gate:reject', gateOpened: 'gate:opened',
  settingsGet: 'settings:get', settingsSet: 'settings:set', settingsSetKey: 'settings:setKey',
  settingsHasKey: 'settings:hasKey', settingsClearKey: 'settings:clearKey',
  watchDigest: 'watch:digest',
  studbookStatus: 'studbook:status', studbookCheck: 'studbook:check', studbookRepos: 'studbook:repos',
  studbookSearch: 'studbook:search', studbookAsk: 'studbook:ask',
  studbookSetConninfo: 'studbook:setConninfo', studbookHasConninfo: 'studbook:hasConninfo',
  studbookClearConninfo: 'studbook:clearConninfo',
  studbookSetIngestConninfo: 'studbook:setIngestConninfo', studbookHasIngestConninfo: 'studbook:hasIngestConninfo',
  studbookClearIngestConninfo: 'studbook:clearIngestConninfo', studbookSync: 'studbook:sync',
  studbookAnswerChunk: 'studbook:answerChunk',
} as const;
