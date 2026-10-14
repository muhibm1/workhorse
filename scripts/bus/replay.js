// Replay: one change's full history from the log, from the start up to any moment, printed as a
// timeline or re-materialized into a folder (its control state, its conductor log byte for byte,
// its gate decisions and a manifest of every document's SHA-256). The AgentOps "fork from a
// checkpoint" idea applied to a WorkHorse run. Phase 4 of the event-bus design (0.6.2).
'use strict';
const fs = require('fs');
const path = require('path');
const B = require('./index');
const P = require('./projector');
const K = require('./kafka');

/** Every event of one change, in log order (one partition holds all of them). */
async function changeEvents(cfg, t, repo, id) {
  const parts = await t.partitions(cfg.topic);
  const partition = K.partitionFor(id, parts.length);
  const out = [];
  let off = 0;
  for (;;) {
    const { records, highWatermark } = await t.fetch(cfg.topic, partition, off);
    if (!records.length) break;
    for (const r of records) {
      off = r.offset + 1;
      let ev; try { ev = JSON.parse(r.value.toString('utf8')); } catch (e) { continue; }
      if (ev.change_id === id && ev.repo === repo) out.push({ ...ev, _at: { partition, offset: r.offset } });
    }
    if (off >= highWatermark) break;
  }
  return out;
}

/** Events up to a cut-off: an ISO time, or `@<offset>` for a position in the change's partition.
 *  Duplicates (the same event id delivered twice) are dropped here, as every consumer drops them. */
function cut(events, until) {
  const seen = new Set();
  const out = [];
  for (const ev of events) {
    if (seen.has(ev.event_id)) continue;
    if (until) {
      if (until.startsWith('@')) { if (ev._at.offset > Number(until.slice(1))) break; }
      else if (ev.ts > new Date(until).toISOString()) continue;
    }
    seen.add(ev.event_id);
    out.push(ev);
  }
  return out;
}

/** One line per event that tells the story; tool calls are folded into a count per phase. */
function timeline(events) {
  const lines = [];
  let tools = 0;
  const flushTools = () => { if (tools) { lines.push(`                           ${tools} tool call${tools === 1 ? '' : 's'}`); tools = 0; } };
  for (const ev of events) {
    const p = ev.payload || {};
    if (ev.type === 'tool.called') { tools++; continue; }
    flushTools();
    const at = `${String(ev.ts).slice(0, 19).replace('T', ' ')} ${String(ev.host || '').slice(0, 14).padEnd(14)}`;
    let what;
    switch (ev.type) {
      case 'change.created': what = `change created: ${p.title || ''}${p.tier !== undefined && p.tier !== null ? ` (tier ${p.tier})` : ''}`; break;
      case 'phase.started': what = `phase ${p.phase}`; break;
      case 'log.row': what = `log  ${String(p.row || '').split('|').slice(2).join('|').trim()}`; break;
      case 'gate.presented': what = `${p.gate} presented`; break;
      case 'gate.approved': case 'gate.rejected': what = `${p.gate} ${ev.type.slice(5)} by ${p.by || 'unknown'}${p.sha256 ? ` (packet sha256 ${p.sha256.slice(0, 12)})` : ''}`; break;
      case 'doc.written': what = `wrote ${p.path} (${p.bytes} bytes)`; break;
      case 'doc.decided': what = `decided on ${p.packet}`; break;
      case 'hook.blocked': case 'hook.asked': what = `${p.hook} ${ev.type === 'hook.blocked' ? 'blocked' : 'asked about'} ${p.tool || ''}: ${String(p.reason || '').slice(0, 100)}`; break;
      case 'session.opened': what = 'session opened'; break;
      case 'session.closed': what = p.subagent ? 'subagent finished' : 'session closed'; break;
      case 'state.saved': continue;
      default: what = ev.type;
    }
    lines.push(`${at} ${what}`);
  }
  flushTools();
  return lines;
}

/** What the change looked like at the cut-off. */
function materialize(id, events) {
  const store = P.empty();
  for (const ev of events) P.apply(store, ev);
  const repo = events.length ? events[0].repo : null;
  const state = repo ? P.projectedState(store, repo, id) : null;
  const rows = events.filter((e) => e.type === 'log.row').map((e) => e.payload.row);
  const log = rows.length ? `# Conductor log: ${id}\n\n${rows.join('\n')}\n` : null;
  const documents = {};
  for (const ev of events) {
    if (ev.type === 'doc.written') documents[ev.payload.path] = { sha256: ev.payload.sha256, bytes: ev.payload.bytes, at: ev.ts };
  }
  const c = repo ? store.changes[P.keyOf(repo, id)] : null;
  return { state, conductor_log: log, gates: c ? c.gates : {}, ignored_approvals: c ? c.ignored : [], documents, events: events.length };
}

/** Write a materialized change into a folder. */
function writeInto(dir, id, m) {
  fs.mkdirSync(dir, { recursive: true });
  if (m.state) fs.writeFileSync(path.join(dir, 'state.json'), JSON.stringify(m.state, null, 2) + '\n');
  if (m.conductor_log) fs.writeFileSync(path.join(dir, 'conductor-log.md'), m.conductor_log);
  fs.writeFileSync(path.join(dir, 'gates.json'), JSON.stringify({ change_id: id, gates: m.gates, ignored: m.ignored_approvals }, null, 2) + '\n');
  fs.writeFileSync(path.join(dir, 'documents.json'), JSON.stringify(m.documents, null, 2) + '\n');
  return ['state.json', 'conductor-log.md', 'gates.json', 'documents.json'].filter((f) => fs.existsSync(path.join(dir, f)));
}

module.exports = { changeEvents, cut, timeline, materialize, writeInto };
