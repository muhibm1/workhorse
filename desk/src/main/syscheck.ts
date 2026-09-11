import { spawn } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { SysCheck } from '@shared/types';

interface BinaryCheck { ok: boolean; version: string | null; path: string | null }

/**
 * Spawns one candidate binary with `--version` and reports whether it ran and what it printed.
 * Always `shell: false` — never a shell string. Distinguishes "binary not found" (ENOENT) from
 * "binary found but exited non-zero", since only the former should fall through to the next
 * candidate.
 */
function tryVersion(bin: string): Promise<BinaryCheck & { enoent: boolean }> {
  return new Promise((resolve) => {
    let settled = false;
    let child: ReturnType<typeof spawn>;
    try {
      child = spawn(bin, ['--version'], { shell: false, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
    } catch {
      resolve({ ok: false, version: null, path: null, enoent: true });
      return;
    }
    let out = '';
    child.stdout?.on('data', (d) => { out += d.toString(); });
    child.stderr?.on('data', (d) => { out += d.toString(); });
    child.on('error', (err: NodeJS.ErrnoException) => {
      if (settled) return;
      settled = true;
      resolve({ ok: false, version: null, path: null, enoent: err.code === 'ENOENT' });
    });
    child.on('close', (code) => {
      if (settled) return;
      settled = true;
      if (code === 0) resolve({ ok: true, version: out.trim() || null, path: bin, enoent: false });
      else resolve({ ok: false, version: null, path: null, enoent: false });
    });
  });
}

/** Tries each candidate in order, moving to the next only when the previous one was not found. */
async function checkBinary(candidates: string[]): Promise<BinaryCheck> {
  for (const bin of candidates) {
    const result = await tryVersion(bin);
    if (result.ok || !result.enoent) return result;
  }
  return { ok: false, version: null, path: null };
}

function readPluginInfo(pluginPath: string): SysCheck['plugin'] {
  const versionFile = join(pluginPath, 'VERSION');
  const manifestFile = join(pluginPath, '.claude-plugin', 'plugin.json');
  let version: string | null = null;
  if (existsSync(versionFile)) {
    const raw = readFileSync(versionFile, 'utf8').trim();
    version = raw || null;
  } else if (existsSync(manifestFile)) {
    try {
      const manifest = JSON.parse(readFileSync(manifestFile, 'utf8'));
      version = typeof manifest.version === 'string' ? manifest.version : null;
    } catch {
      version = null;
    }
  }
  return { path: pluginPath, version, bundled: version !== null };
}

/** node and claude on PATH, plus the resolved plugin's declared version. Never throws. */
export async function syscheck(pluginPath: string): Promise<SysCheck> {
  const node = await checkBinary(['node']);
  const claudeCandidates = process.platform === 'win32' ? ['claude.cmd', 'claude'] : ['claude'];
  const claude = await checkBinary(claudeCandidates);
  return { node, claude, plugin: readPluginInfo(pluginPath) };
}
