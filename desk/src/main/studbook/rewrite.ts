/**
 * Turns a follow-up into a standalone question before retrieving for it. Ported from
 * `studbook/retrieve/rewrite.py`, whose docstring carries the reasoning and whose eval
 * (`eval/rewrite.py`, studbook/docs/follow-ups.md) carries the numbers.
 *
 * The short version: concatenating the previous question onto a follow-up helps a genuine
 * follow-up and badly hurts a change of subject, and it cannot tell them apart. A rewrite can.
 * It is also a new place for a subject to be invented, so a rewrite is used only when every
 * content word in it already appears in the thread's questions; otherwise, or when the call
 * fails, retrieval falls back to the concatenation and `method` says so.
 *
 * The prompt and the guard's word lists are pinned by the same sha256 on both sides
 * (tests/studbook.rewrite.test.ts here, tests/test_rewrite.py there): an edit to one that is not
 * made to the other fails a test.
 */
import Anthropic from '@anthropic-ai/sdk';

export const REWRITE_MODEL = 'claude-haiku-4-5';
export const REWRITE_MAX_TOKENS = 200;
export const MAX_QUERY_CHARS = 500;
export const HISTORY_TURNS = 2;
export const STEM_CHARS = 5;
export const SUFFIXES = ['ing', 'ed', 'es', 'en', 'e', 's'];

export const REWRITE_PROMPT =
  "You rewrite a follow-up question from a conversation about a software team's engineering " +
  'record into one standalone question, for a search engine that cannot see the conversation.\n\n' +
  'Rules:\n' +
  '- If the new question depends on an earlier one for its subject -- it says "it", "that", ' +
  '"they", "the fix", "instead", or otherwise leaves out what it is about -- rewrite it as ' +
  "one question that names that subject, using the earlier questions' own words for it.\n" +
  '- If the new question already names its own subject, or asks about something different from ' +
  'the earlier questions, return it exactly as written.\n' +
  '- Never add a name, version, number, tool, file or detail that does not appear in the earlier ' +
  'questions or the new question. Never answer the question.\n' +
  '- Reply with the question alone, on one line.';

export const FUNCTION_WORDS: ReadonlySet<string> = new Set(
  (
    'a about after again against all also an and any are as at be because been before being both ' +
    'but by can could did do does doing done during each else for from had has have having how if ' +
    'in instead into is it its itself just made make more most much not now of off on once only or ' +
    'other our out over own same should so some such than that the their them then there these ' +
    'they this those through to too under until up upon use used very was were what when where ' +
    'whether which while who whom whose why will with within without would'
  ).split(' '),
);

/** fresh: no history. rewritten / unchanged: the rewriter's output. fallback-*: the concatenation. */
export type RewriteMethod = 'fresh' | 'rewritten' | 'unchanged' | 'fallback-guard' | 'fallback-error';

export interface Rewrite {
  query: string;
  method: RewriteMethod;
  /** The rewrite the guard refused, so a caller can show what was not searched for. */
  rejected?: string;
}

function words(text: string): string[] {
  return (text.toLowerCase().match(/[a-z0-9][a-z0-9_./-]*/g) ?? []).map((w) => w.replace(/^[./-]+|[./-]+$/g, ''));
}

export function stem(word: string): string {
  for (const suffix of SUFFIXES) {
    if (word.endsWith(suffix) && word.length - suffix.length >= 3) {
      word = word.slice(0, -suffix.length);
      break;
    }
  }
  return word.slice(0, STEM_CHARS);
}

/** Content words in `rewrite` that no source contains, compared on a crude stem. */
export function unsupportedWords(rewrite: string, sources: string[]): string[] {
  const known = new Set(sources.flatMap((s) => words(s)).filter(Boolean).map(stem));
  return words(rewrite).filter((w) => w && !FUNCTION_WORDS.has(w) && w.length > 2 && !known.has(stem(w)));
}

export function carried(question: string, history: string[]): string {
  return [...history.slice(-HISTORY_TURNS), question].join(' ');
}

export function buildRewriteRequest(question: string, history: string[]): string {
  const earlier = history.slice(-HISTORY_TURNS).map((q, i) => `${i + 1}. ${q}`).join('\n');
  return `Earlier questions in this thread, oldest first:\n${earlier}\n\nNew question: ${question}`;
}

export function clean(text: string): string {
  const trimmed = text.trim();
  const line = trimmed ? trimmed.split(/\r?\n/)[0].trim() : '';
  return line.replace(/^["“”]+|["“”]+$/g, '').trim().slice(0, MAX_QUERY_CHARS);
}

export interface RewriteDeps {
  apiKey: string;
  model?: string;
  /** Test seam: a fake `messages.create`. */
  client?: Pick<Anthropic, 'messages'>;
}

/** `history` is the thread's earlier questions, oldest first. Never throws. */
export async function rewriteQuery(question: string, history: string[], deps: RewriteDeps): Promise<Rewrite> {
  if (history.length === 0) return { query: question, method: 'fresh' };
  const fallback = carried(question, history);
  let text: string;
  try {
    const client = deps.client ?? new Anthropic({ apiKey: deps.apiKey });
    const params = {
      model: deps.model ?? REWRITE_MODEL,
      max_tokens: REWRITE_MAX_TOKENS,
      system: REWRITE_PROMPT,
      messages: [{ role: 'user' as const, content: buildRewriteRequest(question, history) }],
      // Pinned for the same reason as generation: the same thread should search for the same thing.
      temperature: 0,
    };
    const response = await client.messages.create(params as Parameters<Anthropic['messages']['create']>[0]);
    const content = 'content' in response ? response.content : [];
    text = clean(content.map((b) => ('text' in b ? b.text : '')).join(''));
  } catch (err) {
    console.warn(`studbook: query rewrite failed (${err instanceof Error ? err.message : String(err)}); searching the concatenation`);
    return { query: fallback, method: 'fallback-error' };
  }
  if (!text) return { query: fallback, method: 'fallback-error' };
  if (text === question.trim()) return { query: question, method: 'unchanged' };
  const sources = [question, ...history.slice(-HISTORY_TURNS)];
  if (unsupportedWords(text, sources).length > 0) return { query: fallback, method: 'fallback-guard', rejected: text };
  return { query: text, method: 'rewritten' };
}
