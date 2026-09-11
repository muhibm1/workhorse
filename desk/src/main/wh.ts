import { spawn } from 'node:child_process';
import { join } from 'node:path';
import type { ChangeDigest } from '@shared/types';

export interface WhResult { code: number; stdout: string; stderr: string }

/**
 * Runs `node <pluginPath>/scripts/wh.js <args>` in `repoPath`. Always an argument array, never a
 * shell string, so `notes` text with quotes or shell metacharacters can never escape into a
 * command. A spawn failure (e.g. missing `node`) resolves rather than rejects, with `code: 1`
 * and the error message on `stderr`, so callers only ever branch on `code`.
 */
export function runWh(pluginPath: string, repoPath: string, args: string[]): Promise<WhResult> {
  return new Promise((resolve) => {
    const script = join(pluginPath, 'scripts', 'wh.js');
    let child: ReturnType<typeof spawn>;
    try {
      child = spawn('node', [script, ...args], {
        cwd: repoPath,
        shell: false,
        windowsHide: true,
        stdio: ['ignore', 'pipe', 'pipe'],
      });
    } catch (err) {
      resolve({ code: 1, stdout: '', stderr: String(err) });
      return;
    }
    let stdout = '';
    let stderr = '';
    child.stdout?.on('data', (d) => { stdout += d.toString(); });
    child.stderr?.on('data', (d) => { stderr += d.toString(); });
    child.on('error', (err) => {
      resolve({ code: 1, stdout, stderr: stderr + String(err) });
    });
    child.on('close', (code) => {
      resolve({ code: code ?? 1, stdout, stderr });
    });
  });
}

/** Runs `wh.js digest --json --all` and parses the result. Any failure yields an empty array. */
export async function digest(pluginPath: string, repoPath: string): Promise<ChangeDigest[]> {
  const result = await runWh(pluginPath, repoPath, ['digest', '--json', '--all']);
  if (result.code !== 0) return [];
  try {
    const parsed = JSON.parse(result.stdout);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}
