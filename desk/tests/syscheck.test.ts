import { describe, it, expect, beforeEach } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { syscheck } from '../src/main/syscheck';

describe('syscheck', () => {
  let pluginDir: string;

  beforeEach(() => {
    pluginDir = mkdtempSync(join(tmpdir(), 'paddock-plugin-'));
  });

  it('reports node ok on this machine', async () => {
    const result = await syscheck(pluginDir);
    expect(result.node.ok).toBe(true);
    expect(result.node.version).toMatch(/^v?\d+\.\d+\.\d+/);
    // claude may or may not be installed on the machine running the suite; only the shape is guaranteed.
    expect(typeof result.claude.ok).toBe('boolean');
  }, 20000);

  it('reads the bundled plugin version from a VERSION file', async () => {
    writeFileSync(join(pluginDir, 'VERSION'), '0.2.0\n');
    const result = await syscheck(pluginDir);
    expect(result.plugin).toEqual({ path: pluginDir, version: '0.2.0', bundled: true });
  }, 20000);

  it('falls back to .claude-plugin/plugin.json when there is no VERSION file', async () => {
    mkdirSync(join(pluginDir, '.claude-plugin'), { recursive: true });
    writeFileSync(join(pluginDir, '.claude-plugin', 'plugin.json'), JSON.stringify({ version: '9.9.9' }));
    const result = await syscheck(pluginDir);
    expect(result.plugin).toEqual({ path: pluginDir, version: '9.9.9', bundled: true });
  }, 20000);

  it('reports the plugin as not bundled when neither file is present', async () => {
    const result = await syscheck(pluginDir);
    expect(result.plugin).toEqual({ path: pluginDir, version: null, bundled: false });
  }, 20000);
});
