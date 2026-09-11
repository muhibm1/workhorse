import { describe, it, expect, afterEach } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createWatcher, type Watcher } from '../src/main/watcher';
import type { ChangeDigest, RepoRef } from '@shared/types';

function makeRepo(): RepoRef {
  const path = mkdtempSync(join(tmpdir(), 'paddock-watcher-'));
  mkdirSync(join(path, '.workhorse'), { recursive: true });
  writeFileSync(join(path, '.workhorse', 'profile.yml'), 'client: acme\n');
  writeFileSync(join(path, '.workhorse', 'active'), 'x\n');
  return { id: 'r1', path, name: 'r1', addedAt: new Date(0).toISOString() };
}

function waitFor(predicate: () => boolean, timeoutMs: number): Promise<void> {
  return new Promise((resolve, reject) => {
    const start = Date.now();
    const poll = () => {
      if (predicate()) return resolve();
      if (Date.now() - start > timeoutMs) return reject(new Error('timed out waiting'));
      setTimeout(poll, 20);
    };
    poll();
  });
}

describe('createWatcher', () => {
  let watcher: Watcher | undefined;
  let repoPath: string | undefined;

  afterEach(async () => {
    await watcher?.close();
    if (repoPath) rmSync(repoPath, { recursive: true, force: true });
    watcher = undefined;
    repoPath = undefined;
  });

  it('emits one digest per burst, then stops after unwatch', async () => {
    const repo = makeRepo();
    repoPath = repo.path;

    const calls: string[] = [];
    const digest = async (p: string): Promise<ChangeDigest[]> => {
      calls.push(p);
      return [{ change_id: 'x' } as unknown as ChangeDigest];
    };

    watcher = createWatcher({ digest, debounceMs: 250 });

    const emissions: { repoId: string; digests: ChangeDigest[] }[] = [];
    const unsubscribe = watcher.on((e) => emissions.push(e));

    watcher.watch(repo);

    // Let the initial (ignoreInitial: false) scan settle before the burst, so it doesn't get
    // coalesced into the assertion below.
    await waitFor(() => emissions.length >= 1, 2000);
    const afterInitial = emissions.length;

    const changeDir = join(repo.path, 'docs', 'sdlc', 'x');
    mkdirSync(changeDir, { recursive: true });
    writeFileSync(join(changeDir, 'state.json'), '{}');
    writeFileSync(join(changeDir, 'plan.md'), '# plan');
    writeFileSync(join(changeDir, 'notes.md'), '# notes');

    await waitFor(() => emissions.length > afterInitial, 2000);
    // Give any further coalesced events in the burst a chance to land before asserting the count.
    await new Promise((r) => setTimeout(r, 400));

    expect(emissions.length).toBe(afterInitial + 1);
    expect(emissions[emissions.length - 1]).toMatchObject({
      repoId: 'r1',
      digests: [{ change_id: 'x' }],
    });

    const beforeUnwatch = emissions.length;
    watcher.unwatch('r1');

    writeFileSync(join(changeDir, 'state.json'), '{"changed":true}');
    await new Promise((r) => setTimeout(r, 700));

    expect(emissions.length).toBe(beforeUnwatch);

    unsubscribe();
  });

  it('ignores files outside the watched patterns', async () => {
    const repo = makeRepo();
    repoPath = repo.path;

    const digest = async (): Promise<ChangeDigest[]> => [];
    watcher = createWatcher({ digest, debounceMs: 150 });

    const emissions: { repoId: string; digests: ChangeDigest[] }[] = [];
    watcher.on((e) => emissions.push(e));

    watcher.watch(repo);
    await waitFor(() => emissions.length >= 1, 2000); // initial scan
    const baseline = emissions.length;

    mkdirSync(join(repo.path, 'docs', 'sdlc', 'y'), { recursive: true });
    writeFileSync(join(repo.path, 'docs', 'sdlc', 'y', 'scratch.txt'), 'irrelevant');
    writeFileSync(join(repo.path, 'README.md'), '# not under docs/sdlc');

    await new Promise((r) => setTimeout(r, 600));
    expect(emissions.length).toBe(baseline);
  });
});
