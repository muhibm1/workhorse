// The run metrics consumer: reads every event and keeps, per change, what the clock needs (the
// conductor-log rows and the gate decisions) plus what only the log knows: sessions, tool calls
// and guard blocks per phase, waiting per gate, voided approvals. Its figures for a change come
// from the same computeClock the ledger uses, so a live number and a recomputed one can only
// differ if the log lost something. Phase 3 of the event-bus design (0.6.1).
'use strict';
const path = require('path');
const B = require('./index');

const GROUP = 'metrics';

function lib() { return require(path.join(__dirname, '..', '..', 'hooks', 'scripts', 'lib.js')); }
function storeFile(root) { return path.join(B.busDir(root), 'metrics.json'); }
function empty() { return { schema: 1, meta: { offsets: {}, seen: {} }, changes: {} }; }

/** Apply one event. Every type counts toward something, so every event id is remembered. */
function apply(store, ev) {
  if (store.meta.seen[ev.event_id]) return false;
  if (!ev.change_id || !ev.repo) throw new Error(`event ${ev.event_id} has no change_id or repo`);
  store.meta.seen[ev.event_id] = 1;
  const k = `${ev.repo}|${ev.change_id}`;
  const c = store.changes[k] || (store.changes[k] = {
    repo: ev.repo, change_id: ev.change_id, title: null, tier: null, phase: null, done: false,
    rows: [], decisions: [], presented: {}, sessions: {}, subagent_sessions: {}, tools: {}, blocks: {},
    docs_written: 0, voided: 0, ignored: 0, hosts: [], first_ts: null, last_ts: null, events: 0, backfilled: false,
  });
  const p = ev.payload || {};
  const phase = p.phase || c.phase || 'unknown';
  c.events++;
  if (ev.host && !c.hosts.includes(ev.host)) c.hosts.push(ev.host);
  if (!c.first_ts || ev.ts < c.first_ts) c.first_ts = ev.ts;
  if (!c.last_ts || ev.ts > c.last_ts) c.last_ts = ev.ts;
  const bump = (o, name) => { o[name] = (o[name] || 0) + 1; };
  switch (ev.type) {
    case 'change.created':
      c.title = p.title || c.title;
      if (Number.isInteger(p.tier)) c.tier = p.tier;
      if (p.backfilled) c.backfilled = true;
      break;
    case 'state.saved': {
      const s = p.state || {};
      if (s.title) c.title = s.title;
      const t = s.tier_override !== null && s.tier_override !== undefined ? s.tier_override : s.tier;
      if (t !== null && t !== undefined) c.tier = Number(t);
      if (s.phase) c.phase = s.phase;
      if (s.phase === 'done') c.done = true;
      break;
    }
    case 'phase.started':
      c.phase = p.phase;
      if (p.phase === 'done') c.done = true;
      break;
    case 'log.row': {
      const parsed = lib().parseConductorLog(p.row);
      if (parsed.length) {
        c.rows.push({ ...parsed[0], order: c.rows.length });
        if (/^done$/i.test(parsed[0].phase)) c.done = true;
      }
      break;
    }
    case 'gate.presented': c.presented[p.gate] = ev.ts; break;
    case 'gate.approved':
    case 'gate.rejected': {
      const a = ev.actor || {};
      if (a.kind !== 'human' || a.agent_id || a.agent_type) { c.ignored++; break; }
      const t = Date.parse(ev.ts);
      if (!Number.isNaN(t)) c.decisions.push({ t, gate: p.gate, status: ev.type === 'gate.approved' ? 'approved' : 'rejected' });
      break;
    }
    case 'session.opened': bump(p.subagent ? c.subagent_sessions : c.sessions, phase); break;
    case 'session.closed': if (p.subagent) bump(c.subagent_sessions, phase); break;
    case 'tool.called':
      bump(c.tools, phase);
      if (Array.isArray(p.gate_event_ids) && p.gate_event_ids.length && ev.actor && (ev.actor.agent_id || ev.actor.agent_type)) c.voided += p.gate_event_ids.length;
      break;
    case 'hook.blocked':
    case 'hook.asked': bump(c.blocks, p.hook || 'unknown'); break;
    case 'doc.written': c.docs_written++; break;
    default: break; // a type this version does not know: counted in events, nothing else
  }
  return true;
}

async function catchUp(root, opts) {
  const o = opts || {};
  const cfg = o.cfg || B.config(root);
  if (!cfg) throw new Error('the event log is not configured for this repository');
  return B.catchUp({ cfg, transport: o.transport, group: B.groupName(GROUP), file: o.file || storeFile(root), empty, apply, timeoutMs: o.timeoutMs });
}

/** One change's figures. A change that reached done, or one backfilled from a committed record,
 *  is measured as the ledger measures every recorded run: as closed, ending at its last event. */
function figures(c, now) {
  const L = lib();
  const rows = c.rows.slice().sort((a, b) => a.order - b.order).map(({ t, phase, text }) => ({ t, phase, text }));
  const closed = c.done || c.backfilled;
  const state = { phase: closed ? 'done' : (c.phase || 'design'), tier: c.tier === null ? 2 : c.tier };
  const pending = !closed && Object.entries(c.presented).some(([g, at]) => !c.decisions.some((d) => d.gate === g && d.t >= Date.parse(at)));
  const clock = L.computeClock({ rows, decisions: c.decisions, state, profile: {}, pending_gate: pending, now });
  return {
    repo: c.repo, change_id: c.change_id, title: c.title, tier: c.tier, phase: c.done ? 'done' : c.phase, done: c.done, backfilled: c.backfilled,
    agent_minutes: clock.agent_minutes, waiting_minutes: clock.waiting_minutes, dead_minutes: clock.dead_minutes,
    unexplained_minutes: clock.gap_minutes, wall_minutes: clock.wall_minutes, within_budget: clock.within_budget,
    budget_minutes: clock.budget_minutes,
    waiting_by_gate: clock.waiting_by_gate,
    agent_minutes_by_phase: Object.fromEntries(clock.phases.map((p) => [p.phase, p.agent_minutes])),
    sessions_by_phase: c.sessions, subagent_sessions_by_phase: c.subagent_sessions,
    tool_calls_by_phase: c.tools, blocks_by_hook: c.blocks,
    decisions: c.decisions.length, rejections: c.decisions.filter((d) => d.status === 'rejected').length,
    docs_written: c.docs_written, voided_approvals: c.voided, ignored_approvals: c.ignored,
    hosts: c.hosts, events: c.events, first_event: c.first_ts, last_event: c.last_ts,
  };
}

/** Figures for every change in the store, newest first. */
function report(store, opts) {
  const o = opts || {};
  const now = o.now || Date.now();
  return Object.values(store.changes)
    .filter((c) => (!o.change || c.change_id === o.change) && (!o.repo || c.repo === o.repo))
    .map((c) => figures(c, now))
    .sort((a, b) => String(b.first_event).localeCompare(String(a.first_event)));
}

module.exports = { GROUP, storeFile, empty, apply, catchUp, figures, report };
