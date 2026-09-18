/**
 * The two local models Studbook's query path needs, through their ONNX ports in transformers.js:
 * `Xenova/bge-base-en-v1.5` for the query embedding and `Xenova/bge-reranker-base` to re-score
 * the fused candidates. Both fp32 — the quantised defaults were never measured against the
 * Python pipeline and must not be assumed to match it.
 *
 * Loaded once, on first use, never at startup: ~500 MB resident and a 1.5 GB first download,
 * which is Studbook's cost and not something every Paddock launch should pay. The dependency is
 * imported dynamically for the same reason the Agent SDK is (drivers/sdk.ts): a machine without
 * it still runs everything else.
 *
 * Parity with the Python pipeline is not automatic and was measured (studbook/docs/paddock-gate.md):
 * embeddings agree to cosine 1.000000; the reranker agrees to 4e-6 *only* with the truncation
 * below. transformers.js's own `truncation: true` on a text pair is not HuggingFace's
 * `longest_first`, and on pairs over 512 tokens — 46% of what the reranker sees on this corpus —
 * it drifted by up to 0.094 and flipped rankings. Keeping the first `512 - specials - |query|`
 * passage tokens and assembling `<s> q </s></s> p </s>` by token id reproduces sentence-
 * transformers on all 157 long pairs; keeping the passage's tail is off by 0.97.
 */
import type { Passage } from './retrieval';

export const EMBED_MODEL = 'Xenova/bge-base-en-v1.5';
export const RERANK_MODEL = 'Xenova/bge-reranker-base';
export const MAX_TOKENS = 512;

export interface ModelProgress {
  /** 'downloading' while files are fetched, 'loading' while sessions initialise, 'ready' after. */
  stage: 'downloading' | 'loading' | 'ready';
  file?: string;
  /** 0-100 for the file being downloaded, when known. */
  percent?: number;
}

type Transformers = typeof import('@huggingface/transformers');

/**
 * Structural views of the three transformers.js objects this module calls, holding only the
 * members it uses. The library's own types for a pipeline are an overload union TypeScript
 * refuses to represent (TS2590), and nothing here needs more than these shapes.
 */
interface TokenIds {
  input_ids: { tolist(): (number | bigint)[][] };
}
interface TokenizerLike {
  (text: string | string[], options?: Record<string, unknown>): TokenIds;
}
interface EmbedPipeline {
  (texts: string[], options: { pooling: 'cls'; normalize: boolean }): Promise<{ tolist(): number[][] }>;
}
interface RerankModel {
  (inputs: { input_ids: unknown; attention_mask: unknown }): Promise<{ logits: { tolist(): number[][] } }>;
}

interface Loaded {
  tf: Transformers;
  embed: EmbedPipeline;
  tokenizer: TokenizerLike;
  reranker: RerankModel;
  cls: number;
  sep: number;
  pad: number;
  specials: number;
}

export interface ModelsOptions {
  /** Where model files are cached. Defaults to transformers.js's own cache under the user's home. */
  cacheDir?: string;
  onProgress?: (p: ModelProgress) => void;
}

export interface Models {
  embed(texts: string[]): Promise<number[][]>;
  /** The passages re-scored against `query`, best first, cut to `topK`. */
  rerank(query: string, passages: Passage[], topK: number): Promise<Passage[]>;
  /** Whether both models are resident; false before the first call finishes loading. */
  ready(): boolean;
}

/**
 * Special-token ids read off real encodings rather than tokenizer properties, which transformers.js
 * does not expose as `cls_token_id` etc. A one-token pair encodes as `<s> a </s></s> b </s>`, so
 * positions 0 and 2 are CLS and SEP; a padded two-item batch exposes PAD at the short item's tail.
 * int64 tensors list as BigInt, hence the Number() everywhere.
 */
function specialTokens(tokenizer: Loaded['tokenizer']): Pick<Loaded, 'cls' | 'sep' | 'pad' | 'specials'> {
  const probe = (tokenizer('a', { text_pair: 'b' }).input_ids.tolist()[0] as (number | bigint)[]).map(Number);
  const padded = (tokenizer(['a', 'a a a a'], { padding: true }).input_ids.tolist() as (number | bigint)[][]).map(
    (r) => r.map(Number),
  );
  const out = { cls: probe[0], sep: probe[2], pad: padded[0][padded[0].length - 1], specials: probe.length - 2 };
  if (![out.cls, out.sep, out.pad].every(Number.isInteger)) {
    throw new Error(`studbook: could not resolve the reranker's special token ids (${JSON.stringify(out)})`);
  }
  return out;
}

export function createModels(options: ModelsOptions = {}): Models {
  let loading: Promise<Loaded> | null = null;
  let loaded: Loaded | null = null;

  async function load(): Promise<Loaded> {
    if (loaded) return loaded;
    if (!loading) {
      loading = (async () => {
        let tf: Transformers;
        try {
          tf = await import('@huggingface/transformers');
        } catch (err) {
          throw new Error(
            `studbook: @huggingface/transformers is not installed (${err instanceof Error ? err.message : String(err)})`,
            { cause: err },
          );
        }
        if (options.cacheDir) tf.env.cacheDir = options.cacheDir;
        const progress_callback = (info: { status?: string; file?: string; progress?: number }) => {
          if (!options.onProgress) return;
          if (info.status === 'progress') {
            options.onProgress({ stage: 'downloading', file: info.file, percent: info.progress });
          } else if (info.status === 'done' || info.status === 'ready') {
            options.onProgress({ stage: 'loading', file: info.file });
          }
        };
        const embed = (await tf.pipeline('feature-extraction', EMBED_MODEL, {
          dtype: 'fp32',
          progress_callback,
        })) as unknown as EmbedPipeline;
        const tokenizer = (await tf.AutoTokenizer.from_pretrained(RERANK_MODEL, {
          progress_callback,
        })) as unknown as TokenizerLike;
        const reranker = (await tf.AutoModelForSequenceClassification.from_pretrained(RERANK_MODEL, {
          dtype: 'fp32',
          progress_callback,
        })) as unknown as RerankModel;
        const specials = specialTokens(tokenizer);
        options.onProgress?.({ stage: 'ready' });
        loaded = { tf, embed, tokenizer, reranker, ...specials };
        return loaded;
      })().catch((err) => {
        loading = null; // a failed load must be retryable, not sticky
        throw err;
      });
    }
    return loading;
  }

  return {
    ready: () => loaded !== null,

    async embed(texts) {
      const m = await load();
      // CLS pooling + L2 normalisation is what sentence-transformers does for this model.
      const out = await m.embed(texts, { pooling: 'cls', normalize: true });
      return out.tolist();
    },

    async rerank(query, passages, topK) {
      if (passages.length === 0) return [];
      const m = await load();
      const bare = (s: string): number[] =>
        (m.tokenizer(s, { add_special_tokens: false }).input_ids.tolist()[0] as (number | bigint)[]).map(Number);
      const q = bare(query);
      const budget = MAX_TOKENS - m.specials - q.length;
      const seqs = passages.map((p) => {
        const ids = bare(p.body);
        const kept = ids.length <= budget ? ids : ids.slice(0, budget);
        return [m.cls, ...q, m.sep, m.sep, ...kept, m.sep];
      });
      const width = Math.max(...seqs.map((s) => s.length));
      const flatIds: bigint[] = [];
      const flatMask: bigint[] = [];
      for (const s of seqs) {
        flatIds.push(...s.map(BigInt), ...Array<bigint>(width - s.length).fill(BigInt(m.pad)));
        flatMask.push(...s.map(() => 1n), ...Array<bigint>(width - s.length).fill(0n));
      }
      const input_ids = new m.tf.Tensor('int64', BigInt64Array.from(flatIds), [seqs.length, width]);
      const attention_mask = new m.tf.Tensor('int64', BigInt64Array.from(flatMask), [seqs.length, width]);
      const { logits } = await m.reranker({ input_ids, attention_mask });
      const scores = logits.tolist().map((row) => row[0]);
      const order = passages.map((_, i) => i).sort((a, b) => scores[b] - scores[a]);
      return order.slice(0, topK).map((i) => passages[i]);
    },
  };
}
