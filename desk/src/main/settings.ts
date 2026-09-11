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
      const next = { ...readSettings(), ...patch };
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
