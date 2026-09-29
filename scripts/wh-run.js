'use strict';
// The mechanical parts of a run, moved out of the conductor's context in 0.3.12: running the
// profile's checks, folding a wave's task branches, the run lock, notifications, and the
// per-agent clock. Measured on the studbook MCP-server run (2026-09-26): the conductor spent
// 137 of 250 agent-minutes folding, re-probing and deciding, and the verifier 57 minutes on a
// test suite that runs in 45 seconds. A script does both in seconds, so the agents that remain
// only judge. Zero dependencies, CommonJS, like the rest of the plugin.
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const CHECK_ORDER = ['install', 'typecheck', 'lint', 'test', 'build', 'e2e', 'security_audit', 'screenshot'];
const VERIFY_START = '<!-- wh:verify-start -->';
const VERIFY_END = '<!-- wh:verify-end -->';
const LOCK_STALE_MINUTES = 30;
const GAP_MINUTES = 90;

// ---------- shell ----------

/** The shell the profile's commands are written for. Profile commands are shell lines by
 *  nature (`env -u X ... | tail -1`), so this is the one place a command string is handed to a
 *  shell; everything else in the plugin spawns argument arrays. On Windows they are written for
 *  Git Bash, which is what the harness's own Bash tool runs them in. */
function shellFor() {
  if (process.platform !== 'win32') return { bin: '/bin/bash', pre: ['-c'] };
  const candidates = [
    process.env.CLAUDE_CODE_GIT_BASH_PATH,
    'C:\\Program Files\\Git\\bin\\bash.exe',
    'C:\\Program Files\\Git\\usr\\bin\\bash.exe',
    path.join(process.env.LOCALAPPDATA || '', 'Programs', 'Git', 'bin', 'bash.exe'),
  ].filter(Boolean);
  for (const c of candidates) if (fs.existsSync(c)) return { bin: c, pre: ['-c'] };
  const where = spawnSync('where', ['bash'], { encoding: 'utf8' });
  const found = where.status === 0 ? where.stdout.split(/\r?\n/).map((s) => s.trim()).find((s) => /bash\.exe$/i.test(s) && !/System32/i.test(s)) : null;
  if (found) return { bin: found, pre: ['-c'] };
  return { bin: 'cmd.exe', pre: ['/d', '/s', '/c'] };
}

function runShell(root, command, timeoutMs) {
  const sh = shellFor();
  const t0 = Date.now();
  const r = spawnSync(sh.bin, [...sh.pre, command], {
    cwd: root, encoding: 'utf8', timeout: timeoutMs, maxBuffer: 64 * 1024 * 1024,
    env: { ...process.env, CI: process.env.CI || '1', NO_COLOR: '1', FORCE_COLOR: '0' },
  });
  const timedOut = Boolean(r.error && r.error.code === 'ETIMEDOUT');
  return {
    status: timedOut ? 'timeout' : (r.status === null ? (r.signal || 'killed') : r.status),
    output: (r.stdout || '') + (r.stderr ? (r.stdout ? '\n' : '') + r.stderr : '') + (r.error && !timedOut ? `\n${r.error.message}` : ''),
    seconds: Math.round((Date.now() - t0) / 100) / 10,
    shell: sh.bin,
  };
}

// ---------- measuring a check from its output ----------

/** One plain sentence with the numbers a person would ask about later, read from the output.
 *  Recognises unittest, pytest, vitest and jest, eslint, ruff, tsc, npm audit and pip-audit;
 *  anything else reports the exit code, which is still a measurement. */
function measure(check, command, out, status) {
  const cmd = '`' + command + '`';
  let m;
  if ((m = /Ran (\d+) tests? in [\d.]+s\s*\n\s*(OK|FAILED)(?: \(([^)]*)\))?/.exec(out))) {
    return `Test suite: ${m[1]} tests, ${m[2] === 'OK' ? 'all passed' : 'FAILED'}${m[3] ? ` (${m[3]})` : ''} (${cmd}).`;
  }
  if ((m = /(\d+) passed(?:, (\d+) failed)?(?:, (\d+) skipped)?/.exec(out)) && /pytest|passed/.test(out)) {
    if (/Tests\s+\d+ passed/.test(out)) {
      const v = /Tests\s+(\d+) passed(?: \| (\d+) failed)?(?: \| (\d+) skipped)?/.exec(out);
      if (v) return `Test suite: ${v[1]} passed, ${v[2] || 0} failed, ${v[3] || 0} skipped (${cmd}).`;
    }
    return `Test suite: ${m[1]} passed, ${m[2] || 0} failed, ${m[3] || 0} skipped (${cmd}).`;
  }
  if ((m = /Tests:\s+(?:(\d+) failed, )?(?:(\d+) skipped, )?(\d+) passed, (\d+) total/.exec(out))) {
    return `Test suite: ${m[3]} passed, ${m[1] || 0} failed, ${m[2] || 0} skipped of ${m[4]} (${cmd}).`;
  }
  if ((m = /(\d+) problems? \((\d+) errors?, (\d+) warnings?\)/.exec(out))) return `Lint: ${m[2]} errors, ${m[3]} warnings (${cmd}).`;
  if (/All checks passed!/.test(out)) return `Lint: 0 errors (${cmd}).`;
  if ((m = /Found (\d+) errors?/.exec(out))) return `${check === 'typecheck' ? 'Type check' : 'Lint'}: ${m[1]} errors (${cmd}).`;
  if ((m = /found (\d+) vulnerabilit/.exec(out))) return `Dependency audit: ${m[1]} vulnerabilities (${cmd}).`;
  if (/No known vulnerabilities found/.test(out)) return `Dependency audit: 0 known vulnerabilities (${cmd}).`;
  if ((m = /Found (\d+) known vulnerabilit/.exec(out))) return `Dependency audit: ${m[1]} known vulnerabilities (${cmd}).`;
  if (check === 'typecheck' && status === 0) return `Type check: 0 errors (${cmd}).`;
  if (check === 'lint' && status === 0) return `Lint: 0 errors (${cmd}).`;
  if (check === 'build' && status === 0) return `Build: succeeded (${cmd}).`;
  return `${check}: exit ${status} (${cmd}).`;
}

// ---------- verify ----------

/**
 * Run the profile's checks and write their evidence. Returns the rows and whether every defined
 * check passed. `opts.only` limits the pass to named checks (the others keep their last row);
 * `opts.install` includes the install command, which is slow and rarely needed.
 */
function verify(L, root, id, state, opts) {
  const profile = L.loadProfile(root);
  const cmds = profile.commands || {};
  const dir = L.changeDir(root, id);
  const logs = path.join(dir, 'verify-logs');
  fs.mkdirSync(logs, { recursive: true });
  const summaryFile = path.join(logs, 'summary.json');
  const previous = fs.existsSync(summaryFile) ? JSON.parse(fs.readFileSync(summaryFile, 'utf8')) : null;
  const known = L.loadKnownFailures(root);
  const only = opts.only ? opts.only.split(',').map((s) => s.trim()).filter(Boolean) : null;
  const timeoutMs = (opts.timeoutMinutes || 10) * 60000;
  const rows = [];
  for (const check of CHECK_ORDER) {
    const command = cmds[check];
    if (!command) { rows.push({ check, status: 'no check defined' }); continue; }
    const wanted = only ? only.includes(check) : (check !== 'install' || opts.install);
    if (!wanted) {
      const prev = previous && previous.checks.find((r) => r.check === check && r.exit !== undefined);
      // install is skipped on purpose (slow, and in some repos destructive: it replaces a
      // node_modules junction); a skipped install is never a failure. Every other check that
      // has not run yet counts against green, so --only narrows the work, never the bar.
      const status = prev ? `${prev.status} (previous pass)` : (check === 'install' ? 'skipped (runs with --install)' : 'not run this pass');
      rows.push(prev ? { ...prev, status } : { check, command, status });
      continue;
    }
    // A recorded known failure is cited, never re-run: it was reproduced on the base branch when
    // it was recorded, and re-running it costs time and can have side effects (a failed Playwright
    // run writes a report that the next lint pass then chokes on, 2026-09-29).
    const recorded = known.find((k) => k.check === check);
    if (recorded) {
      rows.push({
        check, command, exit: 'known', seconds: 0, log: 'verify-logs/known-failures',
        status: `known failure (base ${recorded.base}), cited not re-run`,
        measured: `${check}: known failure, cited from .workhorse/known-failures.md (base ${recorded.base}: ${recorded.reason}).`,
        first_error: null,
      });
      continue;
    }
    const r = runShell(root, command, check === 'e2e' ? timeoutMs * 3 : timeoutMs);
    const logRel = `verify-logs/${check}.log`;
    fs.writeFileSync(path.join(dir, logRel), `$ ${command}\n# exit ${r.status} after ${r.seconds}s via ${r.shell}\n\n${r.output}`);
    const kf = r.status !== 0 ? known.find((k) => k.check === check) : null;
    rows.push({
      check, command, exit: r.status, seconds: r.seconds, log: logRel,
      status: r.status === 0 ? 'passed' : kf ? `known failure (base ${kf.base})` : 'failed',
      measured: measure(check, command, r.output, r.status),
      first_error: r.status === 0 ? null : firstErrorLine(r.output),
    });
  }
  // A check that failed in an earlier pass and was not re-run still fails the change, and a
  // defined check that has never run cannot count as passed: `--only` narrows the work, never
  // the bar.
  const defined = rows.filter((r) => r.exit !== undefined || r.status === 'not run this pass');
  const failed = defined.filter((r) => r.status.startsWith('failed') || r.status === 'not run this pass');
  const checksGreen = defined.length > 0 && failed.length === 0;
  const summary = {
    commit: L.git(root, ['rev-parse', 'HEAD']) || '', at: L.nowIso(), branch: L.git(root, ['branch', '--show-current']) || '',
    checks_green: checksGreen, defined: defined.length, failed: failed.map((r) => r.check), checks: rows,
  };
  fs.writeFileSync(summaryFile, JSON.stringify(summary, null, 2) + '\n');
  writeVerificationMd(L, root, id, state, rows, summary, opts);
  return summary;
}

function firstErrorLine(out) {
  const lines = out.split(/\r?\n/);
  const hit = lines.find((l) => /\b(error|FAIL|failed|Error:|AssertionError|Traceback)\b/i.test(l) && !/0 (errors|failed)/.test(l));
  return (hit || lines.filter(Boolean).slice(-1)[0] || '').trim().slice(0, 200);
}

function checksTable(rows) {
  const head = ['| Check | Command | Exit code | Output | Status |', '|-------|---------|-----------|--------|--------|'];
  const cell = (s) => String(s === undefined || s === null ? '' : s).replace(/\|/g, '\\|');
  return head.concat(rows.map((r) => (r.exit === undefined
    ? `| ${r.check} | ${cell(r.command || '')} | | | ${r.status} |`
    : `| ${r.check} | \`${cell(r.command)}\` | ${r.exit} | \`${r.log}\` | ${r.status === 'passed' ? 'confirmed' : r.status} |`))).join('\n');
}

/** Rewrite the Checks table and the measured block in verification.md, creating the file from
 *  the template when it does not exist. The verifier agent owns everything else in the file
 *  (evals, comparison prose, known-failure citations, notes) and the final Status line; this
 *  writes red when a check failed, and `partial` (checks green, evals not yet run) otherwise,
 *  unless the caller says the evals are covered (`opts.final`). */
function writeVerificationMd(L, root, id, state, rows, summary, opts) {
  const file = path.join(L.changeDir(root, id), 'verification.md');
  let md;
  if (fs.existsSync(file)) md = fs.readFileSync(file, 'utf8');
  else {
    md = opts.template
      .replace(/\{\{title\}\}/g, state.title || id).replace(/\{\{change_id\}\}/g, id)
      .replace(/\{\{timestamp\}\}/g, summary.at).replace(/\{\{commit\}\}/g, summary.commit.slice(0, 12));
    // The template's example sentences would otherwise read as measurements.
    md = md.replace(/## What was measured\n[\s\S]*?(?=\n## Checks)/, '## What was measured\n\n');
  }
  const status = summary.checks_green ? (opts.final ? 'green' : 'partial') : 'red';
  md = md.replace(/^Status:.*$/m, `Status: ${status}${status === 'partial' ? ' (checks green; evals not yet run)' : ''}`);
  md = md.replace(/^Run at:.*$/m, `Run at: ${summary.at} UTC`).replace(/^Commit:.*$/m, `Commit: \`${summary.commit.slice(0, 12)}\``);
  const measuredBlock = [VERIFY_START, '<!-- written by `wh.js verify`; edit outside the markers -->']
    .concat(rows.filter((r) => r.measured).map((r) => `- ${r.measured}${r.status.startsWith('known failure') ? ` Known failure, ${r.status.replace('known failure ', '')}.` : ''}`))
    .concat([VERIFY_END]).join('\n');
  if (md.includes(VERIFY_START)) md = md.replace(new RegExp(`${VERIFY_START}[\\s\\S]*?${VERIFY_END}`), measuredBlock);
  else md = md.replace(/## What was measured\n\n?/, `## What was measured\n\n${measuredBlock}\n\n`);
  const table = checksTable(rows);
  if (/## Checks\n/.test(md)) {
    md = md.replace(/## Checks\n[\s\S]*?(?=\n## |\s*$)/, `## Checks\n\n${table}\n`);
  } else md += `\n## Checks\n\n${table}\n`;
  fs.writeFileSync(file, md);
}

// ---------- fold ----------

function gitRun(root, args) {
  const r = spawnSync('git', args, { cwd: root, encoding: 'utf8' });
  return { status: r.status, out: (r.stdout || '').trim(), err: (r.stderr || '').trim() };
}

/** Fold task branches into the change branch in task order, then remove their worktrees and
 *  branches. `rebase` cherry-picks each task's commits (a linear history the reviewers can
 *  read); `merge` does a no-ff merge per task. A conflict aborts cleanly and reports the task
 *  and the files, so the conductor can hand exactly that to a builder. */
function fold(L, root, id, state, tasks, strategy) {
  const branch = state.branch;
  if (!branch) throw new Error('state.branch is not set');
  if ((L.git(root, ['branch', '--show-current']) || '') !== branch) {
    const co = gitRun(root, ['checkout', '-q', branch]);
    if (co.status !== 0) throw new Error(`cannot check out ${branch}: ${co.err}`);
  }
  const results = [];
  for (const n of tasks) {
    const tb = `${branch}-t${n}`;
    if (!L.git(root, ['rev-parse', '--verify', '--quiet', `refs/heads/${tb}`])) { results.push({ task: n, status: 'no branch', branch: tb }); continue; }
    const shas = (L.git(root, ['rev-list', '--reverse', `${branch}..${tb}`]) || '').split(/\s+/).filter(Boolean);
    if (shas.length) {
      const r = strategy === 'merge'
        ? gitRun(root, ['merge', '--no-ff', '-q', '-m', `chore(build): fold task ${n} (${tb})`, tb])
        : gitRun(root, ['cherry-pick', '--allow-empty', ...shas]);
      if (r.status !== 0) {
        const conflicted = (L.git(root, ['diff', '--name-only', '--diff-filter=U']) || '').split(/\s+/).filter(Boolean);
        gitRun(root, [strategy === 'merge' ? 'merge' : 'cherry-pick', '--abort']);
        return { ok: false, task: n, branch: tb, conflict_files: conflicted, detail: (r.err || r.out).slice(0, 500), folded: results };
      }
    }
    removeWorktreeFor(L, root, tb);
    gitRun(root, ['branch', '-D', tb]);
    results.push({ task: n, status: shas.length ? 'folded' : 'nothing to fold', commits: shas.length, branch: tb });
  }
  return { ok: true, head: L.git(root, ['rev-parse', '--short', 'HEAD']), strategy, folded: results };
}

function removeWorktreeFor(L, root, branch) {
  const list = L.git(root, ['worktree', 'list', '--porcelain']) || '';
  let current = null;
  for (const line of list.split(/\r?\n/)) {
    if (line.startsWith('worktree ')) current = line.slice(9).trim();
    else if (line === `branch refs/heads/${branch}` && current && path.resolve(current) !== path.resolve(root)) {
      gitRun(root, ['worktree', 'remove', '--force', current]);
    }
  }
  gitRun(root, ['worktree', 'prune']);
}

// ---------- run lock ----------

function lockFile(L, root) { return path.join(L.stateRoot(root), 'run.lock'); }

function readLock(L, root) {
  const f = lockFile(L, root);
  if (!fs.existsSync(f)) return null;
  try { return JSON.parse(fs.readFileSync(f, 'utf8')); } catch (e) { return null; }
}

/** One conductor per repository. The lock carries no pid (the conductor is a Claude session,
 *  not a process this script can watch); it is refreshed by every `wh.js log` row and is stale
 *  after LOCK_STALE_MINUTES without one, which is longer than any single agent step. Two live
 *  runs raced on the same task worktree before this existed. */
function lockAcquire(L, root, holder, force) {
  const cur = readLock(L, root);
  const ageMin = cur ? (Date.now() - Date.parse(cur.updated || cur.started)) / 60000 : Infinity;
  if (cur && !force && ageMin < LOCK_STALE_MINUTES) {
    return { ok: false, held_by: cur.holder, since: cur.started, last_activity_minutes_ago: Math.round(ageMin) };
  }
  const lock = {
    holder: holder || 'conductor', started: L.nowIso(), updated: L.nowIso(), host: os.hostname(),
    // The the harness session that took the lock; the Stop hook holds only that session.
    session: process.env.CLAUDE_CODE_SESSION_ID || null,
  };
  fs.mkdirSync(path.dirname(lockFile(L, root)), { recursive: true });
  fs.writeFileSync(lockFile(L, root), JSON.stringify(lock, null, 2) + '\n');
  return { ok: true, lock, replaced_stale: Boolean(cur) };
}

function lockTouch(L, root) {
  const cur = readLock(L, root);
  if (!cur) return;
  cur.updated = L.nowIso();
  fs.writeFileSync(lockFile(L, root), JSON.stringify(cur, null, 2) + '\n');
}

function lockRelease(L, root) {
  const f = lockFile(L, root);
  const had = fs.existsSync(f);
  if (had) fs.unlinkSync(f);
  return { released: had };
}

// ---------- notifications ----------

/** A desktop notification, best effort and never an error: a run that stops at a gate or a
 *  block sat unnoticed for hours before this. Windows uses the WinRT toast API through
 *  PowerShell (no module to install); macOS osascript; Linux notify-send. */
function notify(title, body) {
  const t = String(title).slice(0, 80);
  const b = String(body).slice(0, 240);
  try {
    if (process.platform === 'win32') {
      const esc = (s) => s.replace(/'/g, "''");
      const script = [
        '[Windows.UI.Notifications.ToastNotificationManager, Windows.UI.Notifications, ContentType = WindowsRuntime] | Out-Null',
        '[Windows.Data.Xml.Dom.XmlDocument, Windows.Data.Xml.Dom.XmlDocument, ContentType = WindowsRuntime] | Out-Null',
        `$x = "<toast><visual><binding template='ToastGeneric'><text>${esc(t).replace(/[<>&]/g, ' ')}</text><text>${esc(b).replace(/[<>&]/g, ' ')}</text></binding></visual></toast>"`,
        '$d = New-Object Windows.Data.Xml.Dom.XmlDocument; $d.LoadXml($x)',
        "[Windows.UI.Notifications.ToastNotificationManager]::CreateToastNotifier('{1AC14E77-02E7-4E5D-B744-2EB1AE5198B7}\\WindowsPowerShell\\v1.0\\powershell.exe').Show((New-Object Windows.UI.Notifications.ToastNotification $d))",
      ].join('; ');
      spawnSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', script], { timeout: 10000, stdio: 'ignore', windowsHide: true });
    } else if (process.platform === 'darwin') {
      spawnSync('osascript', ['-e', `display notification "${b.replace(/"/g, '\\"')}" with title "${t.replace(/"/g, '\\"')}"`], { timeout: 10000, stdio: 'ignore' });
    } else {
      spawnSync('notify-send', [t, b], { timeout: 10000, stdio: 'ignore' });
    }
    return true;
  } catch (e) {
    return false;
  }
}

// ---------- per-agent clock ----------

/** Minutes per agent, from the conductor log: each interval between two rows is charged to the
 *  agent that reported at its end, the same attribution the retro does by hand. Intervals that
 *  end in a resume row (dead time) or exceed GAP_MINUTES (a gap) are left out, as in the clock. */
function minutesByAgent(L, logText) {
  const rows = L.parseConductorLog(logText);
  const RESUME_RE = /\b(resumed|resuming|killed|cut off|usage limit|rate limit|session limit)\b/i;
  const by = {};
  for (let i = 1; i < rows.length; i++) {
    const a = rows[i - 1], b = rows[i];
    const mins = (b.t - a.t) / 60000;
    if (mins > GAP_MINUTES || RESUME_RE.test(b.text)) continue;
    const agent = (b.text.split('|')[0] || 'unknown').trim().replace(/^workhorse:/, '') || 'unknown';
    const key = `${b.phase}/${agent}`;
    by[key] = (by[key] || 0) + mins;
  }
  return Object.entries(by).map(([k, m]) => {
    const [phase, agent] = k.split('/');
    return { phase, agent, minutes: Math.round(m * 10) / 10 };
  }).sort((x, y) => y.minutes - x.minutes);
}

function formatByAgent(rows) {
  if (!rows.length) return 'By agent: no intervals yet';
  const total = rows.reduce((a, r) => a + r.minutes, 0);
  return ['By agent (minutes charged to the agent that reported):']
    .concat(rows.map((r) => `  ${String(r.minutes.toFixed(1)).padStart(7)}  ${r.phase.padEnd(7)} ${r.agent}`))
    .concat([`  ${total.toFixed(1).padStart(7)}  total`]).join('\n');
}

module.exports = {
  CHECK_ORDER, verify, measure, checksTable, fold, removeWorktreeFor,
  lockAcquire, lockTouch, lockRelease, readLock, lockFile, notify, minutesByAgent, formatByAgent, runShell, shellFor,
};
