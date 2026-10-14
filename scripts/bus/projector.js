// The approvals projector: reads the event log and keeps, per repository and change, each gate's
// last decision (pinned to the packet's SHA-256 and length), the latest control-state snapshot,
// and every approval it ignored or voided, with the reason. Gate checks ask it, never state.json,
// whenever the repository turns the log on. Phase 1 of the event-bus design (0.6.0).
'use strict';
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const B = require('./index');

const GROUP = 'approvals';
const GATE_EVENT_RE = /wh-gate-event:([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})/g;

function lib() { return require(path.join(__dirname, '..', '..', 'hooks', 'scripts', 'lib.js')); }
function storeFile(root) { return path.join(B.busDir(root), 'approvals.json'); }
function empty() { return { schema: 1, meta: { offsets: {}, seen: {} }, voids: {}, changes: {} }; }
function keyOf(repo, id) { return `${repo}|${id}`; }

/** The change's entry in the store, created on first use. */
function entry(store, ev) {
  const k = keyOf(ev.repo, ev.change_id);
  if (!store.changes[k]) store.changes[k] = { repo: ev.repo, change_id: ev.change_id, gates: {}, state: null, ignored: [] };
  return store.changes[k];
}

/** Apply one event to the store. Returns false when the event changes nothing here. Pure apart
 *  from the store, so a rebuild from the log always gives the same result. */
function apply(store, ev) {
  if (ev.schema_version && ev.schema_version > B.SCHEMA_VERSION) {
    // A newer producer's event: tolerate it. Only fields this version knows are read.
  }
  const t = ev.type || '';
  const relevant = t === 'gate.approved' || t === 'gate.rejected' || t === 'state.saved' || t === 'change.created'
    || (t === 'tool.called' && ev.payload && Array.isArray(ev.payload.gate_event_ids) && ev.payload.gate_event_ids.length);
  if (!relevant) return false;
  if (store.meta.seen[ev.event_id]) return false; // delivered twice: counts once (rule 3)
  if (!ev.change_id || !ev.repo) throw new Error(`event ${ev.event_id} has no change_id or repo`);
  store.meta.seen[ev.event_id] = 1;
  const e = entry(store, ev);

  if (t === 'change.created') return true;

  if (t === 'state.saved') {
    const s = ev.payload && ev.payload.state;
    if (!s || typeof s !== 'object') throw new Error(`state.saved ${ev.event_id} carries no state`);
    e.state = s;
    e.state_at = ev.ts;
    e.state_host = ev.host || null;
    return true;
  }

  if (t === 'tool.called') {
    // A subagent's tool output showed an approval's id: the subagent ran the approve command.
    // That approval is void, wherever it was recorded (design D8, third layer).
    // Only a subagent's output counts: the main session runs the approve command for the person
    // (/workhorse:approve), so an approval id in its output is expected.
    const a = ev.actor || {};
    if (!a.agent_id && !a.agent_type) return true;
    for (const id of ev.payload.gate_event_ids) {
      store.voids[id] = { reason: `recorded from inside a subagent (${a.agent_type || a.agent_id || 'agent'})`, by_event: ev.event_id };
      for (const c of Object.values(store.changes)) {
        for (const [g, rec] of Object.entries(c.gates)) {
          if (rec.event_id === id) c.gates[g] = { ...rec, status: 'voided', void_reason: store.voids[id].reason };
        }
      }
    }
    return true;
  }

  // gate.approved / gate.rejected
  const p = ev.payload || {};
  const gate = p.gate;
  if (!/^G[1-5]$/.test(String(gate))) throw new Error(`gate event ${ev.event_id} names no gate`);
  const a = ev.actor || {};
  if (a.kind !== 'human' || a.agent_id || a.agent_type) {
    // Rule 2: only a person approves. The hook should have stopped this; the projector holds the
    // rule even if a hook was bypassed.
    e.ignored.push({ event_id: ev.event_id, gate, reason: `not a person's decision (actor ${a.kind || 'unknown'}${a.agent_id ? `, agent ${a.agent_id}` : ''})`, at: ev.ts });
    return true;
  }
  const status = t === 'gate.approved' ? 'approved' : 'rejected';
  const rec = {
    status, event_id: ev.event_id, at: ev.ts, by: p.by || null, host: ev.host || null,
    packet: p.packet || null, sha256: p.sha256 || null, bytes: Number.isInteger(p.bytes) ? p.bytes : null,
  };
  if (store.voids[ev.event_id]) Object.assign(rec, { status: 'voided', void_reason: store.voids[ev.event_id].reason });
  e.gates[gate] = rec;
  return true;
}

/** Catch the store up to the end of the log. Throws when the log cannot be read. */
async function catchUp(root, opts) {
  const o = opts || {};
  const cfg = o.cfg || B.config(root);
  if (!cfg) throw new Error('the event log is not configured for this repository');
  return B.catchUp({ cfg, transport: o.transport, group: B.groupName(GROUP), file: o.file || storeFile(root), empty, apply, timeoutMs: o.timeoutMs, hooks: o.hooks });
}

/** SHA-256 of the first `bytes` bytes of a file (all of it when bytes is null). */
function prefixSha(file, bytes) {
  const buf = fs.readFileSync(file);
  if (bytes !== null && bytes !== undefined && buf.length < bytes) return { sha: null, short: true };
  const part = bytes === null || bytes === undefined ? buf : buf.subarray(0, bytes);
  return { sha: crypto.createHash('sha256').update(part).digest('hex'), short: false };
}

/** Where a change's packet may be on this machine: this checkout, then the main checkout when
 *  this is a worktree (the documents may have been committed after the worktree was cut). */
function packetCandidates(root, id, packet) {
  const L = lib();
  const name = path.basename(String(packet || ''));
  const roots = [root];
  const common = L.gitCommonDir(root);
  if (common && path.basename(common) === '.git') {
    const main = path.dirname(common);
    if (path.resolve(main) !== path.resolve(root)) roots.push(main);
  }
  return roots.map((r) => path.join(L.changeDir(r, id), name));
}

/**
 * Is `gate` open for change `id`? Asks the log, never state.json. Fails closed: any error reading
 * the log, no approval, a later rejection, a voided approval, or a packet that no longer matches
 * what was approved, each give { open: false, reason }.
 */
async function gateCheck(root, id, gate, opts) {
  const o = opts || {};
  let store;
  try {
    ({ store } = await B.withTimeout(catchUp(root, o), o.timeoutMs || 3000, 'reading the event log'));
  } catch (e) {
    return { open: false, reason: `the event log is unreachable (${e.message}). Gates are closed until it is back: start the broker (docker compose -f examples/bus/compose.yml up -d in the WorkHorse plugin) and retry.`, unreachable: true };
  }
  const repo = B.repoId(root);
  const c = store.changes[keyOf(repo, id)];
  const rec = c && c.gates[gate];
  if (!rec) return { open: false, reason: `the event log has no decision on ${gate} for ${id} (${repo})` };
  if (rec.status === 'voided') return { open: false, reason: `the ${gate} approval ${rec.event_id} was voided: ${rec.void_reason}` };
  if (rec.status !== 'approved') return { open: false, reason: `${gate} was ${rec.status} at ${rec.at}` };
  if (rec.sha256) {
    const found = packetCandidates(root, id, rec.packet).find((f) => fs.existsSync(f));
    if (!found) return { open: false, reason: `${gate} was approved over ${rec.packet}, which is not on this machine; check out the change branch` };
    const { sha, short } = prefixSha(found, rec.bytes);
    if (short || sha !== rec.sha256) {
      return { open: false, reason: `${rec.packet} changed after ${gate} was approved (the approved ${rec.bytes === null ? 'file' : `first ${rec.bytes} bytes`} no longer hash to ${rec.sha256.slice(0, 12)}). Present ${gate} again.` };
    }
  }
  return { open: true, reason: `${gate} approved by ${rec.by || 'a person'} at ${rec.at}${rec.host ? ` on ${rec.host}` : ''}`, record: rec };
}

/** The control state a change had at its last snapshot on the log, with gate decisions taken
 *  only from gate events (design D6). Null when the log has never seen the change. */
function projectedState(store, repo, id) {
  const c = store.changes[keyOf(repo, id)];
  if (!c || !c.state) return null;
  const s = JSON.parse(JSON.stringify(c.state));
  s.gates = s.gates || {};
  for (const g of Object.keys(s.gates)) if (s.gates[g] === 'approved' || s.gates[g] === 'rejected') s.gates[g] = 'pending';
  for (const [g, rec] of Object.entries(c.gates)) s.gates[g] = rec.status === 'voided' ? 'pending' : rec.status;
  return s;
}

/** Rebuild a change's local control state from the log, on a machine that never ran it. */
async function restore(root, id, opts) {
  const { store } = await catchUp(root, opts);
  const repo = B.repoId(root);
  const s = projectedState(store, repo, id);
  if (!s) return { restored: false, reason: `the event log has no state for ${id} in ${repo}` };
  const L = lib();
  const file = L.stateFile(root, id);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  // Written directly, not through saveState: a restore is not a new state and must not echo a
  // snapshot back onto the log.
  fs.writeFileSync(file, JSON.stringify(s, null, 2) + '\n');
  if (!opts || opts.activate !== false) L.setActiveChangeId(root, id);
  const c = store.changes[keyOf(repo, id)];
  return { restored: true, change_id: id, phase: s.phase, gates: s.gates, from_host: c.state_host, snapshot_at: c.state_at };
}

module.exports = { GROUP, GATE_EVENT_RE, storeFile, empty, apply, catchUp, gateCheck, projectedState, restore, keyOf, prefixSha };
