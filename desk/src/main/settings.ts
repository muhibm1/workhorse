import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { Settings } from '@shared/types';

const DEFAULTS: Settings = { backend: 'cli', pluginPath: null, allowedTools: {}, theme: 'dark' };

/**
 * Shaped like Electron's `safeStorage`, but under names that don't tie this module to Electron:
 * main wires the real `safeStorage.encryptString`/`decryptString` in; tests pass a fake that
 * base64-encodes, since `safeStorage` needs a running app and isn't available in vitest.
 */
export interface CryptoLike {
  encrypt(plaintext: string): Buffer;
  decrypt(ciphertext: Buffer): string;
  available(): boolean;
}

/**
 * Settings persisted at `<dir>/settings.json`, with the API key kept out of that file entirely:
 * it lives encrypted at `<dir>/settings.key.bin` and is decrypted only by `readApiKey`, which is
 * for main-process callers (the run drivers) — it is never exposed over IPC.
 */
/**
 * Tool identifiers a run may be granted. The renderer can pick from this list but cannot invent
 * entries, so a compromised renderer cannot widen a run to `Bash(*)` by writing settings and
 * then starting a run. Extend this deliberately, never from user input.
 */
export const ALLOWED_TOOL_CATALOG: readonly string[] = [
  'Agent', 'Read', 'Glob', 'Grep', 'Edit', 'Write', 'NotebookEdit', 'TodoWrite', 'WebFetch', 'WebSearch',
  'Bash(node *)', 'Bash(npm *)', 'Bash(npx *)', 'Bash(git *)', 'Bash(gh *)',
  'Bash(pnpm *)', 'Bash(yarn *)', 'Bash(python *)', 'Bash(pytest *)', 'Bash(cargo *)', 'Bash(go *)',
  'Bash(make *)', 'Bash(ruff *)', 'Bash(mypy *)', 'Bash(tsc *)', 'Bash(vitest *)', 'Bash(jest *)',
];

/**
 * Only these keys may be written, and only with values of the right shape. Everything else in the
 * patch is dropped rather than merged: `set` is reachable from the renderer over IPC, and without
 * this an attacker-controlled patch could point `pluginPath` at an arbitrary directory (which the
 * run drivers pass to `--plugin-dir`, loading its hooks) or grant a run unrestricted shell.
 */
function sanitisePatch(patch: unknown): Partial<Settings> {
  const clean: Partial<Settings> = {};
  if (!patch || typeof patch !== 'object') return clean;
  const p = patch as Record<string, unknown>;

  if (p.backend === 'cli' || p.backend === 'sdk') clean.backend = p.backend;
  if (p.theme === 'dark') clean.theme = p.theme;
  if (p.pluginPath === null || typeof p.pluginPath === 'string') {
    clean.pluginPath = p.pluginPath as string | null;
  }
  if (p.allowedTools && typeof p.allowedTools === 'object' && !Array.isArray(p.allowedTools)) {
    const tools: Record<string, string[]> = {};
    for (const [repoId, list] of Object.entries(p.allowedTools as Record<string, unknown>)) {
      if (!Array.isArray(list)) continue;
      tools[repoId] = list.filter(
        (t): t is string => typeof t === 'string' && ALLOWED_TOOL_CATALOG.includes(t),
      );
    }
    clean.allowedTools = tools;
  }
  return clean;
}

export function createSettings(dir: string, crypto: CryptoLike) {
  const settingsFile = join(dir, 'settings.json');
  const keyFile = join(dir, 'settings.key.bin');

  function ensureDir(): void {
    mkdirSync(dir, { recursive: true });
  }

  function readSettings(): Settings {
    if (!existsSync(settingsFile)) return { ...DEFAULTS };
    try {
      const parsed = JSON.parse(readFileSync(settingsFile, 'utf8'));
      return { ...DEFAULTS, ...parsed };
    } catch {
      return { ...DEFAULTS };
    }
  }

  function writeSettings(next: Settings): void {
    ensureDir();
    writeFileSync(settingsFile, JSON.stringify(next, null, 2));
  }

  return {
    get(): Settings {
      return readSettings();
    },

    set(patch: Partial<Settings>): Settings {
      const next = { ...readSettings(), ...sanitisePatch(patch) };
      writeSettings(next);
      return next;
    },

    setApiKey(key: string): void {
      ensureDir();
      writeFileSync(keyFile, crypto.encrypt(key));
    },

    hasApiKey(): boolean {
      return existsSync(keyFile);
    },

    clearApiKey(): void {
      if (existsSync(keyFile)) rmSync(keyFile);
    },

    /** Main-only: decrypts the stored key. Never call this from an IPC handler's return value. */
    readApiKey(): string | null {
      if (!existsSync(keyFile)) return null;
      try {
        return crypto.decrypt(readFileSync(keyFile));
      } catch {
        return null;
      }
    },
  };
}
