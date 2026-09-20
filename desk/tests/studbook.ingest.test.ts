import { describe, it, expect } from 'vitest';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { changeIdFor, docTypeFor, repoKeyFor, walkCommits, walkFiles, walkRepo, type ParsedDocument, sha256 } from '../src/main/studbook/parser';
import { chunkDocument } from '../src/main/studbook/chunker';
import { syncRepo, type SyncClient } from '../src/main/studbook/sync';
import type { Models } from '../src/main/studbook/models';

function doc(text: string, id = 'repo/path.md'): ParsedDocument {
  return { id, repo: 'repo', path: 'path.md', docType: 'spec', changeId: null, tier: null, docDate: null, commitSha: '0'.repeat(40), text, contentHash: sha256(text) };
}

// The same cases studbook/tests/test_parser.py and test_chunker.py assert, so the two ports are
// held to one behaviour by their unit tests as well as by the live chunk gate.

describe('studbook parser', () => {
  it('maps files under a change folder, adrs, design docs and the root README', () => {
    expect(docTypeFor('docs/sdlc/2026-01-01-x/spec.md')).toBe('spec');
    expect(docTypeFor('docs/sdlc/2026-01-01-x/adr/0001-thing.md')).toBe('adr');
    expect(docTypeFor('docs/superpowers/specs/2026-01-01-design.md')).toBe('design-doc');
    expect(docTypeFor('README.md')).toBe('readme');
    expect(docTypeFor('CHANGELOG.md')).toBe('changelog');
    expect(docTypeFor('desk/CHANGELOG.md')).toBe('changelog');
    expect(docTypeFor('desk/node_modules/pkg/CHANGELOG.md')).toBeNull();
    expect(docTypeFor('docs/sdlc/codebase-map.md')).toBe('codebase-map');
  });

  it('maps the two gate documents and reviewer reports of WorkHorse 0.3.0, keeping the older ones', () => {
    expect(docTypeFor('docs/sdlc/2026-01-01-x/brief.md')).toBe('brief');
    expect(docTypeFor('docs/sdlc/2026-01-01-x/ship.md')).toBe('ship');
    expect(docTypeFor('docs/sdlc/2026-01-01-x/reviews/wh-bug-reviewer.md')).toBe('review');
    expect(docTypeFor('docs/sdlc/2026-01-01-x/reviews/spec.md')).toBe('review');
    expect(docTypeFor('docs/sdlc/2026-01-01-x/intent.md')).toBe('intent');
    expect(docTypeFor('docs/sdlc/2026-01-01-x/review-packet.md')).toBe('review-packet');
    // Only .md files directly inside reviews/, and only inside a change folder.
    expect(docTypeFor('docs/sdlc/2026-01-01-x/reviews/notes.txt')).toBeNull();
    expect(docTypeFor('docs/sdlc/2026-01-01-x/reviews/deeper/x.md')).toBeNull();
    expect(docTypeFor('reviews/x.md')).toBeNull();
    expect(changeIdFor('docs/sdlc/2026-01-01-x/brief.md', 'brief')).toBe('2026-01-01-x');
    expect(changeIdFor('docs/sdlc/2026-01-01-x/ship.md', 'ship')).toBe('2026-01-01-x');
    expect(changeIdFor('docs/sdlc/2026-01-01-x/reviews/wh-bug-reviewer.md', 'review')).toBe('2026-01-01-x');
  });

  it('skips nested READMEs, verify-logs and unknown files', () => {
    expect(docTypeFor('examples/hello-service/README.md')).toBeNull();
    expect(docTypeFor('docs/sdlc/2026-01-01-x/verify-logs/spec.md')).toBeNull();
    expect(docTypeFor('docs/sdlc/2026-01-01-x/notes.md')).toBeNull();
  });

  it('a change-scoped file gets its folder as change id; codebase-map and design docs do not', () => {
    expect(changeIdFor('docs/sdlc/2026-01-01-x/spec.md', 'spec')).toBe('2026-01-01-x');
    expect(changeIdFor('docs/sdlc/2026-01-01-x/adr/0001-y.md', 'adr')).toBe('2026-01-01-x');
    expect(changeIdFor('docs/sdlc/codebase-map.md', 'codebase-map')).toBeNull();
    expect(changeIdFor('docs/superpowers/specs/x.md', 'design-doc')).toBeNull();
  });

  it('the store key is the folder name, lowercased, on either separator', () => {
    expect(repoKeyFor('C:\\Users\\x\\WorkHorse')).toBe('workhorse');
    expect(repoKeyFor('/tmp/paddock-demo/')).toBe('paddock-demo');
  });

  it('walks a real repository: files stamped with HEAD, tier from intent.md, one doc per commit', async () => {
    const repo = mkdtempSync(join(tmpdir(), 'paddock-parser-'));
    const git = (...args: string[]) => execFileSync('git', ['-C', repo, ...args], { stdio: 'pipe' });
    git('init', '-q');
    git('config', 'user.email', 't@example.com');
    git('config', 'user.name', 'T');
    mkdirSync(join(repo, 'docs', 'sdlc', '2026-01-01-x', 'verify-logs'), { recursive: true });
    writeFileSync(join(repo, 'docs', 'sdlc', '2026-01-01-x', 'intent.md'), '# Intent\r\n\r\nRisk tier: 2\r\nDate: 2026-01-01\r\n');
    writeFileSync(join(repo, 'docs', 'sdlc', '2026-01-01-x', 'spec.md'), '# Spec\n\n## A\n\ntext\n');
    writeFileSync(join(repo, 'docs', 'sdlc', '2026-01-01-x', 'verify-logs', 'test.log'), 'noise');
    writeFileSync(join(repo, 'README.md'), '# Readme\n');
    git('add', '.');
    git('commit', '-q', '-m', 'first: subject\n\nbody line');
    git('commit', '-q', '--allow-empty', '-m', 'second');

    const files = await walkFiles('repo', repo);
    const byPath = new Map(files.map((f) => [f.path, f]));
    expect([...byPath.keys()].sort()).toEqual(['README.md', 'docs/sdlc/2026-01-01-x/intent.md', 'docs/sdlc/2026-01-01-x/spec.md']);
    const spec = byPath.get('docs/sdlc/2026-01-01-x/spec.md')!;
    expect(spec.tier).toBe(2); // propagated from the sibling intent.md
    expect(spec.changeId).toBe('2026-01-01-x');
    expect(spec.commitSha).toMatch(/^[0-9a-f]{40}$/);
    const intent = byPath.get('docs/sdlc/2026-01-01-x/intent.md')!;
    expect(intent.docDate).toBe('2026-01-01');
    expect(intent.text).not.toContain('\r'); // CRLF normalised, as Python's read does
    expect(byPath.get('README.md')!.tier).toBeNull();

    const commits = await walkCommits('repo', repo);
    expect(commits.map((c) => c.text)).toEqual(['second', 'first: subject\n\nbody line']);
    expect(commits[0].id).toBe(`repo/git:${commits[0].commitSha}`);
    expect(commits[0].docDate).toMatch(/^\d{4}-\d{2}-\d{2}$/);

    // A folder inside the repository (Paddock's examples/hello-service is one) gets its files but
    // never the enclosing repository's commit history.
    const nested = join(repo, 'examples', 'svc');
    mkdirSync(nested, { recursive: true });
    writeFileSync(join(nested, 'README.md'), '# Nested\n');
    const docs = await walkRepo('svc', nested);
    expect(docs.map((d) => d.docType)).toEqual(['readme']);
    expect(docs[0].commitSha).toBe(commits[0].commitSha); // stamped with the enclosing HEAD
    expect(await walkRepo('repo', repo)).toHaveLength(files.length + commits.length);
  });

  it('takes the tier from brief.md, which wins over intent.md, and applies it to the whole change', async () => {
    // The same three changes studbook/tests/test_parser.py walks, so both ports agree on the tier.
    const repo = mkdtempSync(join(tmpdir(), 'paddock-parser-brief-'));
    const git = (...args: string[]) => execFileSync('git', ['-C', repo, ...args], { stdio: 'pipe' });
    git('init', '-q');
    git('config', 'user.email', 't@example.com');
    git('config', 'user.name', 'T');
    const add = (changeId: string, files: Record<string, string>) => {
      for (const [rel, text] of Object.entries(files)) {
        const abs = join(repo, 'docs', 'sdlc', changeId, ...rel.split('/'));
        mkdirSync(join(abs, '..'), { recursive: true });
        writeFileSync(abs, text);
      }
    };
    add('2026-02-02-brief-only', {
      'brief.md': '# Brief\n\nChange id: `2026-02-02-brief-only` · Prepared 2026-02-02 UTC\nRisk tier: 3 (touches production data)\n',
      'ship.md': '# Ship\n\n## Verification\n\ngreen\n',
      'reviews/wh-bug-reviewer.md': '# Bug review\n\nNo findings.\n',
    });
    add('2026-02-03-both', { 'intent.md': '# Intent\n\nRisk tier: 1 (old)\n', 'brief.md': '# Brief\n\nRisk tier: 2 (redesigned)\n', 'spec.md': '# Spec\n' });
    add('2026-02-04-brief-without-tier', { 'intent.md': '# Intent\n\nRisk tier: 1 (old)\n', 'brief.md': '# Brief\n\nNo tier line yet.\n' });
    git('add', '.');
    git('commit', '-q', '-m', 'docs');

    const byPath = new Map((await walkFiles('repo', repo)).map((f) => [f.path, f]));
    for (const [rel, docType] of [['brief.md', 'brief'], ['ship.md', 'ship'], ['reviews/wh-bug-reviewer.md', 'review']]) {
      const d = byPath.get(`docs/sdlc/2026-02-02-brief-only/${rel}`)!;
      expect(d).toMatchObject({ docType, changeId: '2026-02-02-brief-only', tier: 3 });
    }
    expect(byPath.get('docs/sdlc/2026-02-03-both/spec.md')!.tier).toBe(2);
    expect(byPath.get('docs/sdlc/2026-02-03-both/intent.md')!.tier).toBe(2);
    expect(byPath.get('docs/sdlc/2026-02-04-brief-without-tier/brief.md')!.tier).toBe(1);
  });
});

describe('studbook chunker', () => {
  it('one chunk per H2 with the H1 prepended to the heading path', () => {
    const chunks = chunkDocument(doc('# Spec: widget\n\n## Problem\n\nThe widget is broken.\n\n## Solution\n\nFix it.\n'));
    expect(chunks.map((c) => c.headingPath)).toEqual(['Spec: widget > Problem', 'Spec: widget > Solution']);
    expect(chunks.map((c) => c.body)).toEqual(['The widget is broken.', 'Fix it.']);
    expect(chunks.map((c) => c.id)).toEqual(['repo/path.md#0', 'repo/path.md#1']);
  });

  it('a heading-less document is one chunk called Document', () => {
    const chunks = chunkDocument(doc('Just a plain commit message.'));
    expect(chunks).toHaveLength(1);
    expect(chunks[0].headingPath).toBe('Document');
  });

  it('an oversized H2 is split by H3', () => {
    const big = 'word '.repeat(700);
    const chunks = chunkDocument(doc(`# Doc\n\n## Big section\n\n### Part one\n\n${big}\n\n### Part two\n\nshort.\n`));
    expect(chunks.map((c) => c.headingPath)).toEqual(['Doc > Big section > Part one', 'Doc > Big section > Part two']);
  });

  it('a giant table is split by row with the header repeated, no row in two windows', () => {
    const header = '| id | note |';
    const sep = '| --- | --- |';
    const rows = Array.from({ length: 30 }, (_, i) => `| ${i} | ${'x '.repeat(60)} |`);
    const chunks = chunkDocument(doc('# Doc\n\n' + [header, sep, ...rows].join('\n') + '\n'), 200);
    expect(chunks.length).toBeGreaterThan(1);
    for (const c of chunks) {
      expect(c.body).toContain(header);
      expect(c.body).toContain(sep);
    }
    const seen = chunks.flatMap((c) => c.body.split('\n').filter((l) => l.startsWith('| ') && l !== header && l !== sep));
    expect(seen.sort()).toEqual([...rows].sort());
  });

  it('token_count rounds half to even, as Python round() does', () => {
    // 5 words * 1.3 = 6.5 -> 6 (Python), not 7 (Math.round). 15 words -> 19.5 -> 20.
    expect(chunkDocument(doc('a b c d e'))[0].tokenCount).toBe(6);
    expect(chunkDocument(doc(Array(15).fill('w').join(' ')))[0].tokenCount).toBe(20);
  });

  it('a heading naming a gate sets the gate column', () => {
    expect(chunkDocument(doc('# Doc\n\n## G4: approved\n\nnotes\n'))[0].gate).toBe('G4');
    expect(chunkDocument(doc('# Doc\n\n## Problem\n\ntext\n'))[0].gate).toBeNull();
  });
});

describe('studbook sync', () => {
  function fakeModels(): Models {
    return { ready: () => true, embed: async (t) => t.map(() => [0.1, 0.2]), rerank: async (_q, p) => p };
  }
  function fakeClient(existing: { id: string; content_hash: string }[]) {
    const calls: { text: string; values?: unknown[] }[] = [];
    const client: SyncClient = {
      async query(text, values) {
        calls.push({ text, values });
        if (text.startsWith('select id, content_hash')) return { rows: existing };
        if (text.startsWith('delete')) return { rows: [], rowCount: 1 };
        return { rows: [] };
      },
    };
    return { client, calls };
  }

  it('embeds only chunks whose hash changed and writes inside one transaction', async () => {
    const d = doc('# D\n\n## A\n\nsame\n\n## B\n\nchanged\n');
    const chunks = chunkDocument(d);
    const { client, calls } = fakeClient([{ id: chunks[0].id, content_hash: chunks[0].contentHash }, { id: chunks[1].id, content_hash: 'stale' }]);
    const embedded: string[][] = [];
    const models = { ...fakeModels(), embed: async (t: string[]) => { embedded.push(t); return t.map(() => [1, 2]); } };
    const stats = await syncRepo(client, 'repo', '/x', { models, walk: async () => [d] });
    expect(embedded.flat()).toEqual(['changed']);
    expect(stats).toMatchObject({ documents: 1, chunksEmbedded: 1, chunksUnchanged: 1 });
    const texts = calls.map((c) => c.text.split(' ')[0]);
    expect(texts.indexOf('begin')).toBeLessThan(texts.indexOf('insert'));
    expect(texts[texts.length - 1]).toBe('commit');
    const chunkUpserts = calls.filter((c) => c.text.startsWith('insert into studbook.chunks'));
    expect(chunkUpserts).toHaveLength(1);
    expect(chunkUpserts[0].values![8]).toBe('[1,2]');
  });

  it('deletes only within the repository being synced, and rolls back on failure', async () => {
    const d = doc('# D\n\nbody\n');
    const { client, calls } = fakeClient([]);
    await syncRepo(client, 'repo', '/x', { models: fakeModels(), walk: async () => [d] });
    const deleteDocs = calls.find((c) => c.text.startsWith('delete from studbook.documents'))!;
    expect(deleteDocs.values![0]).toBe('repo');

    const failing: SyncClient = {
      async query(text) {
        calls.push({ text });
        if (text.startsWith('insert into studbook.documents')) throw new Error('boom');
        return { rows: [] };
      },
    };
    await expect(syncRepo(failing, 'repo', '/x', { models: fakeModels(), walk: async () => [d] })).rejects.toThrow('boom');
    expect(calls[calls.length - 1].text).toBe('rollback');
  });
});
