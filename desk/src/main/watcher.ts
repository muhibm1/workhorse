import { watch as chokidarWatch, type FSWatcher } from 'chokidar';
import { basename, isAbsolute, join, relative, resolve, sep } from 'node:path';
import { existsSync, mkdirSync, readFileSync, statSync, type Stats } from 'node:fs';
import type { ChangeDigest, RepoRef } from '@shared/types';

/**
 * Repo-relative directory names we never need to look inside: excluding them keeps the watcher
 * from recursing into large, irrelevant trees (chokidar 5 has no glob support — see the module
 * doc comment below — so pruning has to happen through `ignored`, not through a pattern).
 * `.git` stays pruned here: the one part of it that matters, the control state, is watched as a
 * separate explicit path.
 */
const PRUNE_DIRS = new Set([
  'node_modules', '.git', 'dist', 'out', 'build', 'coverage', '.vite', '.next', '.turbo', '.cache',
]);

/** `path.relative`, normalised to forward slashes so comparisons are OS-independent. */
function relPosix(from: string, to: string): string {
  return relative(from, to).split(sep).join('/');
}

/** True when `rel` (from `relPosix`) points inside its base rather than above or across drives. */
function isInside(rel: string): boolean {
  return rel === '' || (!rel.startsWith('..') && !isAbsolute(rel));
}

/**
 * Where WorkHorse keeps its control state (the active change and each change's state.json):
 * `<git common dir>/workhorse`, shared by every worktree and never rewritten by a checkout.
 * Mirrors `gitCommonDir`/`stateRoot` in the plugin's `hooks/scripts/lib.js`, reading `.git` from
 * disk rather than spawning git. A folder with no `.git` falls back to `.workhorse/state`.
 */
export function resolveStateRoot(repoPath: string): string {
  const dotgit = join(repoPath, '.git');
  try {
    if (statSync(dotgit).isDirectory()) return join(dotgit, 'workhorse');
    // A worktree's .git is a file: "gitdir: <main>/.git/worktrees/<name>", which holds commondir.
    const m = /^gitdir:\s*(.+)$/m.exec(readFileSync(dotgit, 'utf8'));
    if (m) {
      const gitdir = resolve(repoPath, m[1].trim());
      const cf = join(gitdir, 'commondir');
      const common = existsSync(cf) ? resolve(gitdir, readFileSync(cf, 'utf8').trim()) : gitdir;
      return join(common, 'workhorse');
    }
  } catch {
    // not a git repository
  }
  return join(repoPath, '.workhorse', 'state');
}

/**
 * Chokidar 5's `ignored` matcher for one repo, covering two roots without glob support:
 *
 * - under `stateRoot`: only `active` and `changes/<id>/state.json` count;
 * - under the repo: `docs/sdlc/**` state.json and markdown, plus the legacy `.workhorse/active`.
 *
 * `stats` is undefined on the preliminary, path-only check chokidar makes before stat-ing a newly
 * discovered entry (see `_addToNodeFs` in chokidar's handler). Mirroring chokidar's own v4 upgrade
 * example, this returns "not ignored" whenever stats is missing, so that check can never veto
 * something the stats-aware check made moments later already allowed through.
 */
function makeIgnored(repoPath: string, stateRoot: string): (entryPath: string, stats?: Stats) => boolean {
  return (entryPath: string, stats?: Stats): boolean => {
    const sRel = relPosix(stateRoot, entryPath);
    if (isInside(sRel)) {
      if (!stats || stats.isDirectory()) return false;
      return !(sRel === 'active' || basename(sRel) === 'state.json');
    }

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
 * Watches each registered repo's control state (`<git common dir>/workhorse`: the active change
 * and each state.json) and its artifacts (`docs/sdlc/**` markdown), and emits a fresh digest after
 * each burst of matching changes settles.
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
      const stateRoot = resolveStateRoot(repo.path);
      // Create it up front so chokidar has a real directory to watch before the first run writes.
      try {
        mkdirSync(stateRoot, { recursive: true });
      } catch {
        // unwritable (e.g. a read-only checkout): the repo tree is still watched
      }
      const fsw = chokidarWatch([repo.path, stateRoot], {
        ignoreInitial: false,
        awaitWriteFinish: { stabilityThreshold: 150 },
        ignored: makeIgnored(repo.path, stateRoot),
      });
      // Only react to file-level events: a directory appearing or disappearing is not itself one
      // of the watched files and must not trigger a digest on its own.
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
