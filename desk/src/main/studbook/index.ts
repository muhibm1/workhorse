/**
 * Studbook inside Paddock: the query path of studbook (the RAG assistant over WorkHorse's own
 * engineering record) running in the main process — no Python, no service, no port, no API key
 * to paste. Ingestion and the eval harness stay in the studbook repo; this only reads the store.
 *
 * Secrets never leave main. The database conninfo is read through `deps.readConninfo` (stored
 * encrypted by settings.ts, like the Anthropic key) and the Anthropic key through
 * `deps.readApiKey`; neither is ever part of an IPC return value.
 *
 * Every database connection verifies the server against Supabase's pinned root certificate
 * (`sslmode=verify-full`'s equivalent: `rejectUnauthorized: true` with `ca`). Supabase signs its
 * database certificates with its own root, which no public CA store contains; the Python side
 * connected unverified from its first commit until a Node client refused the chain and made it visible
 * (studbook/docs/paddock-gate.md). A missing CA file is a hard error, never an unverified
 * connection.
 */
import { readFileSync } from 'node:fs';
import pg from 'pg';
import { generateAnswer, type Answer, type HistoryTurn } from './answer';
import { parseConninfo } from './conninfo';
import { createModels, type ModelProgress, type Models } from './models';
import { retrieveHybrid, type Passage, type Scope } from './retrieval';
import { rewriteQuery, type Rewrite } from './rewrite';
import { syncRepo, type SyncProgress, type SyncStats } from './sync';

/**
 * How many fused candidates the cross-encoder re-scores. It is the dominant cost of a query --
 * reranking is the slow step, not generation -- and 10 was measured against 20 on dev: recall@5
 * 0.8529 against 0.8235, precision 0.1882 against 0.1824, MRR 0.6385 against 0.6485, and end-to-end
 * answer quality a wash (correctness 1.513 against 1.500, three questions better and five worse,
 * which is noise at n=34). The wall clock is not a wash: 147s against 320s over the same 34
 * questions. Changed for the latency, not on a quality claim (studbook/docs/retrieval-ceiling.md).
 */
export const RERANK_CANDIDATES = 10;
export const DEFAULT_TOP_K = 5;
/**
 * A follow-up is searched for as a rewritten, standalone question (rewrite.ts); a fresh question
 * is searched for as itself, so it retrieves exactly what the eval measures and the parity gate
 * holds to the published numbers.
 *
 * Measured on two sets (studbook/docs/follow-ups.md, `eval/rewrite.py`), recall@5 of the passage
 * the question needs:
 *
 *                                     alone   previous + question   rewrite
 *   genuine follow-ups (n=12)          2/12          8/12             11/12
 *   a change of subject (n=34)        29/34         20/34             30/34
 *
 * The concatenation this replaced was a bet that the next question follows on; the rewrite does
 * not have to bet, because it can see whether the question names its own subject. 11/12 is also
 * what the fully-specified original questions manage, so on that set it is at the ceiling.
 *
 * Retrieval AND the rerank use the rewrite: the cross-encoder scoring against a self-contained
 * question beat scoring against the follow-up as typed (11/12 against 10/12), and that is the
 * configuration that was measured. The answer itself is still generated for the question the user
 * asked, with the thread as prior messages.
 */
export type { Rewrite } from './rewrite';

export interface StudbookDeps {
  /** Decrypts the stored conninfo, or null when none is stored. Main-only. */
  readConninfo(): string | null;
  /** The ingest role's conninfo (read/write on documents and chunks), for `sync`. Main-only. */
  readIngestConninfo(): string | null;
  /** Decrypts the stored Anthropic key, or null. Main-only. */
  readApiKey(): string | null;
  /** Path to Supabase's root certificate (resources/studbook/supabase-ca.pem). */
  caPath: string;
  /** Where model files are cached (under userData, so they live with the app's data). */
  modelCacheDir: string;
  models?: Models;
  /** Test seam for the database. */
  connect?: (target: ReturnType<typeof parseConninfo>, ca: string) => Promise<DbClient>;
  generatorModel?: string;
  /** Test seam for the follow-up rewrite. */
  rewrite?: typeof rewriteQuery;
}

export interface DbClient {
  query(text: string, values?: unknown[]): Promise<{ rows: Record<string, unknown>[] }>;
  end(): Promise<void>;
}

export interface StudbookStatus {
  /** A conninfo is stored. Says nothing about whether it connects. */
  configured: boolean;
  /** The ingest role's conninfo is stored; `sync` needs it. */
  ingestConfigured: boolean;
  /** An Anthropic key is stored; /ask needs it, /search does not. */
  hasApiKey: boolean;
  models: 'cold' | 'loading' | 'ready';
  progress: ModelProgress | null;
  /** Corpus counts from the last successful connection, if any. */
  corpus: { documents: number; chunks: number } | null;
  /** Non-null while a sync is running. */
  sync: SyncProgress | null;
  /** Per-repo results of the last completed sync this session. */
  lastSync: SyncStats[] | null;
  /** The last error a call raised, so the screen can show it without a second round trip. */
  lastError: string | null;
}

export interface SyncTarget {
  /** The store's key for the repository: its folder name, lowercased (parser.ts `repoKeyFor`). */
  key: string;
  path: string;
}

export interface RepoScope {
  repo: string;
  changes: { changeId: string; documents: number }[];
}

export interface AskResult {
  question: string;
  answer: Answer;
  passages: Passage[];
  /** What retrieval searched for, and how it got there -- shown with the answer, because a
   *  rewritten search is part of the receipt. */
  search: Rewrite;
}

export interface Studbook {
  status(): StudbookStatus;
  /** Opens a verified connection, counts the corpus, closes it. Proves the conninfo works. */
  check(): Promise<StudbookStatus>;
  repos(): Promise<RepoScope[]>;
  search(question: string, scope?: Scope, topK?: number): Promise<Passage[]>;
  /** `history` is the thread so far, oldest first; empty is a fresh question. `onDelta` sees the
   *  answer as it is written; the result resolves complete whether or not anyone is watching. */
  ask(
    question: string,
    scope?: Scope,
    topK?: number,
    history?: HistoryTurn[],
    onDelta?: (delta: string, snapshot: string) => void,
  ): Promise<AskResult>;
  /** Re-ingests each target repository through the ingest role. One at a time; refuses to overlap. */
  sync(targets: SyncTarget[]): Promise<SyncStats[]>;
}

/**
 * Run on every connection, the same statement as studbook's store/connect.py READER_SESSION. The
 * second setting matters at scale: pgvector's HNSW index returns ef_search candidates (40) and the
 * scope filters them afterwards, so a scoped search -- one repository, one change -- can keep none.
 * Forced onto the index path it returned 0 of 20 without this and 20 of 20 with it (2026-09-18).
 * At today's corpus size the planner sorts instead and never hits it; as the corpus grows it would
 * surface silently. strict_order keeps exact distance order, which fusion and the reranker rely on.
 */
export const SESSION_SETUP = 'set search_path to studbook, extensions; set hnsw.iterative_scan = strict_order';

async function defaultConnect(target: ReturnType<typeof parseConninfo>, ca: string): Promise<DbClient> {
  const client = new pg.Client({ ...target, ssl: { rejectUnauthorized: true, ca } });
  await client.connect();
  await client.query(SESSION_SETUP);
  return client;
}

export function createStudbook(deps: StudbookDeps): Studbook {
  let progress: ModelProgress | null = null;
  let lastError: string | null = null;
  let corpus: StudbookStatus['corpus'] = null;
  let syncProgress: SyncProgress | null = null;
  let lastSync: SyncStats[] | null = null;

  const models =
    deps.models ??
    createModels({
      cacheDir: deps.modelCacheDir,
      onProgress: (p) => {
        progress = p;
      },
    });

  function ca(): string {
    try {
      return readFileSync(deps.caPath, 'utf8');
    } catch {
      throw new Error(`studbook: ${deps.caPath} is missing; refusing to open an unverified database connection`);
    }
  }

  /** Per request, not long-lived: cheap next to the model work, and a pooled connection held
   *  across requests is the thing most likely to have gone stale by the next one. */
  async function withDb<T>(fn: (db: DbClient) => Promise<T>): Promise<T> {
    const conninfo = deps.readConninfo();
    if (!conninfo) throw new Error('studbook: no database connection string is stored (Settings > Studbook)');
    const db = await (deps.connect ?? defaultConnect)(parseConninfo(conninfo), ca());
    try {
      return await fn(db);
    } finally {
      await db.end().catch(() => undefined);
    }
  }

  /** Records the failure for `status()` and rethrows, so the screen sees the same message twice. */
  async function remember<T>(work: () => Promise<T>): Promise<T> {
    try {
      const result = await work();
      lastError = null;
      return result;
    } catch (err) {
      lastError = err instanceof Error ? err.message : String(err);
      throw err;
    }
  }

  /** `query` is what the arms search for; `question` is what the cross-encoder re-scores against.
   *  For a follow-up both are the rewrite (see the note on `Rewrite` above). */
  async function retrieve(db: DbClient, question: string, scope: Scope, topK: number, query = question): Promise<Passage[]> {
    const [embedding] = await models.embed([query]);
    const candidates = await retrieveHybrid(db, query, embedding, RERANK_CANDIDATES, scope);
    return models.rerank(question, candidates, topK);
  }

  return {
    status() {
      return {
        configured: deps.readConninfo() !== null,
        ingestConfigured: deps.readIngestConninfo() !== null,
        hasApiKey: deps.readApiKey() !== null,
        models: models.ready() ? 'ready' : progress ? 'loading' : 'cold',
        progress,
        corpus,
        sync: syncProgress,
        lastSync,
        lastError,
      };
    },

    check() {
      return remember(async () => {
        await withDb(async (db) => {
          const { rows } = await db.query(
            'select (select count(*) from studbook.documents) as documents, (select count(*) from studbook.chunks) as chunks',
          );
          corpus = { documents: Number(rows[0].documents), chunks: Number(rows[0].chunks) };
        });
        return this.status();
      });
    },

    repos() {
      return remember(() =>
        withDb(async (db) => {
          const { rows } = await db.query(
            'select d.repo, d.change_id, count(*)::int as n from studbook.documents d ' +
              'group by d.repo, d.change_id order by d.repo, d.change_id nulls first',
          );
          const grouped = new Map<string, RepoScope['changes']>();
          for (const r of rows) {
            const repo = String(r.repo);
            if (!grouped.has(repo)) grouped.set(repo, []);
            if (r.change_id) grouped.get(repo)!.push({ changeId: String(r.change_id), documents: Number(r.n) });
          }
          return [...grouped.entries()].map(([repo, changes]) => ({ repo, changes }));
        }),
      );
    },

    search(question, scope = {}, topK = DEFAULT_TOP_K) {
      return remember(() => withDb((db) => retrieve(db, question, scope, topK)));
    },

    ask(question, scope = {}, topK = DEFAULT_TOP_K, history = [], onDelta) {
      return remember(async () => {
        const apiKey = deps.readApiKey();
        if (!apiKey) throw new Error('studbook: no Anthropic API key is stored (Settings > Backend > API key)');
        const search = await (deps.rewrite ?? rewriteQuery)(question, history.map((t) => t.question), { apiKey });
        const passages = await withDb((db) => retrieve(db, search.query, scope, topK, search.query));
        const answer = await generateAnswer(question, passages, {
          apiKey, model: deps.generatorModel, history, onDelta,
        });
        return { question, answer, passages, search };
      });
    },

    sync(targets) {
      return remember(async () => {
        if (syncProgress) throw new Error('studbook: a refresh is already running');
        const conninfo = deps.readIngestConninfo();
        if (!conninfo) {
          throw new Error('studbook: no ingest connection string is stored (Settings > Studbook > Refresh)');
        }
        const results: SyncStats[] = [];
        try {
          for (const target of targets) {
            syncProgress = { repo: target.key, stage: 'walking' };
            const db = await (deps.connect ?? defaultConnect)(parseConninfo(conninfo), ca());
            try {
              results.push(
                await syncRepo(db, target.key, target.path, {
                  models,
                  onProgress: (p) => {
                    syncProgress = p;
                  },
                }),
              );
            } finally {
              await db.end().catch(() => undefined);
            }
          }
        } finally {
          syncProgress = null;
        }
        lastSync = results;
        corpus = null; // counts are stale until the next check()
        return results;
      });
    },
  };
}
