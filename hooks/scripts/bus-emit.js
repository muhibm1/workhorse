#!/usr/bin/env node
// PostToolUse (every tool), SessionStart, Stop and SubagentStop: the event log's producer (0.6).
// Records what the run did as events on the active change and sends the outbox with a time cap.
// A no-op unless the profile turns the event log on. Never blocks or changes a tool call.
'use strict';
const fs = require('fs');
const path = require('path');

// This hook runs after every tool call in every repository, so a repository without the log pays
// only for this check: the profile is found and searched for a `bus:` block (or the override) before
// anything else is loaded.
const raw = (() => { try { return fs.readFileSync(0, 'utf8'); } catch (e) { return ''; } })();
if (!busMaybeOn(raw)) { process.stdout.write('{}'); return; }

const crypto = require('crypto');
const L = require('./lib');
const input = (() => { try { return raw.trim() ? JSON.parse(raw) : {}; } catch (e) { return {}; } })();
L.setInput(input);
const ctx = L.loadContext(input.cwd);
if (!ctx.root || !ctx.profile || ctx.error || !ctx.id) return L.emit({});
const cfg = L.busConfig(ctx.root, ctx.profile);
if (!cfg) return L.emit({});

const B = require('../../scripts/bus/index.js');
const P = require('../../scripts/bus/projector.js');
const actor = L.hookActor(input);
const base = { change_id: ctx.id, session_id: input.session_id || undefined, actor };
const events = [];
const hookEvent = input.hook_event_name || '';

if (hookEvent === 'SessionStart') {
  events.push({ ...base, type: 'session.opened', payload: { source: input.source || null, phase: ctx.state && ctx.state.phase } });
} else if (hookEvent === 'Stop' || hookEvent === 'SubagentStop') {
  events.push({ ...base, type: 'session.closed', payload: { subagent: hookEvent === 'SubagentStop', phase: ctx.state && ctx.state.phase } });
} else {
  const tool = input.tool_name || '';
  const ti = input.tool_input || {};
  const summary = String(ti.command || ti.file_path || ti.notebook_path || ti.pattern || ti.url || ti.description || '').replace(/\s+/g, ' ').slice(0, 200);
  // An approval's event id in a tool's output means that tool call ran the approve command. The
  // projector voids it when the call came from a subagent (design D8).
  const out = JSON.stringify(input.tool_response || '');
  const ids = [...new Set([...out.matchAll(P.GATE_EVENT_RE)].map((m) => m[1]))];
  events.push({ ...base, type: 'tool.called', payload: { tool, summary, phase: ctx.state && ctx.state.phase, ...(ids.length ? { gate_event_ids: ids } : {}) } });
  const file = L.toolFilePath(input);
  const rel = file && /^(Write|Edit|MultiEdit|NotebookEdit)$/.test(tool) ? L.relToRoot(ctx.root, file) : null;
  const m = rel && /^docs\/sdlc\/([^/]+)\/(.+)$/.exec(rel);
  if (m) {
    try {
      const buf = fs.readFileSync(path.join(ctx.root, rel));
      events.push({ ...base, change_id: m[1], type: 'doc.written', payload: { path: rel, sha256: crypto.createHash('sha256').update(buf).digest('hex'), bytes: buf.length } });
    } catch (e) { /* the write failed or the file moved: nothing to record */ }
  }
}

B.emit(ctx.root, events, cfg);
B.flush(ctx.root, { cfg, timeoutMs: 1500 })
  .catch(() => null)
  .finally(() => L.emit({}));

/** False only when the log is certainly off: overridden off, or no profile with a `bus:` block. */
function busMaybeOn(text) {
  const env = process.env.WORKHORSE_BUS_BROKERS;
  if (env === 'off') return false;
  if (env) return true;
  let cwd = process.cwd();
  try { cwd = JSON.parse(text).cwd || cwd; } catch (e) { /* use the process directory */ }
  let dir = path.resolve(process.env.WORKHORSE_ROOT || cwd);
  for (let i = 0; i < 40; i++) {
    const prof = path.join(dir, '.workhorse', 'profile.yml');
    if (fs.existsSync(prof)) return /^bus:/m.test(fs.readFileSync(prof, 'utf8'));
    const parent = path.dirname(dir);
    if (parent === dir) return false;
    dir = parent;
  }
  return false;
}
