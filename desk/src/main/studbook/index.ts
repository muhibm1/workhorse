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
 * connected unverified for months before a Node client refused the chain and made it visible
 * (studbook/docs/paddock-gate.md). A missing CA file is a hard error, never an unverified
 * connection.
 */
import { readFileSync } from 'node:fs';
import pg from 'pg';
import { generateAnswer, type Answer } from './answer';
import { parseConninfo } from './conninfo';
import { createModels, type ModelProgress, type Models } from './models';
import { retrieveHybrid, type Passage, type Scope } from './retrieval';

export const RERANK_CANDIDATES = 20;
export const DEFAULT_TOP_K = 5;

export interface StudbookDeps {
  /** Decrypts the stored conninfo, or null when none is stored. Main-only. */
  readConninfo(): string | null;
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
}

export interface DbClient {
  query(text: string, values?: unknown[]): Promise<{ rows: Record<string, unknown>[] }>;
  end(): Promise<void>;
}

export interface StudbookStatus {
  /** A conninfo is stored. Says nothing about whether it connects. */
  configured: boolean;
  /** An Anthropic key is stored; /ask needs it, /search does not. */
  hasApiKey: boolean;
  models: 'cold' | 'loading' | 'ready';
  progress: ModelProgress | null;
  /** Corpus counts from the last successful connection, if any. */
  corpus: { documents: number; chunks: number } | null;
  /** The last error a call raised, so the screen can show it without a second round trip. */
  lastError: string | null;
}

export interface RepoScope {
  repo: string;
  changes: { changeId: string; documents: number }[];
}

export interface AskResult {
  question: string;
  answer: Answer;
  passages: Passage[];
}

export interface Studbook {
  status(): StudbookStatus;
  /** Opens a verified connection, counts the corpus, closes it. Proves the conninfo works. */
  check(): Promise<StudbookStatus>;
  repos(): Promise<RepoScope[]>;
  search(question: string, scope?: Scope, topK?: number): Promise<Passage[]>;
  ask(question: string, scope?: Scope, topK?: number): Promise<AskResult>;
}

async function defaultConnect(target: ReturnType<typeof parseConninfo>, ca: string): Promise<DbClient> {
  const client = new pg.Client({ ...target, ssl: { rejectUnauthorized: true, ca } });
  await client.connect();
  await client.query('set search_path to studbook, extensions');
  return client;
}

export function createStudbook(deps: StudbookDeps): Studbook {
  let progress: ModelProgress | null = null;
  let lastError: string | null = null;
  let corpus: StudbookStatus['corpus'] = null;

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

  async function retrieve(db: DbClient, question: string, scope: Scope, topK: number): Promise<Passage[]> {
    const [embedding] = await models.embed([question]);
    const candidates = await retrieveHybrid(db, question, embedding, RERANK_CANDIDATES, scope);
    return models.rerank(question, candidates, topK);
  }

  return {
    status() {
      return {
        configured: deps.readConninfo() !== null,
        hasApiKey: deps.readApiKey() !== null,
        models: models.ready() ? 'ready' : progress ? 'loading' : 'cold',
        progress,
        corpus,
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

    ask(question, scope = {}, topK = DEFAULT_TOP_K) {
      return remember(async () => {
        const apiKey = deps.readApiKey();
        if (!apiKey) throw new Error('studbook: no Anthropic API key is stored (Settings > Backend > API key)');
        const passages = await withDb((db) => retrieve(db, question, scope, topK));
        const answer = await generateAnswer(question, passages, { apiKey, model: deps.generatorModel });
        return { question, answer, passages };
      });
    },
  };
}
