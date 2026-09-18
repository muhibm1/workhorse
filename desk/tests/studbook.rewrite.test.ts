import { describe, it, expect, vi } from 'vitest';
import { createHash } from 'node:crypto';
import {
  buildRewriteRequest, carried, clean, FUNCTION_WORDS, REWRITE_PROMPT, rewriteQuery, stem, STEM_CHARS, SUFFIXES,
  unsupportedWords,
} from '../src/main/studbook/rewrite';

// The same two hashes studbook/tests/test_rewrite.py pins. A change to the prompt or the guard on
// one side that is not made on the other fails here or there; update both constants together.
const PROMPT_SHA256 = '962806d476602ccc58d71002603f69487eec0b2d047cbed7634f2e5286fde077';
const GUARD_SHA256 = '345d0ee05a7e0beb235389e352309a6b8b06e27633fffc917795c708bfb321ca';
// The guard is data (the word lists) and logic (the stemmer); the probe pins the logic, since two
// stemmers can share every list and still disagree on "pinning".
const PROBE = 'pinning pin stopping stop moved move broken broke deploying deployed uses use access accessed passes all tree running added';

const sha256 = (s: string) => createHash('sha256').update(s, 'utf8').digest('hex');
const FIRST = 'Why did control state move into the git common dir?';

function fakeClient(reply: string | Error) {
  const create = vi.fn(async () => {
    if (reply instanceof Error) throw reply;
    return { content: [{ type: 'text', text: reply }] };
  });
  return { create, client: { messages: { create } } as never };
}

describe('studbook rewrite: pinned to the Python reference', () => {
  it('has the same prompt', () => {
    expect(sha256(REWRITE_PROMPT)).toBe(PROMPT_SHA256);
  });

  it('has the same guard', () => {
    const spec = [...FUNCTION_WORDS].sort().join(' ') + `|${STEM_CHARS}|` + SUFFIXES.join(' ') + '|' + PROBE.split(' ').map(stem).join(' ');
    expect(sha256(spec)).toBe(GUARD_SHA256);
  });
});

describe('studbook rewrite: the guard', () => {
  it('lets a pronoun be resolved from the thread', () => {
    expect(unsupportedWords('What broke before control state moved into the git common dir?', ['What broke because of it?', FIRST])).toEqual([]);
  });

  it('matches inflections of typed words', () => {
    for (const [typed, written] of [['move', 'moved'], ['broke', 'broken'], ['deploying', 'deployed'], ['uses', 'use'], ['pin', 'pinning'], ['stop', 'stopping']]) {
      expect(unsupportedWords(written, [typed]), `${typed} -> ${written}`).toEqual([]);
    }
  });

  it('catches a new subject and a new version number', () => {
    expect(unsupportedWords('Why did Redis replace the git common dir?', [FIRST])).toContain('redis');
    expect(unsupportedWords('What changed in 0.4.3?', ['What changed in it?'])).toContain('0.4.3');
  });

  it('lets function words and short words through', () => {
    expect(unsupportedWords('Why was it so, and when?', ['x'])).toEqual([]);
  });
});

describe('studbook rewrite: helpers', () => {
  it('carries the last two questions', () => {
    expect(carried('q4', ['q1', 'q2', 'q3'])).toBe('q2 q3 q4');
  });

  it('numbers the earlier questions', () => {
    expect(buildRewriteRequest('new?', ['a?', 'b?'])).toBe(
      'Earlier questions in this thread, oldest first:\n1. a?\n2. b?\n\nNew question: new?',
    );
  });

  it('keeps one line and drops quotes', () => {
    expect(clean('"Why X?"\nBecause Y.')).toBe('Why X?');
    expect(clean('   ')).toBe('');
  });
});

describe('studbook rewrite: rewriteQuery', () => {
  it('makes no call for a fresh question', async () => {
    const { create, client } = fakeClient('unused');
    expect((await rewriteQuery('q?', [], { apiKey: 'k', client })).method).toBe('fresh');
    expect(create).not.toHaveBeenCalled();
  });

  it('uses a grounded rewrite', async () => {
    const text = 'What broke before control state moved into the git common dir?';
    const { client } = fakeClient(text);
    expect(await rewriteQuery('What broke because of it?', [FIRST], { apiKey: 'k', client })).toEqual({ query: text, method: 'rewritten' });
  });

  it('searches an unchanged question on its own', async () => {
    const q = "How is the health endpoint's uptime measured?";
    const { client } = fakeClient(q);
    expect(await rewriteQuery(q, [FIRST], { apiKey: 'k', client })).toEqual({ query: q, method: 'unchanged' });
  });

  it('falls back to the concatenation when the rewrite invents', async () => {
    const q = 'What replaced it?';
    const { client } = fakeClient('What replaced Redis in the git common dir?');
    const r = await rewriteQuery(q, [FIRST], { apiKey: 'k', client });
    expect(r).toEqual({ query: carried(q, [FIRST]), method: 'fallback-guard', rejected: 'What replaced Redis in the git common dir?' });
  });

  it('falls back rather than failing the question when the call fails', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const { client } = fakeClient(new Error('network down'));
    const r = await rewriteQuery('What replaced it?', [FIRST], { apiKey: 'k', client });
    expect(r.method).toBe('fallback-error');
    expect(r.query).toBe(carried('What replaced it?', [FIRST]));
    warn.mockRestore();
  });

  it('falls back on an empty reply', async () => {
    const { client } = fakeClient('');
    expect((await rewriteQuery('And then?', [FIRST], { apiKey: 'k', client })).method).toBe('fallback-error');
  });

  it('sends the pinned prompt at temperature 0 with only the last two questions', async () => {
    const { create, client } = fakeClient('x');
    await rewriteQuery('And then?', ['q1', 'q2', 'q3'], { apiKey: 'k', client });
    const params = (create.mock.calls[0] as unknown as [Record<string, unknown>])[0];
    expect(params).toMatchObject({ system: REWRITE_PROMPT, temperature: 0, model: 'claude-haiku-4-5' });
    expect(JSON.stringify(params.messages)).not.toContain('q1');
  });
});
