import { describe, it, expect, afterEach } from 'vitest';
import { mkdtempSync, rmSync, realpathSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, dirname, join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { resolveStateRoot } from '../src/main/watcher';

const made: string[] = [];
function tempDir(prefix: string): string {
  const d = mkdtempSync(join(tmpdir(), prefix));
  made.push(d);
  return d;
}
function git(cwd: string, ...args: string[]): void {
  execFileSync('git', args, { cwd, stdio: 'ignore' });
}

afterEach(() => {
  while (made.length) rmSync(made.pop() as string, { recursive: true, force: true });
});

describe('resolveStateRoot', () => {
  it('uses <repo>/.git/workhorse in a normal repository', () => {
    const repo = tempDir('paddock-sr-');
    git(repo, 'init', '-q');
    const root = resolveStateRoot(repo);
    expect(basename(root)).toBe('workhorse');
    expect(realpathSync(dirname(root))).toBe(realpathSync(join(repo, '.git')));
  });

  it('follows a worktree back to the shared git directory, so worktrees share one state', () => {
    const repo = tempDir('paddock-sr-main-');
    git(repo, 'init', '-q');
    git(repo, '-c', 'user.email=t@example.com', '-c', 'user.name=t', 'commit', '-q', '--allow-empty', '-m', 'init');
    const wt = join(tempDir('paddock-sr-wt-'), 'wt');
    git(repo, 'worktree', 'add', '-q', wt, '-b', 'side');
    const fromWorktree = resolveStateRoot(wt);
    expect(basename(fromWorktree)).toBe('workhorse');
    expect(realpathSync(dirname(fromWorktree))).toBe(realpathSync(join(repo, '.git')));
    expect(fromWorktree.toLowerCase()).toBe(resolveStateRoot(repo).toLowerCase());
  });

  it('falls back to .workhorse/state when the folder is not a git repository', () => {
    const plain = tempDir('paddock-sr-plain-');
    expect(resolveStateRoot(plain)).toBe(join(plain, '.workhorse', 'state'));
  });
});
