#!/usr/bin/env node
// PreToolUse (Bash|Write|Edit): deny phase-advancing actions while a required gate is
// unapproved. With the event log on (0.6), the log is the only authority for a gate. Fails CLOSED when state exists but cannot be read, because a missing gate is
// exactly the case this hook exists for.
'use strict';
const path = require('path');
const L = require('./lib');

const input = L.readStdinJson();
const ctx = L.loadContext(input.cwd);
if (!ctx.root || !ctx.profile) return L.emit({});
if (ctx.error) return L.deny(`gate-guard could not read WorkHorse state (${ctx.error}). Check the control state under .git/workhorse (the active change and its state.json) before continuing.`);
if (!ctx.id || !ctx.state) return L.emit({}); // no active change: nothing to guard

const state = ctx.state;
const profile = ctx.profile;
const tool = input.tool_name || '';

// With the event log on (0.6), a gate is open only if the log says so; the answer is asked once
// per gate per tool call. Without it, state.json decides, as before.
const answers = {};
function gate(g) {
  if (!answers[g]) answers[g] = L.gateOpen(ctx.root, ctx.id, state, profile, g);
  return answers[g];
}

function blocked(g, what) {
  const req = L.requiredGates(state, profile).join(', ');
  const status = L.busConfig(ctx.root, profile) ? `event log: ${gate(g).reason}` : `status: ${(state.gates && state.gates[g]) || 'pending'}`;
  return L.deny(`${what} requires ${g} (${status}) for change ${ctx.id} at tier ${L.effectiveTier(state)}. Required human gates: ${req}. Present the gate packet and wait for /workhorse:approve ${g}.`);
}

if (tool === 'Bash') {
  const cmd = String((input.tool_input && input.tool_input.command) || '').toLowerCase();
  if (/\bgh\s+pr\s+merge\b/.test(cmd) || /\bgit\s+merge\b/.test(cmd)) {
    if (!gate('G4').open) return blocked('G4', 'Merging');
  }
  if (/\bgh\s+pr\s+create\b/.test(cmd) || /\bgit\s+push\b/.test(cmd)) {
    // Pushing the change branch is allowed once the design is approved and verification is
    // green; it is how the PR for G4 (Ship) is opened.
    if (!gate('G2').open) return blocked('G2', 'Pushing');
    const v = state.verification || {};
    if (v.status !== 'green') {
      return L.deny(`Pushing requires a green verification.md for change ${ctx.id} (current: ${v.status || 'none'}). Run the verifier first.`);
    }
  }
  return L.emit({});
}

if (tool === 'Write' || tool === 'Edit' || tool === 'MultiEdit') {
  const file = L.toolFilePath(input);
  const rel = file ? L.relToRoot(ctx.root, file) : null;
  if (!rel) return L.emit({});
  const m = rel.match(/^docs\/sdlc\/([^/]+)\/([^/]+)$/);
  if (!m) return L.emit({});
  const [, id, name] = m;
  if (id !== ctx.id) return L.emit({});
  const g = L.PHASE_ARTIFACT_GATE[name];
  if (g && !gate(g).open) return blocked(g, `Writing ${name}`);
  if (name === 'state.json') {
    // state.json is managed by the wh CLI; direct edits would let an agent mark its own gates.
    return L.deny('state.json is managed by the wh CLI (node "${CLAUDE_PLUGIN_ROOT}/scripts/wh.js" state ...). Do not edit it directly.');
  }
}

L.emit({});
