#!/usr/bin/env node
// SessionStart: inject a short summary of the client profile and the active change.
'use strict';
const L = require('./lib');

const input = L.readStdinJson();
let ctx = L.loadContext(input.cwd);
if (!ctx.root || !ctx.profile) return L.emit({});

// 0.6: on a machine that never ran this change, rebuild its control state from the event log when
// the checkout is on the change's branch, so the run continues without asking for approvals again.
let restored = '';
if (!ctx.state && L.busConfig(ctx.root, ctx.profile)) {
  const r = require('child_process').spawnSync(process.execPath, [require('path').join(__dirname, '..', '..', 'scripts', 'wh.js'), 'bus', 'restore', '--from-branch', '--quiet'],
    { cwd: ctx.root, encoding: 'utf8', timeout: 6000, windowsHide: true });
  if (r.status === 0 && String(r.stdout || '').trim()) {
    restored = String(r.stdout).trim();
    ctx = L.loadContext(input.cwd);
  }
}

// Keep one background `workhorse watch` alive, so a /approve from a phone resumes the run without
// anyone starting a watcher (0.4.0). It spends no tokens until a decision is recorded. Detached,
// so it outlives this session; off in the hook tests and in CI.
if (!process.env.WORKHORSE_NO_WATCH && !process.env.CI) {
  try {
    const W = require('../../scripts/workhorse.js');
    W.remember(ctx.root);
    W.ensureWatcher();
  } catch (e) { /* never block a session over the watcher */ }
}

const p = ctx.profile;
const lines = [];
if (restored) lines.push(`[WorkHorse] ${restored}`);
lines.push(`[WorkHorse] Client: ${(p.client && p.client.name) || 'unnamed'} (${(p.client && p.client.industry) || 'industry unset'}). Autonomy: ${p.autonomy || 'bounded'}.`);
const c = p.commands || {};
const cmds = ['typecheck', 'lint', 'test', 'build'].filter((k) => c[k]).map((k) => `${k}: ${c[k]}`);
if (cmds.length) lines.push(`Commands: ${cmds.join(' | ')}`);
const reg = (p.compliance && p.compliance.regimes) || [];
if (reg.length) lines.push(`Compliance regimes: ${reg.join(', ')}. Load the matching wh-compliance-* skill for spec and review work.`);
if (ctx.id && ctx.state) {
  const s = ctx.state;
  const gates = Object.entries(s.gates || {}).map(([g, v]) => `${g}=${v}`).join(' ');
  lines.push(`Active change: ${ctx.id} "${s.title || ''}" tier ${L.effectiveTier(s)} phase ${s.phase} mode ${s.mode}. Gates: ${gates}. Required human gates: ${L.requiredGates(s, p).join(', ')}.`);
  lines.push(`Artifacts: docs/sdlc/${ctx.id}/. Use /workhorse:status for detail, /workhorse:run to continue.`);
} else {
  lines.push('No active change. Start one with /workhorse:run "<problem> -> <outcome>" or /workhorse:intent.');
}

L.emit({ hookSpecificOutput: { hookEventName: 'SessionStart', additionalContext: lines.join('\n') } });
