import { watch as chokidarWatch, type FSWatcher } from 'chokidar';
import { basename, relative, sep } from 'node:path';
import type { Stats } from 'node:fs';
import type { ChangeDigest, RepoRef } from '@shared/types';

/**
 * Repo-relative directory names we never need to look inside: excluding them keeps the watcher
 * from recursing into large, irrelevant trees (chokidar 5 has no glob support — see the module
 * doc comment below — so pruning has to happen through `ignored`, not through a pattern).
 */
const PRUNE_DIRS = new Set([
  'node_modules', '.git', 'dist', 'out', 'build', 'coverage', '.vite', '.next', '.turbo', '.cache',
]);

/** `path.relative`, normalised to forward slashes so comparisons are OS-independent. */
function relPosix(from: string, to: string): string {
  return relative(from, to).split(sep).join('/');
}

/**
 * Chokidar 5's `ignored` matcher for a single repo: mirrors the three glob patterns from spec
 * 5.3 (`docs/sdlc/**\/state.json`, `docs/sdlc/**\/*.md`, `.workhorse/active`) without glob
 * support. `stats` is undefined on the preliminary, path-only check chokidar makes before
 * stat-ing a newly discovered entry (see `_addToNodeFs` in chokidar's handler) — mirroring
 * chokidar's own v4 upgrade example (`stats?.isFile() && ...`), this returns "not ignored"
 * whenever stats is missing so that check can never veto something the stats-aware check (made
 * moments later, during the readdirp directory/file filter) already allowed through.
 */
function makeIgnored(repoPath: string): (entryPath: string, stats?: Stats) => boolean {
  return (entryPath: string, stats?: Stats): boolean => {
    const rel = relPosix(repoPath, entryPath);
    if (rel === '' || rel.startsWith('..')) return false; // repo root itself, or outside it

    if (stats?.isDirectory()) return PRUNE_DIRS.has(basename(rel));
    if (!stats) return false; // lenient: let the stats-aware pass decide

    if (rel === '.workhorse/active') return false;
    if (rel.startsWith('docs/sdlc/')) {
      return !(basename(rel) === 'state.json' || rel.endsWith('.md'));
    }
    return true;
  };
}

export interface DigestEvent {
  repoId: string;
  digests: ChangeDigest[];
}

export interface WatcherOptions {
  /** Runs `wh.js digest` for one repo; injected so tests can stub it. */
  digest: (repoPath: string) => Promise<ChangeDigest[]>;
  /** Per-repo debounce window after a burst of matching fs events. Default 250. */
  debounceMs?: number;
}

export interface Watcher {
  watch(repo: RepoRef): void;
  unwatch(repoId: string): void;
  on(cb: (e: DigestEvent) => void): () => void;
  close(): Promise<void>;
}

/**
 * Watches `docs/sdlc/**\/state.json`, `docs/sdlc/**\/*.md` and `.workhorse/active` under each
 * registered repo and emits a fresh digest after each burst of matching changes settles.
 *
 * Phase/gate state in Paddock is never read off the live agent stream (spec 5.3) — it comes only
 * from here, so the orb stays correct even for runs started from a terminal outside Paddock.
 */
export function createWatcher(opts: WatcherOptions): Watcher {
  const debounceMs = opts.debounceMs ?? 250;
  const watchers = new Map<string, FSWatcher>();
  const timers = new Map<string, ReturnType<typeof setTimeout>>();
  const listeners = new Set<(e: DigestEvent) => void>();

  function schedule(repoId: string, repoPath: string): void {
    const existing = timers.get(repoId);
    if (existing) clearTimeout(existing);
    timers.set(
      repoId,
      setTimeout(() => {
        timers.delete(repoId);
        void opts.digest(repoPath).then((digests) => {
          // The repo may have been unwatched while `digest` was in flight; drop the result.
          if (!watchers.has(repoId)) return;
          for (const cb of listeners) cb({ repoId, digests });
        });
      }, debounceMs),
    );
  }

  return {
    watch(repo: RepoRef): void {
      if (watchers.has(repo.id)) return;
      const fsw = chokidarWatch(repo.path, {
        ignoreInitial: false,
        awaitWriteFinish: { stabilityThreshold: 150 },
        ignored: makeIgnored(repo.path),
      });
      // Only react to file-level events. `ignored` already scopes directory traversal to the
      // repo tree that could contain a match, but a plain directory appearing or disappearing
      // under docs/sdlc (as opposed to a state.json/*.md file inside it) is not itself one of
      // the three watched patterns and must not trigger a digest on its own.
      fsw.on('all', (event) => {
        if (event === 'addDir' || event === 'unlinkDir') return;
        schedule(repo.id, repo.path);
      });
      watchers.set(repo.id, fsw);
    },

    unwatch(repoId: string): void {
      const fsw = watchers.get(repoId);
      if (!fsw) return;
      watchers.delete(repoId);
      const timer = timers.get(repoId);
      if (timer) {
        clearTimeout(timer);
        timers.delete(repoId);
      }
      void fsw.close();
    },

    on(cb: (e: DigestEvent) => void): () => void {
      listeners.add(cb);
      return () => listeners.delete(cb);
    },

    close(): Promise<void> {
      const closing = [...watchers.values()].map((fsw) => fsw.close());
      watchers.clear();
      for (const timer of timers.values()) clearTimeout(timer);
      timers.clear();
      listeners.clear();
      return Promise.all(closing).then(() => undefined);
    },
  };
}
