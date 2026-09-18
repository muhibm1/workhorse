/**
 * The generation step, ported from `studbook/answer/prompts.py` and `generate.py`. The system
 * prompt is that module's, verbatim — the wording was tuned on Studbook's dev split (over-refusal
 * 32% -> 15% with the trap set untouched, studbook/docs/m3-generation.md) and a paraphrase here
 * would be an unmeasured change. If it changes there, it changes here.
 *
 * Sampling is pinned at temperature 0: the product is a citation, and the same question against
 * the same passages should return the same receipts. Models that reject the parameter (Sonnet 5
 * does, with a 400) are retried once without it and remembered.
 */
import Anthropic from '@anthropic-ai/sdk';
import type { Passage } from './retrieval';

export const DEFAULT_MODEL = 'claude-haiku-4-5';
export const MAX_OUTPUT_TOKENS = 1024;
export const REFUSAL_PREFIX = 'Not in the record';

export const SYSTEM_PROMPT =
  'You are Studbook, an assistant that answers questions about a software team\'s engineering ' +
  'history using only the numbered context passages you are given below the question. You are ' +
  'never given the whole record, only a handful of retrieved passages -- treat absence from them ' +
  'as absence from the record, not as license to use outside knowledge.\n\n' +
  'Rules:\n' +
  '- Every claim in your answer must be supported by at least one passage, and every sentence that ' +
  'makes a claim must cite the passage number(s) it came from, in square brackets: [1] or [2][3]. ' +
  'One number per bracket -- write [1][2], never [1, 2].\n' +
  '- If the passages support only part of the question -- they establish the "what" but not the ' +
  '"why", say, or cover most but not all of what\'s asked -- answer with what they do support, ' +
  'cited as normal, and say plainly what is missing or uncertain in one added sentence. A partial, ' +
  'honestly-caveated answer is far more useful than a refusal when there is real, relevant ' +
  'material to work with.\n' +
  '- You may state a conclusion the passages jointly entail even when no single passage says it ' +
  'outright -- that a flagged risk did not materialise, given a passage reporting the suite ran ' +
  'clean, for instance. Cite the passages it rests on and mark it as what the record implies rather ' +
  'than what it states. An inference you can point at passages for is not speculation; one you ' +
  'cannot is.\n' +
  '- If the question is ambiguous between several similar changes and the passages answer it for ' +
  'more than one of them, give each answer, labelled by the change it belongs to, and close by ' +
  'asking which was meant. Do not refuse a question you can answer twice over.\n' +
  '- A passage that positively records that something does not exist -- "there is no reverse proxy, ' +
  'no TLS and no auth in front of it" -- answers a question about that thing. Say so and cite it, ' +
  'as an ordinary answer. That is not a refusal and must not be written as one.\n' +
  '- Refuse only when the passages give you nothing relevant to work with: they neither answer the ' +
  'question nor record that the thing asked about is absent. Do not guess, speculate, or fill a gap ' +
  'with plausible-sounding detail you cannot cite. Respond with exactly the phrase "Not in the ' +
  'record: " followed by a one-sentence explanation of what is missing, and nothing else. Never ' +
  'cite a passage in a refusal, and never state a fact drawn from the passages inside one: if you ' +
  'find yourself writing out the answer and then calling it absent, you are answering -- drop the ' +
  'refusal and give the answer.\n' +
  '- Be concise: two to four sentences usually suffices. Plain prose, not a list, unless the ' +
  'question itself asks for one.';

export interface Citation {
  number: number;
  chunkId: string;
  headingPath: string;
  repo: string;
  docType: string;
}

export interface Answer {
  text: string;
  citations: Citation[];
  refused: boolean;
  model: string;
  inputTokens: number;
  outputTokens: number;
}

export function buildContext(passages: Passage[]): string {
  return passages.map((p, i) => `[${i + 1}] (${p.repo}/${p.docType}, ${p.headingPath})\n${p.body}`).join('\n\n');
}

export function buildUserPrompt(question: string, passages: Passage[]): string {
  return `Context passages:\n\n${buildContext(passages)}\n\nQuestion: ${question}`;
}

/** One prior exchange in the thread. Only the text travels: a follow-up is retrieved afresh. */
export interface HistoryTurn {
  question: string;
  answer: string;
}

/**
 * Said once, in the follow-up's own user message rather than in the system prompt.
 *
 * The system prompt is the one tuned on Studbook's dev split and is asserted verbatim by a test;
 * every word of it applies to a single question and editing it would be an unmeasured change to
 * a measured thing. What a follow-up adds is a hazard that single-turn answering does not have:
 * the earlier turns' passages are gone from the context, so a claim the model remembers from one
 * of them would be uncited by construction -- the exact failure the citation contract exists to
 * prevent. This puts that where it applies and nowhere else.
 */
export const FOLLOW_UP_NOTE =
  'This is a follow-up in the same thread. The earlier turns are shown for reference only -- ' +
  'their passages are no longer in front of you, so every claim in this answer must cite the ' +
  'numbered passages above, and anything you remember from an earlier turn but cannot cite here ' +
  'is not in the record for this answer.';

export function buildFollowUpPrompt(question: string, passages: Passage[]): string {
  return `${FOLLOW_UP_NOTE}\n\nContext passages:\n\n${buildContext(passages)}\n\nQuestion: ${question}`;
}

/** The conversation sent to the model: prior turns as messages, then this question with its
 *  passages. With no history this is exactly the single message the tab has always sent. */
export function buildMessages(
  question: string,
  passages: Passage[],
  history: HistoryTurn[] = [],
): { role: 'user' | 'assistant'; content: string }[] {
  if (history.length === 0) {
    return [{ role: 'user', content: buildUserPrompt(question, passages) }];
  }
  const messages: { role: 'user' | 'assistant'; content: string }[] = [];
  for (const turn of history) {
    messages.push({ role: 'user', content: turn.question });
    messages.push({ role: 'assistant', content: turn.answer });
  }
  messages.push({ role: 'user', content: buildFollowUpPrompt(question, passages) });
  return messages;
}

/** Unique citation numbers in first-appearance order, dropping any outside 1..n. */
export function parseCitedNumbers(text: string, n: number): number[] {
  const seen: number[] = [];
  for (const m of text.matchAll(/\[(\d+)\]/g)) {
    const k = Number(m[1]);
    if (k >= 1 && k <= n && !seen.includes(k)) seen.push(k);
  }
  return seen;
}

/**
 * A refusal is meant to be one sentence, but the model sometimes opens with the phrase and then
 * keeps going with a cited partial answer. Keep only the first paragraph: a caller must never see
 * a citation attached to a refusal.
 */
export function cleanRefusal(text: string): string {
  return text.split(/\n\n/, 1)[0].trim();
}

/** Models that answered `400 "temperature" is deprecated` — asked once, then never again. */
const temperatureUnsupported = new Set<string>();

export interface GenerateDeps {
  apiKey: string;
  model?: string;
  /** The thread so far, oldest first. Empty (the default) is a fresh question. */
  history?: HistoryTurn[];
  /**
   * Called with each text delta and the whole answer so far, as it is written. The answer is
   * still returned complete and unchanged when the call resolves -- this only lets a caller show
   * it arriving. `/ask` takes several seconds (embed, rerank, generate) and, without this, spends
   * all of them showing nothing.
   */
  onDelta?: (delta: string, snapshot: string) => void;
  /** Test seam: a fake `messages.stream`. */
  client?: Pick<Anthropic, 'messages'>;
}

export async function generateAnswer(question: string, passages: Passage[], deps: GenerateDeps): Promise<Answer> {
  const model = deps.model ?? DEFAULT_MODEL;
  if (passages.length === 0) {
    return {
      text: `${REFUSAL_PREFIX}: no passages were retrieved for this question.`,
      citations: [],
      refused: true,
      model,
      inputTokens: 0,
      outputTokens: 0,
    };
  }

  const client = deps.client ?? new Anthropic({ apiKey: deps.apiKey });
  const base = {
    model,
    max_tokens: MAX_OUTPUT_TOKENS,
    system: SYSTEM_PROMPT,
    messages: buildMessages(question, passages, deps.history ?? []),
  };

  /**
   * Always streams, even when nobody is watching the deltas: one path means the path the app
   * takes is the path the tests cover. `finalMessage()` returns the same complete message
   * `create` would have, so everything downstream of here is unchanged.
   */
  async function create(withTemperature: boolean) {
    // `temperature` may be absent from the SDK's typed params (it left the Python SDK's in
    // 1.6.0); the API still honours it on Haiku 4.5, verified live with three identical samples.
    const params = withTemperature ? { ...base, temperature: 0 } : base;
    const stream = client.messages.stream(params as Parameters<Anthropic['messages']['stream']>[0]);
    if (deps.onDelta) stream.on('text', (delta, snapshot) => deps.onDelta?.(delta, snapshot));
    return stream.finalMessage();
  }

  let response;
  try {
    response = await create(!temperatureUnsupported.has(model));
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    const status = (err as { status?: number }).status;
    if (status === 400 && /temperature/i.test(message) && !temperatureUnsupported.has(model)) {
      temperatureUnsupported.add(model);
      console.warn(`studbook: ${model} does not accept a temperature; its answers are not reproducible`);
      response = await create(false);
    } else {
      throw new Error(`studbook: Claude API error while answering: ${message}`, { cause: err });
    }
  }

  const raw = ('content' in response ? response.content : [])
    .map((block) => ('text' in block ? block.text : ''))
    .join('')
    .trim();
  // A refusal is the phrase AND no citations, as in generate.py. The prefix alone misreads a
  // hedged partial answer -- "Not in the record: the passages don't give the reason, but they show
  // X [1]" -- as a refusal, cuts it to its first sentence and drops its citations. The prompt
  // actively asks for that shape; Studbook's held-out run caught three of them misfiled this way
  // (studbook/docs/m4-evaluation-and-scale.md), and the port had kept the old rule.
  const cited = parseCitedNumbers(raw, passages.length);
  const refused = raw.startsWith(REFUSAL_PREFIX) && cited.length === 0;
  const text = refused ? cleanRefusal(raw) : raw;
  const numbers = refused ? [] : cited;
  const usage = 'usage' in response ? response.usage : { input_tokens: 0, output_tokens: 0 };

  return {
    text,
    citations: numbers.map((k) => {
      const p = passages[k - 1];
      return { number: k, chunkId: p.chunkId, headingPath: p.headingPath, repo: p.repo, docType: p.docType };
    }),
    refused,
    model,
    inputTokens: usage.input_tokens,
    outputTokens: usage.output_tokens,
  };
}
