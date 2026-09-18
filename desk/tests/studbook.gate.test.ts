/**
 * The parity gate, as a Paddock test: runs Studbook's dev split through THIS code -- the real
 * ONNX models, the real store, the retrieval and reranking in src/main/studbook -- and holds it
 * to the numbers the Python pipeline publishes (studbook/docs/m2-retrieval-and-eval.md, m4):
 *
 *     recall@5 0.8235   mrr@10 0.6485   precision@5 0.1824
 *
 * exactly, to four places. Anything else means the port has drifted from the pipeline whose
 * held-out results the project reports, and nothing else would notice: drift here degrades
 * recall silently. studbook/docs/paddock-gate.md is the account of what this caught the first time.
 *
 * Needs the store and the gold set, so it is opt-in:
 *
 *     STUDBOOK_DATABASE_URL=<libpq conninfo>  STUDBOOK_DEV_JSONL=../studbook/eval/dev.jsonl \
 *       npx vitest run tests/studbook.gate.test.ts
 *
 * It says so loudly when skipped rather than passing green having proved nothing; a CI job that
 * runs it must assert it did not skip. Model files cache under the OS temp dir the first time
 * (a 1.5 GB download), and the run takes a few minutes on CPU.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import pg from 'pg';
import { parseConninfo } from '../src/main/studbook/conninfo';
import { createModels } from '../src/main/studbook/models';
import { retrieveHybrid } from '../src/main/studbook/retrieval';
import { RERANK_CANDIDATES, SESSION_SETUP } from '../src/main/studbook';

const CONNINFO = process.env['STUDBOOK_DATABASE_URL'];
const DEV_JSONL = process.env['STUDBOOK_DEV_JSONL'];
/** The eval corpus's repositories (studbook's corpus.json keys). The store can hold more --
 *  Refresh the record adds every registered repository -- and the published numbers are over
 *  exactly these two, so retrieval is scoped to them here as it is in the Python eval. */
const EVAL_REPOS = (process.env['STUDBOOK_EVAL_REPOS'] ?? 'workhorse,paddock-demo').split(',').map((s) => s.trim());
/**
 * The published dev numbers for the production configuration. Re-baselined 2026-09-18 when the
 * rerank pool went from 20 to 10 (0.8235 / 0.6485 / 0.1824 was the pool-20 triple); the Python
 * eval at the same pool produces these, and this asserts Paddock reproduces them.
 */
const PUBLISHED = { recall5: 0.8529, mrr10: 0.6385, precision5: 0.1882 };
const TOP_K = 5;
const MRR_K = 10;

interface GoldQuestion {
  id: string;
  type: string;
  question: string;
  gold: { quote: string }[];
}

const describeLive = CONNINFO && DEV_JSONL ? describe : describe.skip;

if (!CONNINFO || !DEV_JSONL) {
  console.warn(
    'studbook.gate.test.ts SKIPPED: set STUDBOOK_DATABASE_URL and STUDBOOK_DEV_JSONL to run the parity gate. ' +
      'A green run without it proves nothing about retrieval parity.',
  );
}

describeLive('studbook parity gate (live)', () => {
  it(
    'reproduces the published dev retrieval numbers exactly',
    async () => {
      const questions = readFileSync(resolve(DEV_JSONL as string), 'utf8')
        .split('\n')
        .filter((l) => l.trim())
        .map((l) => JSON.parse(l) as GoldQuestion)
        .filter((q) => q.type !== 'unanswerable'); // a trap has no gold chunk to find

      const ca = readFileSync(resolve(__dirname, '..', 'resources', 'studbook', 'supabase-ca.pem'), 'utf8');
      const client = new pg.Client({ ...parseConninfo(CONNINFO as string), ssl: { rejectUnauthorized: true, ca } });
      await client.connect();
      await client.query(SESSION_SETUP); // exactly what production connections run

      const models = createModels({ cacheDir: join(tmpdir(), 'paddock-studbook-gate-models') });
      const embeddings = await models.embed(questions.map((q) => q.question));

      let recall = 0;
      let mrr = 0;
      let precision = 0;
      const misses: string[] = [];
      try {
        for (const [i, q] of questions.entries()) {
          const candidates = await retrieveHybrid(client, q.question, embeddings[i], RERANK_CANDIDATES, { repos: EVAL_REPOS });
          const reranked = await models.rerank(q.question, candidates, MRR_K);
          const hits = reranked.map((p) => q.gold.some((g) => p.body.includes(g.quote)));
          const first = hits.indexOf(true);
          if (hits.slice(0, TOP_K).some(Boolean)) recall += 1;
          else misses.push(q.id);
          mrr += first >= 0 ? 1 / (first + 1) : 0;
          precision += hits.slice(0, TOP_K).filter(Boolean).length / TOP_K;
        }
      } finally {
        await client.end();
      }

      const n = questions.length;
      const got = {
        recall5: Number((recall / n).toFixed(4)),
        mrr10: Number((mrr / n).toFixed(4)),
        precision5: Number((precision / n).toFixed(4)),
      };
      // Named misses in the failure message: a drift is diagnosed by which question moved.
      expect(got, `missed top-5 on: ${misses.join(', ')}`).toEqual(PUBLISHED);
    },
    15 * 60_000,
  );
});
