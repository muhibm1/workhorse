import { describe, it, expect, beforeEach } from 'vitest';
import { mkdtempSync, existsSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createSettings, type CryptoLike } from '../src/main/settings';

/**
 * Electron's `safeStorage` needs a running app, so it can't be exercised in vitest. This fake
 * matches `CryptoLike` and base64-encodes, which is enough to prove settings.ts never writes the
 * plaintext key anywhere and round-trips whatever the real implementation would produce.
 */
function fakeCrypto(): CryptoLike {
  return {
    encrypt(plaintext: string): Buffer {
      return Buffer.from(Buffer.from(plaintext, 'utf8').toString('base64'), 'utf8');
    },
    decrypt(ciphertext: Buffer): string {
      return Buffer.from(ciphertext.toString('utf8'), 'base64').toString('utf8');
    },
    available(): boolean {
      return true;
    },
  };
}

describe('settings', () => {
  let dir: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'paddock-settings-'));
  });

  it('returns defaults when nothing is stored', () => {
    const settings = createSettings(dir, fakeCrypto());
    expect(settings.get()).toEqual({ backend: 'cli', pluginPath: null, allowedTools: {}, theme: 'dark' });
    expect(settings.hasApiKey()).toBe(false);
  });

  it('persists a patch and re-reads it', () => {
    const settings = createSettings(dir, fakeCrypto());
    const after = settings.set({ backend: 'sdk', pluginPath: '/custom/plugin', allowedTools: { r1: ['Read'] } });
    expect(after).toEqual({ backend: 'sdk', pluginPath: '/custom/plugin', allowedTools: { r1: ['Read'] }, theme: 'dark' });

    const reopened = createSettings(dir, fakeCrypto());
    expect(reopened.get()).toEqual(after);
  });

  it('stores the api key encrypted and never in settings.json', () => {
    const settings = createSettings(dir, fakeCrypto());
    settings.set({ backend: 'sdk' });
    settings.setApiKey('sk-test-12345');

    expect(existsSync(join(dir, 'settings.json'))).toBe(true);
    expect(readFileSync(join(dir, 'settings.json'), 'utf8')).not.toContain('sk-test');

    const keyFileContent = readFileSync(join(dir, 'settings.key.bin'), 'utf8');
    expect(keyFileContent).not.toContain('sk-test');
    expect(keyFileContent).toBe(Buffer.from('sk-test-12345', 'utf8').toString('base64'));

    expect(settings.hasApiKey()).toBe(true);
    expect(settings.readApiKey()).toBe('sk-test-12345');
  });

  it('hasApiKey false after clear', () => {
    const settings = createSettings(dir, fakeCrypto());
    settings.setApiKey('sk-test-12345');
    expect(settings.hasApiKey()).toBe(true);

    settings.clearApiKey();
    expect(settings.hasApiKey()).toBe(false);
    expect(settings.readApiKey()).toBeNull();
    // clearing twice is a no-op, not an error
    expect(() => settings.clearApiKey()).not.toThrow();
  });
});
