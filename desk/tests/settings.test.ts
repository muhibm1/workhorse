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
    expect(settings.get()).toEqual({ backend: 'cli', pluginPath: null, allowedTools: {}, theme: 'dark', notifyUrl: null });
    expect(settings.hasApiKey()).toBe(false);
  });

  it('persists a patch and re-reads it', () => {
    const settings = createSettings(dir, fakeCrypto());
    const after = settings.set({ backend: 'sdk', pluginPath: '/custom/plugin', allowedTools: { r1: ['Read'] } });
    expect(after).toEqual({ backend: 'sdk', pluginPath: '/custom/plugin', allowedTools: { r1: ['Read'] }, theme: 'dark', notifyUrl: null });

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

describe('settings.set patch validation (security review finding)', () => {
  let dir: string;
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'paddock-settings-patch-'));
  });

  it('drops tools that are not in the catalog, keeping the valid ones', () => {
    const s = createSettings(dir, fakeCrypto());
    const out = s.set({ allowedTools: { r1: ['Read', 'Bash(*)', 'Bash(curl evil.example)', 'Bash(npm *)'] } });
    expect(out.allowedTools.r1).toEqual(['Read', 'Bash(npm *)']);
  });

  it('ignores keys that are not settable and values of the wrong shape', () => {
    const s = createSettings(dir, fakeCrypto());
    const out = s.set({ theme: 'light', backend: 'telnet' } as never);
    expect(out.theme).toBe('dark');
    expect(out.backend).toBe('cli');
  });

  it('still accepts the legitimate values the Settings screen sends', () => {
    const s = createSettings(dir, fakeCrypto());
    const out = s.set({ backend: 'sdk', pluginPath: 'C:\plugins\workhorse' });
    expect(out.backend).toBe('sdk');
    expect(out.pluginPath).toBe('C:\plugins\workhorse');
  });

  it('survives a non-object patch without throwing', () => {
    const s = createSettings(dir, fakeCrypto());
    expect(s.set(null as never).backend).toBe('cli');
  });
});

describe('notifyUrl validation', () => {
  let dir: string;
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'paddock-settings-'));
  });

  it('accepts https anywhere and http only to loopback', () => {
    const settings = createSettings(dir, fakeCrypto());
    expect(settings.set({ notifyUrl: 'https://ntfy.sh/my-topic' }).notifyUrl).toBe('https://ntfy.sh/my-topic');
    expect(settings.set({ notifyUrl: 'http://localhost:8080/t' }).notifyUrl).toBe('http://localhost:8080/t');
    expect(settings.set({ notifyUrl: 'http://127.0.0.1/t' }).notifyUrl).toBe('http://127.0.0.1/t');
  });

  it('rejects cleartext to a real host, other schemes, and garbage, keeping the previous value', () => {
    const settings = createSettings(dir, fakeCrypto());
    settings.set({ notifyUrl: 'https://ntfy.sh/keep' });
    for (const bad of ['http://evil.example/t', 'ftp://x/t', 'javascript:alert(1)', 'not a url', 'x'.repeat(3000)]) {
      expect(settings.set({ notifyUrl: bad }).notifyUrl).toBe('https://ntfy.sh/keep');
    }
  });

  it('null and empty string turn notifications off', () => {
    const settings = createSettings(dir, fakeCrypto());
    settings.set({ notifyUrl: 'https://ntfy.sh/t' });
    expect(settings.set({ notifyUrl: null }).notifyUrl).toBeNull();
    settings.set({ notifyUrl: 'https://ntfy.sh/t' });
    expect(settings.set({ notifyUrl: '  ' as unknown as string }).notifyUrl).toBeNull();
  });
});
