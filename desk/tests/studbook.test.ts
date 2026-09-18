import { describe, it, expect, vi } from 'vitest';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { looksLikeConninfo, parseConninfo } from '../src/main/studbook/conninfo';
import { reciprocalRankFusion, retrieveVector, retrieveFulltext, type Passage, type Queryable } from '../src/main/studbook/retrieval';
import { buildContext, buildMessages, buildUserPrompt, cleanRefusal, FOLLOW_UP_NOTE, generateAnswer, parseCitedNumbers, SYSTEM_PROMPT } from '../src/main/studbook/answer';
import { createStudbook, type DbClient } from '../src/main/studbook';
import type { Models } from '../src/main/studbook/models';
import { IPC } from '@shared/types';
import { registerIpc, type IpcDeps, type IpcMainLike } from '../src/main/ipc';

function passage(id: string, body = `body of ${id}`): Passage {
  return { chunkId: id, documentId: 'd', headingPath: `H ${id}`, body, repo: 'workhorse', docType: 'spec' };
}

/** The shape generateAnswer uses from the SDK's MessageStream: `on('text')` and `finalMessage()`.
 *  `deltas` lets a test choose how the text arrives; by default it arrives in one piece. */
function fakeStream(text: string, opts: { deltas?: string[]; usage?: { input_tokens: number; output_tokens: number } } = {}) {
  const usage = opts.usage ?? { input_tokens: 10, output_tokens: 5 };
  return {
    on(event: string, cb: (delta: string, snapshot: string) => void) {
      if (event === 'text') {
        let snapshot = '';
        for (const delta of opts.deltas ?? [text]) {
          snapshot += delta;
          cb(delta, snapshot);
        }
      }
      return this;
    },
    finalMessage: async () => ({ content: [{ type: 'text', text }], usage }),
  };
}

// ---------------------------------------------------------------- conninfo

describe('studbook conninfo', () => {
  it('parses libpq keyword/value form, mapping dbname to database', () => {
    const t = parseConninfo("user=reader.abc password='p a\\'ss' host=aws-0.pooler.supabase.com port=5432 dbname=postgres");
    expect(t).toMatchObject({ user: 'reader.abc', password: "p a'ss", host: 'aws-0.pooler.supabase.com', port: 5432, database: 'postgres' });
  });

  it('passes a postgres:// URL through untouched', () => {
    expect(parseConninfo('postgresql://u:p@h:5432/db')).toEqual({ connectionString: 'postgresql://u:p@h:5432/db' });
  });

  it('keeps keys it does not map without letting them override mapped ones', () => {
    const t = parseConninfo('host=h sslmode=disable dbname=x');
    expect('extra' in t && t.extra).toEqual({ sslmode: 'disable' });
    // sslmode in the conninfo is inert: index.ts sets ssl on the client itself, with the pinned CA.
  });

  it('looksLikeConninfo requires at least a host', () => {
    expect(looksLikeConninfo('host=h user=u')).toBe(true);
    expect(looksLikeConninfo('postgres://x')).toBe(true);
    expect(looksLikeConninfo('user=u password=p')).toBe(false);
    expect(looksLikeConninfo('hello world')).toBe(false);
  });
});

// ---------------------------------------------------------------- retrieval

describe('studbook retrieval', () => {
  it('reciprocal rank fusion prefers broad moderate support over a single first place', () => {
    // "b" is rank 2 in both lists; "a" is rank 1 in one and absent from the other. Same rule
    // Studbook's own tests assert (studbook/tests/test_hybrid.py), same k.
    const fused = reciprocalRankFusion([[passage('a'), passage('b')], [passage('c'), passage('b')]], 60);
    expect(fused[0].chunkId).toBe('b');
  });

  it('an item present in only one ranking still appears', () => {
    const fused = reciprocalRankFusion([[passage('a')], [passage('b')]]);
    expect(fused.map((p) => p.chunkId).sort()).toEqual(['a', 'b']);
  });

  function capturing(): { client: Queryable; calls: { text: string; values?: unknown[] }[] } {
    const calls: { text: string; values?: unknown[] }[] = [];
    return {
      calls,
      client: {
        async query(text, values) {
          calls.push({ text, values });
          return { rows: [] };
        },
      },
    };
  }

  it('vector search orders by cosine distance (<=>), never L2, and passes the vector as text', async () => {
    const { client, calls } = capturing();
    await retrieveVector(client, [0.1, 0.2], 7);
    expect(calls[0].text).toContain('c.embedding <=> $1::vector');
    expect(calls[0].text).not.toContain('<->');
    expect(calls[0].values).toEqual(['[0.1,0.2]', 7]);
  });

  it('full-text ORs the question\'s own lexemes rather than ANDing them', async () => {
    const { client, calls } = capturing();
    await retrieveFulltext(client, 'why did state move', 5);
    expect(calls[0].text).toContain("string_agg(lexeme, ' | ')");
    expect(calls[0].text).not.toContain('websearch_to_tsquery');
  });

  it('a repos set restricts to exactly those repositories; an empty set matches nothing', async () => {
    const { client, calls } = capturing();
    await retrieveVector(client, [1], 5, { repos: ['workhorse', 'paddock-demo'] });
    expect(calls[0].text).toContain('d.repo = any($3)');
    expect(calls[0].values).toEqual(['[1]', 5, ['workhorse', 'paddock-demo']]);
    await retrieveVector(client, [1], 5, { repos: [] });
    expect(calls[1].text).toContain('d.repo = any($3)');
    await retrieveVector(client, [1], 5, { repos: null });
    expect(calls[2].text).not.toContain('any(');
  });

  it('a scope adds parameterised clauses after the ones already used', async () => {
    const { client, calls } = capturing();
    await retrieveVector(client, [1], 5, { repo: 'workhorse', changeId: 'c1' });
    expect(calls[0].text).toContain('d.repo = $3');
    expect(calls[0].text).toContain('d.change_id = $4');
    expect(calls[0].values).toEqual(['[1]', 5, 'workhorse', 'c1']);
  });
});

// ---------------------------------------------------------------- answer

describe('studbook answer', () => {
  it('the system prompt is the tuned one, with the refusal contract intact', () => {
    // A paraphrase here would be an unmeasured change to a prompt tuned on Studbook's dev split.
    expect(SYSTEM_PROMPT).toContain('Respond with exactly the phrase "Not in the record: "');
    expect(SYSTEM_PROMPT).toContain('write [1][2], never [1, 2]');
    expect(SYSTEM_PROMPT).toContain('A passage that positively records that something does not exist');
  });

  it('the system prompt and follow-up note are byte-identical to studbook\'s', () => {
    // The same hashes studbook/tests/test_prompts.py pins; an edit on one side only fails a test.
    const sha = (s: string) => createHash('sha256').update(s, 'utf8').digest('hex');
    expect(sha(SYSTEM_PROMPT)).toBe('b51fefa85f5b85e3bec346c37044979a17751c6d8719f500cf925faf4a2a8658');
    expect(sha(FOLLOW_UP_NOTE)).toBe('6bf13313380c5b91c5a69816437e4eb74f9101c4da989433d27868bc76e47417');
  });

  it('numbers passages from one and names their source', () => {
    const ctx = buildContext([passage('x', 'first'), passage('y', 'second')]);
    expect(ctx).toBe('[1] (workhorse/spec, H x)\nfirst\n\n[2] (workhorse/spec, H y)\nsecond');
  });

  it('parses unique citations in order and drops out-of-range ones', () => {
    expect(parseCitedNumbers('see [2] and [1][2], not [9]', 3)).toEqual([2, 1]);
  });

  it('a refusal is cut to its first paragraph so no citation trails it', () => {
    expect(cleanRefusal('Not in the record: nothing.\n\nBut passage [3] says…')).toBe('Not in the record: nothing.');
  });

  it('no passages means a refusal without an API call', async () => {
    const stream = vi.fn();
    const a = await generateAnswer('q?', [], { apiKey: 'k', client: { messages: { stream } as never } });
    expect(a.refused).toBe(true);
    expect(stream).not.toHaveBeenCalled();
  });

  it('a refusal with a cited paragraph after it is kept whole, as generate.py keeps it', async () => {
    // The citation rule reads the whole reply, so a cited trailing paragraph makes this an answer
    // and nothing is cut: the reader sees the contradiction with its receipt rather than a
    // refusal with the evidence silently removed.
    const stream = vi.fn(() => fakeStream('Not in the record: nothing covers this.\n\nBut [1] says…'));
    const a = await generateAnswer('q?', [passage('a')], { apiKey: 'k', client: { messages: { stream } as never } });
    expect(a.refused).toBe(false);
    expect(a.citations.map((c) => c.number)).toEqual([1]);
  });

  it('a hedged answer opening with the refusal phrase keeps its text and citations', async () => {
    // The shape the prompt asks for when the passages cover part of a question. generate.py's
    // rule: a refusal is the phrase AND no citations. The port once used the prefix alone.
    const text = "Not in the record: the passages don't give the reason, but they show it landed in 0.2.12 [1].";
    const stream = vi.fn(() => fakeStream(text));
    const a = await generateAnswer('q?', [passage('a')], { apiKey: 'k', client: { messages: { stream } as never } });
    expect(a.refused).toBe(false);
    expect(a.text).toBe(text);
    expect(a.citations.map((c) => c.number)).toEqual([1]);
  });

  it('an uncited refusal is a refusal', async () => {
    const stream = vi.fn(() => fakeStream('Not in the record: the passages do not cover this.'));
    const a = await generateAnswer('q?', [passage('a')], { apiKey: 'k', client: { messages: { stream } as never } });
    expect(a.refused).toBe(true);
    expect(a.citations).toEqual([]);
  });

  it('pins temperature 0 and maps citations to passages', async () => {
    const stream = vi.fn((params: { temperature?: number }) => {
      expect(params.temperature).toBe(0);
      return fakeStream('It moved to the common dir [2].');
    });
    const a = await generateAnswer('q?', [passage('a'), passage('b')], { apiKey: 'k', client: { messages: { stream } as never } });
    expect(a.refused).toBe(false);
    expect(a.citations).toEqual([{ number: 2, chunkId: 'b', headingPath: 'H b', repo: 'workhorse', docType: 'spec' }]);
    expect(a.inputTokens).toBe(10);
  });

  it('streams the answer as it is written, and still resolves with the whole thing', async () => {
    // One path: the app always streams, so the tests exercise what the app runs. A caller that
    // passes no onDelta gets the same complete answer, which is what the CLI and the eval do.
    const deltas = ['It moved ', 'to the common dir ', '[2].'];
    const stream = vi.fn(() => fakeStream('It moved to the common dir [2].', { deltas }));
    const seen: { delta: string; snapshot: string }[] = [];
    const a = await generateAnswer('q?', [passage('a'), passage('b')], {
      apiKey: 'k',
      onDelta: (delta, snapshot) => seen.push({ delta, snapshot }),
      client: { messages: { stream } as never },
    });
    expect(seen.map((s) => s.delta)).toEqual(deltas);
    // The snapshot is the whole answer so far, so a renderer can assign it rather than append.
    expect(seen[seen.length - 1].snapshot).toBe('It moved to the common dir [2].');
    expect(a.text).toBe('It moved to the common dir [2].');
    expect(a.citations).toHaveLength(1);
  });

  it('with no history the request is byte-identical to the single question it always sent', () => {
    // The property the whole feature rests on: adding threads must not change what a fresh
    // question asks, because that is what the eval measures and the parity gate pins.
    const passages = [passage('a'), passage('b')];
    expect(buildMessages('q?', passages)).toEqual([{ role: 'user', content: buildUserPrompt('q?', passages) }]);
    expect(buildMessages('q?', passages, [])).toEqual([{ role: 'user', content: buildUserPrompt('q?', passages) }]);
  });

  it('a follow-up sends the thread as messages and warns that earlier passages are gone', () => {
    const passages = [passage('a')];
    const history = [{ question: 'first?', answer: 'first answer [1].' }, { question: 'second?', answer: 'second answer.' }];
    const messages = buildMessages('third?', passages, history);
    expect(messages.map((m) => m.role)).toEqual(['user', 'assistant', 'user', 'assistant', 'user']);
    expect(messages[0].content).toBe('first?');
    expect(messages[3].content).toBe('second answer.');
    // The note is in the follow-up's own message, never in the tuned system prompt.
    expect(messages[4].content.startsWith(FOLLOW_UP_NOTE)).toBe(true);
    expect(messages[4].content).toContain('Question: third?');
    expect(SYSTEM_PROMPT).not.toContain(FOLLOW_UP_NOTE);
  });

  it('the thread reaches the model', async () => {
    const stream = vi.fn((params: { messages: { role: string }[] }) => {
      expect(params.messages).toHaveLength(3);
      return fakeStream('ok [1]');
    });
    await generateAnswer('q?', [passage('a')], {
      apiKey: 'k',
      history: [{ question: 'earlier?', answer: 'earlier answer.' }],
      client: { messages: { stream } as never },
    });
    expect(stream).toHaveBeenCalledOnce();
  });

  it('a model that rejects temperature is retried once without it', async () => {
    let calls = 0;
    const stream = vi.fn((params: { temperature?: number }) => {
      calls += 1;
      if (params.temperature !== undefined) {
        // The 400 arrives from finalMessage(), not from stream() itself.
        return { on: () => undefined, finalMessage: async () => { throw Object.assign(new Error('`temperature` is deprecated for this model.'), { status: 400 }); } };
      }
      return fakeStream('ok [1]');
    });
    const a = await generateAnswer('q?', [passage('a')], { apiKey: 'k', model: 'rejects-temp', client: { messages: { stream } as never } });
    expect(calls).toBe(2);
    expect(a.text).toBe('ok [1]');
  });
});

// ---------------------------------------------------------------- createStudbook

function fakeModels(): Models {
  return {
    ready: () => true,
    embed: async (texts) => texts.map(() => [0.5, 0.5]),
    rerank: async (_q, passages, topK) => passages.slice(0, topK),
  };
}

function fakeDb(rows: Record<string, unknown>[]): { db: DbClient; ended: () => boolean } {
  let ended = false;
  return {
    ended: () => ended,
    db: {
      async query(text) {
        // The repos query also says count(*), so it is matched first.
        if (text.includes('group by d.repo')) {
          return { rows: [{ repo: 'workhorse', change_id: null, n: 1 }, { repo: 'workhorse', change_id: 'c1', n: 3 }] };
        }
        if (text.includes('count(*)')) return { rows: [{ documents: '2', chunks: '5' }] };
        return { rows };
      },
      async end() {
        ended = true;
      },
    },
  };
}

describe('createStudbook', () => {
  const dir = mkdtempSync(join(tmpdir(), 'paddock-studbook-'));
  const caPath = join(dir, 'ca.pem');
  writeFileSync(caPath, '-----BEGIN CERTIFICATE-----\nMIIB\n-----END CERTIFICATE-----\n');

  const row = { chunk_id: 'k1', document_id: 'd', heading_path: 'H', body: 'b', repo: 'workhorse', doc_type: 'spec' };

  it('refuses to connect when the CA file is missing, rather than connecting unverified', async () => {
    const sb = createStudbook({
      readIngestConninfo: () => null, readConninfo: () => 'host=h',
      readApiKey: () => 'k',
      caPath: join(dir, 'missing.pem'),
      modelCacheDir: dir,
      models: fakeModels(),
      connect: async () => fakeDb([row]).db,
    });
    await expect(sb.search('q')).rejects.toThrow(/unverified/);
  });

  it('refuses without a stored conninfo and says where to put one', async () => {
    const sb = createStudbook({ readIngestConninfo: () => null, readConninfo: () => null, readApiKey: () => 'k', caPath, modelCacheDir: dir, models: fakeModels() });
    await expect(sb.search('q')).rejects.toThrow(/Settings > Studbook/);
    expect(sb.status().configured).toBe(false);
  });

  it('search retrieves through a per-request connection that is always closed', async () => {
    const fake = fakeDb([row]);
    let receivedCa = '';
    const sb = createStudbook({
      readIngestConninfo: () => null, readConninfo: () => 'host=h user=u',
      readApiKey: () => null,
      caPath,
      modelCacheDir: dir,
      models: fakeModels(),
      connect: async (_target, ca) => {
        receivedCa = ca;
        return fake.db;
      },
    });
    const passages = await sb.search('why?');
    expect(passages.map((p) => p.chunkId)).toEqual(['k1']);
    expect(fake.ended()).toBe(true);
    expect(receivedCa).toContain('BEGIN CERTIFICATE');
  });

  describe('what ask searches for', () => {
    // An empty store: retrieval returns nothing, so generation refuses without an API call and
    // these tests see only what the search path did.
    function setup() {
      const models = fakeModels();
      const embed = vi.spyOn(models, 'embed');
      const rerank = vi.spyOn(models, 'rerank');
      const rewrite = vi.fn(async (question: string, history: string[]) =>
        history.length === 0
          ? { query: question, method: 'fresh' as const }
          : { query: `standalone: ${question}`, method: 'rewritten' as const });
      const sb = createStudbook({
        readIngestConninfo: () => null, readConninfo: () => 'host=h', readApiKey: () => 'k',
        caPath, modelCacheDir: dir, models, rewrite,
        connect: async () => fakeDb([]).db,
      });
      return { sb, embed, rerank, rewrite };
    }

    it('a fresh question searches for itself', async () => {
      const { sb, embed, rewrite } = setup();
      const result = await sb.ask('why?');
      expect(rewrite).toHaveBeenCalledWith('why?', [], { apiKey: 'k' });
      expect(embed).toHaveBeenCalledWith(['why?']);
      expect(result.search).toEqual({ query: 'why?', method: 'fresh' });
    });

    it('a follow-up is retrieved and reranked with its rewrite, from the questions alone', async () => {
      const { sb, embed, rerank, rewrite } = setup();
      const history = [{ question: 'one?', answer: 'an answer that must not reach the rewriter' }];
      const result = await sb.ask('what broke?', {}, 5, history);
      expect(rewrite).toHaveBeenCalledWith('what broke?', ['one?'], { apiKey: 'k' });
      expect(embed).toHaveBeenCalledWith(['standalone: what broke?']);
      expect(rerank.mock.calls[0][0]).toBe('standalone: what broke?');
      expect(result.search.method).toBe('rewritten');
      // The answer is still to the question the user asked.
      expect(result.question).toBe('what broke?');
    });
  });

  it('ask needs an API key even when search works', async () => {
    const sb = createStudbook({
      readIngestConninfo: () => null, readConninfo: () => 'host=h',
      readApiKey: () => null,
      caPath,
      modelCacheDir: dir,
      models: fakeModels(),
      connect: async () => fakeDb([row]).db,
    });
    await expect(sb.ask('q')).rejects.toThrow(/API key/);
    expect(sb.status().lastError).toMatch(/API key/);
  });

  it('check counts the corpus and repos groups change ids per repo', async () => {
    const sb = createStudbook({
      readIngestConninfo: () => null, readConninfo: () => 'host=h',
      readApiKey: () => 'k',
      caPath,
      modelCacheDir: dir,
      models: fakeModels(),
      connect: async () => fakeDb([row]).db,
    });
    const status = await sb.check();
    expect(status.corpus).toEqual({ documents: 2, chunks: 5 });
    expect(await sb.repos()).toEqual([{ repo: 'workhorse', changes: [{ changeId: 'c1', documents: 3 }] }]);
  });
});

// ---------------------------------------------------------------- IPC surface

describe('studbook over IPC', () => {
  function fakeIpc(): { ipcMain: IpcMainLike; invoke: (channel: string, ...args: unknown[]) => Promise<unknown> } {
    const handlers = new Map<string, (event: unknown, ...args: any[]) => unknown>();
    return {
      ipcMain: { handle: (c, l) => void handlers.set(c, l) },
      invoke: async (c, ...args) => {
        const h = handlers.get(c);
        if (!h) throw new Error(`no handler for ${c}`);
        return h({}, ...args);
      },
    };
  }

  function deps(overrides: Partial<IpcDeps> = {}): { deps: IpcDeps; stored: { conninfo: string | null } } {
    const stored = { conninfo: null as string | null };
    const settings = {
      get: () => ({ backend: 'cli', pluginPath: null, allowedTools: {}, theme: 'dark', notifyUrl: null }),
      set: (p: unknown) => p,
      setApiKey: () => undefined,
      hasApiKey: () => false,
      clearApiKey: () => undefined,
      readApiKey: () => null,
      setStudbookConninfo: (c: string) => void (stored.conninfo = c),
      hasStudbookConninfo: () => stored.conninfo !== null,
      clearStudbookConninfo: () => void (stored.conninfo = null),
      readStudbookConninfo: () => stored.conninfo,
    } as unknown as IpcDeps['settings'];
    const base: IpcDeps = {
      ipcMain: { handle: () => undefined },
      dialog: { showOpenDialog: async () => ({ canceled: true, filePaths: [] }) },
      win: { webContents: { send: () => undefined } },
      registry: { list: () => [], get: () => undefined, add: () => ({}) as never, remove: () => undefined } as unknown as IpcDeps['registry'],
      settings,
      syscheck: async () => ({}) as never,
      watcher: { watch: () => undefined, unwatch: () => undefined, on: () => undefined } as unknown as IpcDeps['watcher'],
      driverFor: () => ({}) as never,
      pluginPath: '',
      digest: async () => [],
      runWh: async () => ({ code: 0, stdout: '', stderr: '' }),
      safe: { readApiKey: () => null },
      ...overrides,
    };
    return { deps: base, stored };
  }

  it('setConninfo validates shape and stores it; the value never comes back over IPC', async () => {
    const ipc = fakeIpc();
    const { deps: d, stored } = deps({ ipcMain: ipc.ipcMain });
    registerIpc(d);
    await expect(ipc.invoke(IPC.studbookSetConninfo, 'not a conninfo')).rejects.toThrow(/connection string/);
    await expect(ipc.invoke(IPC.studbookSetConninfo, '')).rejects.toThrow();
    await ipc.invoke(IPC.studbookSetConninfo, 'host=h user=u password=secret dbname=x');
    expect(stored.conninfo).toContain('password=secret');
    expect(await ipc.invoke(IPC.studbookHasConninfo)).toBe(true);
    // There is no channel that returns it: the only reads are boolean.
    expect(Object.values(IPC).some((c) => /conninfo/i.test(c) && /get|read/i.test(c))).toBe(false);
    await ipc.invoke(IPC.studbookClearConninfo);
    expect(stored.conninfo).toBeNull();
  });

  it('ask and search validate the question and bound topK before touching the store', async () => {
    const ipc = fakeIpc();
    const search = vi.fn(async () => [passage('a')]);
    const studbook = { status: () => ({}) as never, check: async () => ({}) as never, repos: async () => [], search, ask: vi.fn() } as never;
    registerIpc(deps({ ipcMain: ipc.ipcMain, studbook }).deps);
    await expect(ipc.invoke(IPC.studbookSearch, '')).rejects.toThrow(/question/);
    await expect(ipc.invoke(IPC.studbookSearch, 'x'.repeat(2001))).rejects.toThrow(/2000/);
    await expect(ipc.invoke(IPC.studbookSearch, 'q', {}, 99)).rejects.toThrow(/topK/);
    expect(search).not.toHaveBeenCalled();
    const result = (await ipc.invoke(IPC.studbookSearch, ' q ', { repo: 'workhorse', changeId: 7 }, 3)) as { number: number }[];
    expect(search).toHaveBeenCalledWith('q', { repo: 'workhorse', changeId: null }, 3);
    expect(result[0].number).toBe(1);
  });

  it('history is validated and bounded before it becomes a prompt', async () => {
    const ipc = fakeIpc();
    const ask = vi.fn(async () => ({ question: 'q', answer: { text: '', citations: [], refused: false, model: 'm', inputTokens: 0, outputTokens: 0 }, passages: [] }));
    const studbook = { status: () => ({}) as never, check: async () => ({}) as never, repos: async () => [], search: vi.fn(), ask, sync: vi.fn() } as never;
    registerIpc(deps({ ipcMain: ipc.ipcMain, studbook }).deps);
    await expect(ipc.invoke(IPC.studbookAsk, 'q', {}, 5, 'not an array')).rejects.toThrow(/array/);
    await expect(ipc.invoke(IPC.studbookAsk, 'q', {}, 5, [{ question: 'a' }])).rejects.toThrow(/question and an answer/);
    await expect(ipc.invoke(IPC.studbookAsk, 'q', {}, 5, Array(13).fill({ question: 'a', answer: 'b' }))).rejects.toThrow(/12 turns/);
    await expect(ipc.invoke(IPC.studbookAsk, 'q', {}, 5, [{ question: 'a', answer: 'x'.repeat(8001) }])).rejects.toThrow(/too long/);
    expect(ask).not.toHaveBeenCalled();
    // Absent history is an empty thread, which is the single-question path. (An absent scope is
    // an empty object, not two explicit nulls: `checkScope` only names what was actually given.)
    // No askId, so nothing to stream to and onDelta is undefined; the answer still resolves whole.
    await ipc.invoke(IPC.studbookAsk, 'q');
    expect(ask).toHaveBeenCalledWith('q', {}, undefined, [], undefined);
  });

  it('chunks are tagged with the renderer\'s own askId, and a missing tag just means no streaming', async () => {
    const ipc = fakeIpc();
    const sent: { channel: string; payload: unknown }[] = [];
    const win = { webContents: { send: (channel: string, payload: unknown) => sent.push({ channel, payload }) } };
    const ask = vi.fn(async (_q, _s, _k, _h, onDelta?: (d: string, s: string) => void) => {
      onDelta?.('hello ', 'hello ');
      onDelta?.('world', 'hello world');
      return { question: 'q', answer: { text: 'hello world', citations: [], refused: false, model: 'm', inputTokens: 0, outputTokens: 0 }, passages: [] };
    });
    const studbook = { status: () => ({}) as never, check: async () => ({}) as never, repos: async () => [], search: vi.fn(), ask, sync: vi.fn() } as never;
    registerIpc(deps({ ipcMain: ipc.ipcMain, studbook, win }).deps);

    await ipc.invoke(IPC.studbookAsk, 'q', {}, 5, [], 'ask-1');
    expect(sent).toEqual([
      { channel: IPC.studbookAnswerChunk, payload: { askId: 'ask-1', delta: 'hello ', snapshot: 'hello ' } },
      { channel: IPC.studbookAnswerChunk, payload: { askId: 'ask-1', delta: 'world', snapshot: 'hello world' } },
    ]);

    sent.length = 0;
    await ipc.invoke(IPC.studbookAsk, 'q', {}, 5, [], 'x'.repeat(65)); // over the tag length cap
    expect(sent).toEqual([]);
  });

  it('sync runs over the registry, keyed by lowercased folder name, never a renderer path', async () => {
    const ipc = fakeIpc();
    const sync = vi.fn(async () => []);
    const studbook = { status: () => ({}) as never, check: async () => ({}) as never, repos: async () => [], search: vi.fn(), ask: vi.fn(), sync } as never;
    const registry = {
      list: () => [{ id: 'a', path: 'C:\\Users\\x\\WorkHorse', name: 'WorkHorse', addedAt: '' }, { id: 'b', path: '/tmp/paddock-demo', name: 'paddock-demo', addedAt: '' }],
      get: () => undefined, add: () => ({}) as never, remove: () => undefined,
    } as unknown as IpcDeps['registry'];
    registerIpc(deps({ ipcMain: ipc.ipcMain, studbook, registry }).deps);
    await ipc.invoke(IPC.studbookSync, '/anything/the/renderer/says');
    expect(sync).toHaveBeenCalledWith([
      { key: 'workhorse', path: 'C:\\Users\\x\\WorkHorse' },
      { key: 'paddock-demo', path: '/tmp/paddock-demo' },
    ]);
  });

  it('the ingest connection string has the same shape check and the same no-read rule', async () => {
    const ipc = fakeIpc();
    const stored = { ingest: null as string | null };
    const settings = {
      setStudbookIngestConninfo: (c: string) => void (stored.ingest = c),
      hasStudbookIngestConninfo: () => stored.ingest !== null,
      clearStudbookIngestConninfo: () => void (stored.ingest = null),
      readStudbookIngestConninfo: () => stored.ingest,
      get: () => ({ backend: 'cli', pluginPath: null, allowedTools: {}, theme: 'dark', notifyUrl: null }),
    } as unknown as IpcDeps['settings'];
    registerIpc(deps({ ipcMain: ipc.ipcMain, settings }).deps);
    await expect(ipc.invoke(IPC.studbookSetIngestConninfo, 'nope')).rejects.toThrow(/connection string/);
    await ipc.invoke(IPC.studbookSetIngestConninfo, 'host=h user=studbook_ingest_login.x password=s dbname=d');
    expect(await ipc.invoke(IPC.studbookHasIngestConninfo)).toBe(true);
    expect(Object.values(IPC).some((c) => /ingest/i.test(c) && /get|read/i.test(c))).toBe(false);
    await ipc.invoke(IPC.studbookClearIngestConninfo);
    expect(stored.ingest).toBeNull();
  });

  it('every studbook channel is refused cleanly when the build has no studbook', async () => {
    const ipc = fakeIpc();
    registerIpc(deps({ ipcMain: ipc.ipcMain }).deps);
    await expect(ipc.invoke(IPC.studbookStatus)).rejects.toThrow(/not available/);
  });
});
