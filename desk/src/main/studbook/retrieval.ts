/**
 * Studbook retrieval, ported from `studbook/retrieve/hybrid.py`: nearest neighbours by cosine
 * over pgvector's HNSW index, Postgres full-text search with the question's own stemmed lexemes
 * OR'd together, and reciprocal rank fusion to merge the two. The SQL is the Python module's
 * SQL, parameter syntax aside; the parity gate held this port to it row for row on the dev split
 * (34/34 identical for each arm and for the fusion — studbook/docs/paddock-gate.md).
 *
 * Takes any client with `query(text, values)` so it runs against a fake in tests and a real `pg`
 * client in main. No model here: the query embedding is computed by `models.ts` and passed in.
 */

export interface Queryable {
  query(text: string, values?: unknown[]): Promise<{ rows: Record<string, unknown>[] }>;
}

export interface Passage {
  chunkId: string;
  documentId: string;
  headingPath: string;
  body: string;
  repo: string;
  docType: string;
}

/**
 * Optional narrowing of what a query may retrieve from. M4's held-out run found the failure this
 * fixes: several questions say "this change" without naming which, the corpus holds two near-
 * identical sibling changes, and the model correctly refuses because nothing in the passages
 * disambiguates them. The caller knowing which repo or change it means resolves that.
 */
export interface Scope {
  repo?: string | null;
  changeId?: string | null;
}

export const ARM_K = 20; // what each arm returns before fusion (DEFAULT_K in hybrid.py)
export const RRF_K = 10; // tuned on dev in M2; 60 is the textbook value and lost outright

const SELECT =
  'select c.id as chunk_id, c.document_id, c.heading_path, c.body, d.repo, d.doc_type ' +
  'from studbook.chunks c join studbook.documents d on d.id = c.document_id';

/** Appends the scope's `and` clauses, numbering placeholders after the ones already used. */
function scopeSql(scope: Scope, firstIndex: number): { sql: string; values: unknown[] } {
  const clauses: string[] = [];
  const values: unknown[] = [];
  if (scope.repo) {
    values.push(scope.repo);
    clauses.push(`d.repo = $${firstIndex + values.length - 1}`);
  }
  if (scope.changeId) {
    values.push(scope.changeId);
    clauses.push(`d.change_id = $${firstIndex + values.length - 1}`);
  }
  return { sql: clauses.length ? ' and ' + clauses.join(' and ') : '', values };
}

function toPassage(row: Record<string, unknown>): Passage {
  return {
    chunkId: String(row.chunk_id),
    documentId: String(row.document_id),
    headingPath: String(row.heading_path),
    body: String(row.body),
    repo: String(row.repo),
    docType: String(row.doc_type),
  };
}

/**
 * `<=>` is cosine distance and must stay so: the HNSW index is built with `vector_cosine_ops`,
 * and pgvector only uses an index whose opclass matches the operator. `<->` (L2) ranked the same
 * for unit vectors and silently scanned every row — a 21-second p50 at 100k chunks (M4).
 */
export async function retrieveVector(
  client: Queryable,
  embedding: number[],
  k = ARM_K,
  scope: Scope = {},
): Promise<Passage[]> {
  const s = scopeSql(scope, 3);
  const { rows } = await client.query(
    `${SELECT} where true${s.sql} order by c.embedding <=> $1::vector limit $2`,
    [`[${embedding.join(',')}]`, k, ...s.values],
  );
  return rows.map(toPassage);
}

/**
 * The question's own stemmed lexemes, OR'd. Not `websearch_to_tsquery`/`plainto_tsquery`: both
 * AND every content word, and requiring all twenty-odd words of a natural question to co-occur in
 * one chunk gave recall@5 of 0.0294 (M2 — investigated as implausible, not accepted).
 */
export async function retrieveFulltext(
  client: Queryable,
  question: string,
  k = ARM_K,
  scope: Scope = {},
): Promise<Passage[]> {
  const s = scopeSql(scope, 3);
  const { rows } = await client.query(
    "with q as (select to_tsquery('english', string_agg(lexeme, ' | ')) as tsq " +
      "  from unnest(tsvector_to_array(to_tsvector('english', $1))) as lexeme) " +
      `${SELECT}, q where q.tsq is not null and c.fts @@ q.tsq${s.sql} ` +
      'order by ts_rank(c.fts, q.tsq) desc limit $2',
    [question, k, ...s.values],
  );
  return rows.map(toPassage);
}

/** Standard RRF: score(d) = Σ 1/(k + rank) over the rankings it appears in. Stable for ties. */
export function reciprocalRankFusion(rankings: Passage[][], k = RRF_K): Passage[] {
  const scores = new Map<string, number>();
  const byId = new Map<string, Passage>();
  for (const ranking of rankings) {
    ranking.forEach((p, i) => {
      scores.set(p.chunkId, (scores.get(p.chunkId) ?? 0) + 1 / (k + i + 1));
      byId.set(p.chunkId, p);
    });
  }
  return [...scores.keys()]
    .sort((a, b) => (scores.get(b) as number) - (scores.get(a) as number))
    .map((id) => byId.get(id) as Passage);
}

export async function retrieveHybrid(
  client: Queryable,
  question: string,
  embedding: number[],
  topK: number,
  scope: Scope = {},
): Promise<Passage[]> {
  const [vector, fulltext] = await Promise.all([
    retrieveVector(client, embedding, ARM_K, scope),
    retrieveFulltext(client, question, ARM_K, scope),
  ]);
  return reciprocalRankFusion([vector, fulltext], RRF_K).slice(0, topK);
}
