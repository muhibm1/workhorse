import { describe, it, expect, beforeEach } from 'vitest';
import { mkdtempSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createRegistry } from '../src/main/registry';

describe('registry', () => {
  let dir: string;
  let file: string;
  let repoA: string;
  let repoB: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'paddock-registry-'));
    file = join(dir, 'repos.json');
    repoA = join(dir, 'repo-a');
    repoB = join(dir, 'repo-b');
    mkdirSync(repoA);
    mkdirSync(repoB);
  });

  it('adds, lists, dedupes by path, removes', () => {
    const registry = createRegistry(file);
    expect(registry.list()).toEqual([]);

    const a = registry.add(repoA);
    expect(a.path).toBe(repoA);
    expect(a.name).toBe('repo-a');
    expect(a.id).toMatch(/^[0-9a-f]{12}$/);
    expect(registry.list()).toHaveLength(1);

    const b = registry.add(repoB);
    expect(b.id).not.toBe(a.id);
    expect(registry.list()).toHaveLength(2);

    // dedupe: adding the same path again returns the same ref, no duplicate entry
    const aAgain = registry.add(repoA);
    expect(aAgain).toEqual(a);
    expect(registry.list()).toHaveLength(2);

    registry.remove(a.id);
    const remaining = registry.list();
    expect(remaining).toHaveLength(1);
    expect(remaining[0].id).toBe(b.id);
    expect(registry.get(a.id)).toBeUndefined();
    expect(registry.get(b.id)).toEqual(b);
  });

  it('rejects a folder that does not exist', () => {
    const registry = createRegistry(file);
    expect(() => registry.add(join(dir, 'does-not-exist'))).toThrow('folder does not exist');
    expect(registry.list()).toEqual([]);
  });

  it('persists across separate registry instances pointed at the same file', () => {
    const first = createRegistry(file);
    const ref = first.add(repoA);

    const second = createRegistry(file);
    expect(second.list()).toEqual([ref]);
    expect(second.get(ref.id)).toEqual(ref);
  });
});
