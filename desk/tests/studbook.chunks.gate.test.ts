/**
 * Chunk parity gate: the TypeScript parser + chunker must produce exactly the documents and
 * chunks Python's `ingest/parser.py` + `ingest/chunker.py` produce over the same working trees --
 * same ids, same content hashes, same heading paths, gates and token counts. The store keys on
 * chunk id and decides "unchanged" by content hash, so any difference means one ingester would
 * re-embed what the other wrote and leave the other's rows orphaned.
 *
 * Opt-in: point STUDBOOK_CHUNKS_JSON at the file `studbook/gate/dump_chunks.py` writes. It walks
 * the repositories named in that file, so both must be at the same commit as when the dump ran.
 *
 *     STUDBOOK_CHUNKS_JSON=../studbook/gate/python_chunks.json npx vitest run tests/studbook.chunks.gate.test.ts
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { chunkDocument } from '../src/main/studbook/chunker';
import { walkRepo } from '../src/main/studbook/parser';

const DUMP = process.env['STUDBOOK_CHUNKS_JSON'];
const describeLive = DUMP ? describe : describe.skip;
if (!DUMP) {
  console.warn('studbook.chunks.gate.test.ts SKIPPED: set STUDBOOK_CHUNKS_JSON to the Python dump to run the chunk parity gate.');
}

interface Dump {
  [repo: string]: {
    path: string;
    documents: { id: string; path: string; doc_type: string; change_id: string | null; tier: number | null; doc_date: string | null; commit_sha: string; content_hash: string }[];
    chunks: { id: string; heading_path: string; gate: string | null; token_count: number; content_hash: string }[];
  };
}

describeLive('studbook chunk parity gate (live)', () => {
  // Read here, not at module level: a skipped suite must still collect without the file.
  const dump = DUMP ? (JSON.parse(readFileSync(resolve(DUMP), 'utf8')) as Dump) : {};

  for (const [repo, expected] of Object.entries(dump)) {
    it(`${repo}: documents and chunks are identical to Python's`, async () => {
      const docs = await walkRepo(repo, expected.path);
      const chunks = docs.flatMap((d) => chunkDocument(d));

      const docsGot = new Map(docs.map((d) => [d.id, d]));
      const docsWant = new Map(expected.documents.map((d) => [d.id, d]));
      expect([...docsGot.keys()].sort()).toEqual([...docsWant.keys()].sort());
      for (const [id, want] of docsWant) {
        const got = docsGot.get(id)!;
        expect({ id, path: got.path, doc_type: got.docType, change_id: got.changeId, tier: got.tier, doc_date: got.docDate, commit_sha: got.commitSha, content_hash: got.contentHash }).toEqual(want);
      }

      const chunksGot = new Map(chunks.map((c) => [c.id, c]));
      const chunksWant = new Map(expected.chunks.map((c) => [c.id, c]));
      expect([...chunksGot.keys()].sort()).toEqual([...chunksWant.keys()].sort());
      const diffs: string[] = [];
      for (const [id, want] of chunksWant) {
        const got = chunksGot.get(id)!;
        const mine = { id, heading_path: got.headingPath, gate: got.gate, token_count: got.tokenCount, content_hash: got.contentHash };
        if (JSON.stringify(mine) !== JSON.stringify(want)) diffs.push(`${id}: ${JSON.stringify(mine)} vs ${JSON.stringify(want)}`);
      }
      expect(diffs, diffs.slice(0, 5).join('\n')).toEqual([]);
      expect(chunks.length).toBe(expected.chunks.length);
    }, 120_000);
  }
});
