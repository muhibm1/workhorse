/**
 * Ingests one repository into the Studbook store, ported from `studbook/ingest/sync.py`:
 * parse -> chunk -> embed only what changed -> upsert -> delete what is gone. Idempotent: content-
 * hashed at both the document and chunk level, so a re-run with nothing changed touches no rows
 * and embeds nothing. One transaction per repository.
 *
 * Needs the *ingest* role's connection (read/write on documents and chunks), a second stored
 * secret; the reader role the tab queries with cannot write. Only the repository being synced is
 * touched: its stale documents and chunks are deleted, other repositories' rows are never read.
 */
import type { Models } from './models';
import { chunkDocument, type Chunk } from './chunker';
import { walkRepo, type ParsedDocument } from './parser';

export interface SyncClient {
  query(text: string, values?: unknown[]): Promise<{ rows: Record<string, unknown>[]; rowCount?: number | null }>;
}

export interface SyncProgress {
  repo: string;
  stage: 'walking' | 'embedding' | 'writing' | 'done';
  /** Chunks embedded so far / chunks that need embedding. */
  embedded?: number;
  toEmbed?: number;
}

export interface SyncStats {
  repo: string;
  documents: number;
  documentsDeleted: number;
  chunksEmbedded: number;
  chunksUnchanged: number;
  chunksDeleted: number;
}

const EMBED_BATCH_SIZE = 64;

const UPSERT_DOCUMENT =
  'insert into studbook.documents (id, repo, path, doc_type, change_id, tier, doc_date, commit_sha, content_hash) ' +
  'values ($1, $2, $3, $4, $5, $6, $7, $8, $9) ' +
  'on conflict (id) do update set ' +
  '  repo = excluded.repo, path = excluded.path, doc_type = excluded.doc_type, change_id = excluded.change_id, ' +
  '  tier = excluded.tier, doc_date = excluded.doc_date, commit_sha = excluded.commit_sha, ' +
  '  content_hash = excluded.content_hash, ' +
  '  ingested_at = case when studbook.documents.content_hash is distinct from excluded.content_hash ' +
  '                     then now() else studbook.documents.ingested_at end';

const UPSERT_CHUNK =
  'insert into studbook.chunks (id, document_id, ordinal, heading_path, gate, body, token_count, content_hash, embedding) ' +
  'values ($1, $2, $3, $4, $5, $6, $7, $8, $9::vector) ' +
  'on conflict (id) do update set ' +
  '  ordinal = excluded.ordinal, heading_path = excluded.heading_path, gate = excluded.gate, ' +
  '  body = excluded.body, token_count = excluded.token_count, content_hash = excluded.content_hash, ' +
  '  embedding = excluded.embedding';

export interface SyncDeps {
  models: Models;
  onProgress?: (p: SyncProgress) => void;
  /** Test seam: replaces the filesystem/git walk. */
  walk?: (repo: string, repoPath: string) => Promise<ParsedDocument[]>;
}

export async function syncRepo(client: SyncClient, repo: string, repoPath: string, deps: SyncDeps): Promise<SyncStats> {
  const progress = deps.onProgress ?? (() => undefined);
  progress({ repo, stage: 'walking' });
  const docs = await (deps.walk ?? walkRepo)(repo, repoPath);
  const chunksByDoc = new Map<string, Chunk[]>(docs.map((d) => [d.id, chunkDocument(d)]));
  const allChunks = [...chunksByDoc.values()].flat();
  const docIds = docs.map((d) => d.id);

  const { rows: existing } = await client.query(
    'select id, content_hash from studbook.chunks where document_id = any($1)',
    [docIds],
  );
  const existingHash = new Map(existing.map((r) => [String(r.id), String(r.content_hash)]));
  const toEmbed = allChunks.filter((c) => existingHash.get(c.id) !== c.contentHash);

  const embeddings = new Map<string, number[]>();
  progress({ repo, stage: 'embedding', embedded: 0, toEmbed: toEmbed.length });
  for (let start = 0; start < toEmbed.length; start += EMBED_BATCH_SIZE) {
    const batch = toEmbed.slice(start, start + EMBED_BATCH_SIZE);
    // Body only: prefixing the heading was measured and reverted (studbook/docs/retrieval-ceiling.md).
    const vectors = await deps.models.embed(batch.map((c) => c.body));
    batch.forEach((c, i) => embeddings.set(c.id, vectors[i]));
    progress({ repo, stage: 'embedding', embedded: Math.min(start + EMBED_BATCH_SIZE, toEmbed.length), toEmbed: toEmbed.length });
  }

  progress({ repo, stage: 'writing' });
  await client.query('begin');
  let chunksDeleted: number;
  let documentsDeleted: number;
  try {
    for (const doc of docs) {
      await client.query(UPSERT_DOCUMENT, [
        doc.id, doc.repo, doc.path, doc.docType, doc.changeId, doc.tier, doc.docDate, doc.commitSha, doc.contentHash,
      ]);
      for (const chunk of chunksByDoc.get(doc.id) ?? []) {
        const vector = embeddings.get(chunk.id);
        if (!vector) continue; // unchanged: its row already carries the right vector
        await client.query(UPSERT_CHUNK, [
          chunk.id, chunk.documentId, chunk.ordinal, chunk.headingPath, chunk.gate, chunk.body,
          chunk.tokenCount, chunk.contentHash, `[${vector.join(',')}]`,
        ]);
      }
    }
    const producedChunkIds = allChunks.map((c) => c.id);
    const deletedChunks = await client.query(
      'delete from studbook.chunks where document_id = any($1) and not (id = any($2))',
      [docIds, producedChunkIds],
    );
    chunksDeleted = deletedChunks.rowCount ?? 0;
    const deletedDocs = await client.query(
      'delete from studbook.documents where repo = $1 and not (id = any($2))',
      [repo, docIds],
    );
    documentsDeleted = deletedDocs.rowCount ?? 0;
    await client.query('commit');
  } catch (err) {
    await client.query('rollback').catch(() => undefined);
    throw err;
  }

  progress({ repo, stage: 'done' });
  return {
    repo,
    documents: docs.length,
    documentsDeleted,
    chunksEmbedded: toEmbed.length,
    chunksUnchanged: allChunks.length - toEmbed.length,
    chunksDeleted,
  };
}
