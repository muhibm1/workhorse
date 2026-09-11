import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { basename, dirname } from 'node:path';
import type { RepoRef } from '@shared/types';

/** First 12 hex chars of sha1(path). Stable across process restarts, short enough for IPC keys. */
function idFor(repoPath: string): string {
  return createHash('sha1').update(repoPath).digest('hex').slice(0, 12);
}

/**
 * The registry of repositories Paddock watches, persisted as a JSON array at `file`.
 *
 * Never trusts a caller-supplied id for a filesystem path: `add` is the only way a path enters
 * the registry, and every other lookup goes through the id it assigns.
 */
export function createRegistry(file: string) {
  function load(): RepoRef[] {
    if (!existsSync(file)) return [];
    try {
      const parsed = JSON.parse(readFileSync(file, 'utf8'));
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      return [];
    }
  }

  function save(list: RepoRef[]): void {
    mkdirSync(dirname(file), { recursive: true });
    writeFileSync(file, JSON.stringify(list, null, 2));
  }

  return {
    list(): RepoRef[] {
      return load();
    },

    /** Idempotent: adding a path already present returns the existing ref unchanged. */
    add(repoPath: string): RepoRef {
      if (!existsSync(repoPath)) throw new Error('folder does not exist');
      const list = load();
      const id = idFor(repoPath);
      const existing = list.find((r) => r.id === id);
      if (existing) return existing;
      const ref: RepoRef = { id, path: repoPath, name: basename(repoPath), addedAt: new Date().toISOString() };
      list.push(ref);
      save(list);
      return ref;
    },

    remove(id: string): void {
      const list = load();
      const next = list.filter((r) => r.id !== id);
      if (next.length !== list.length) save(next);
    },

    get(id: string): RepoRef | undefined {
      return load().find((r) => r.id === id);
    },
  };
}
