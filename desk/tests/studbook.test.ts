import { describe, it, expect, vi } from 'vitest';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { looksLikeConninfo, parseConninfo } from '../src/main/studbook/conninfo';
import { reciprocalRankFusion, retrieveVector, retrieveFulltext, type Passage, type Queryable } from '../src/main/studbook/retrieval';
import { buildContext, cleanRefusal, generateAnswer, parseCitedNumbers, SYSTEM_PROMPT } from '../src/main/studbook/answer';
import { createStudbook, type DbClient } from '../src/main/studbook';
import type { Models } from '../src/main/studbook/models';
import { IPC } from '@shared/types';
import { registerIpc, type IpcDeps, type IpcMainLike } from '../src/main/ipc';

function passage(id: string, body = `body of ${id}`): Passage {
  return { chunkId: id, documentId: 'd', headingPath: `H ${id}`, body, repo: 'workhorse', docType: 'spec' };
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
    const create = vi.fn();
    const a = await generateAnswer('q?', [], { apiKey: 'k', client: { messages: { create } as never } });
    expect(a.refused).toBe(true);
    expect(create).not.toHaveBeenCalled();
  });

  it('pins temperature 0 and maps citations to passages', async () => {
    const create = vi.fn(async (params: { temperature?: number }) => {
      expect(params.temperature).toBe(0);
      return { content: [{ type: 'text', text: 'It moved to the common dir [2].' }], usage: { input_tokens: 10, output_tokens: 5 } };
    });
    const a = await generateAnswer('q?', [passage('a'), passage('b')], { apiKey: 'k', client: { messages: { create } as never } });
    expect(a.refused).toBe(false);
    expect(a.citations).toEqual([{ number: 2, chunkId: 'b', headingPath: 'H b', repo: 'workhorse', docType: 'spec' }]);
    expect(a.inputTokens).toBe(10);
  });

  it('a model that rejects temperature is retried once without it', async () => {
    let calls = 0;
    const create = vi.fn(async (params: { temperature?: number }) => {
      calls += 1;
      if (params.temperature !== undefined) {
        const err = Object.assign(new Error('`temperature` is deprecated for this model.'), { status: 400 });
        throw err;
      }
      return { content: [{ type: 'text', text: 'ok [1]' }], usage: { input_tokens: 1, output_tokens: 1 } };
    });
    const a = await generateAnswer('q?', [passage('a')], { apiKey: 'k', model: 'rejects-temp', client: { messages: { create } as never } });
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
      readConninfo: () => 'host=h',
      readApiKey: () => 'k',
      caPath: join(dir, 'missing.pem'),
      modelCacheDir: dir,
      models: fakeModels(),
      connect: async () => fakeDb([row]).db,
    });
    await expect(sb.search('q')).rejects.toThrow(/unverified/);
  });

  it('refuses without a stored conninfo and says where to put one', async () => {
    const sb = createStudbook({ readConninfo: () => null, readApiKey: () => 'k', caPath, modelCacheDir: dir, models: fakeModels() });
    await expect(sb.search('q')).rejects.toThrow(/Settings > Studbook/);
    expect(sb.status().configured).toBe(false);
  });

  it('search retrieves through a per-request connection that is always closed', async () => {
    const fake = fakeDb([row]);
    let receivedCa = '';
    const sb = createStudbook({
      readConninfo: () => 'host=h user=u',
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

  it('ask needs an API key even when search works', async () => {
    const sb = createStudbook({
      readConninfo: () => 'host=h',
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
      readConninfo: () => 'host=h',
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

  it('every studbook channel is refused cleanly when the build has no studbook', async () => {
    const ipc = fakeIpc();
    registerIpc(deps({ ipcMain: ipc.ipcMain }).deps);
    await expect(ipc.invoke(IPC.studbookStatus)).rejects.toThrow(/not available/);
  });
});
