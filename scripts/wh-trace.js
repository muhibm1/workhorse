// A WorkHorse change as one LangSmith trace (0.5.2). Zero dependencies.
//
// The conductor log already stamps every step with the real time and the agent that did it, and
// the run ledger trusts it for every number it reports. This turns the same rows into a trace:
//
//   WorkHorse change (root)
//     design           (one child per phase, in order; a phase entered twice appears twice)
//       wh-designer    (one child per log row: the step that ended at that row)
//       ...
//
// Each step runs from the previous row to its own row, the same interval the clock counts.
// Intervals the clock calls waiting, dead or unexplained are tagged so, so LangSmith's latency
// view shows agent work apart from time spent waiting on a person. The launcher's stream logs,
// when present, add tokens and cost by agent to the root.
//
// LangSmith only accepts runs from the last 24 hours, so an older change is replayed: shifted to
// end now, durations unchanged, the recorded times kept in metadata and a `replayed` tag. A
// change that ran longer than 23 hours from first row to last is not sent at all.
//
// Uploaded after a change closes, never during a run, so it adds no time to the run. Off unless
// LANGSMITH_API_KEY is set. Ids are derived from the change id, so uploading again posts the
// same runs rather than a second copy.
//
// Flywheel (0.5.3). The root carries five scores as LangSmith feedback, each 1 or 0 and each
// counted from the record: finished, within_budget, no_stall (no stretch of 10 minutes or more
// with the run stopped, the watcher's own stall threshold), no_unexplained_gap and
// gates_first_time. One phase carries the error: the phase behind the first failing score (the
// phase that used the most agent time, the stopped run, the gap, the rejected gate; the last
// phase of an unfinished run). Every phase lists what went wrong in it in metadata. Phases are labelled with LangGraph's node metadata, so Flywheel's miner groups
// bad runs as "<score> < 1 @ <phase>" without knowing anything about WorkHorse.
'use strict';
const crypto = require('crypto');

// A stopped stretch this long counts as a stall, the same threshold the watcher resumes at.
const STALL_MINUTES = 10;
// The order scores are checked in; a Flywheel config lists its rules in the same order.
const SCORE_ORDER = ['finished', 'within_budget', 'no_stall', 'no_unexplained_gap', 'gates_first_time'];

// LangSmith takes a run once and an update once, so a trace cannot be reshaped after it is sent.
// When what a trace carries changes, this number changes and the trace is sent again as new runs.
// 1: 0.5.2. 2: 0.5.3 (scores, one error per trace, node labels).
const TRACE_SCHEMA = 2;

/** A stable UUID (version 5 layout) for a name within a change. */
function stableId(changeId, name) {
  const h = crypto.createHash('sha1').update(`workhorse:${TRACE_SCHEMA > 1 ? `v${TRACE_SCHEMA}:` : ''}${changeId}:${name}`).digest();
  h[6] = (h[6] & 0x0f) | 0x50;
  h[8] = (h[8] & 0x3f) | 0x80;
  const x = h.subarray(0, 16).toString('hex');
  return `${x.slice(0, 8)}-${x.slice(8, 12)}-${x.slice(12, 16)}-${x.slice(16, 20)}-${x.slice(20, 32)}`;
}

/** LangSmith's dotted-order stamp for a time: 20261013T085200123000Z. */
function stamp(ms) {
  return new Date(ms).toISOString().replace(/[-:]/g, '').replace(/\.(\d{3})Z$/, '$1000Z');
}

/** Splits a log row's text into the agent that wrote it and what it reported. */
function agentOf(text) {
  const i = String(text).indexOf(' | ');
  return i > 0 ? { agent: text.slice(0, i).trim(), result: text.slice(i + 3).trim() } : { agent: 'conductor', result: String(text).trim() };
}

/** Tokens and cost per agent from launcher stream logs (stream-json). A subagent's messages
 *  carry the id of the Task call that started it; the call names the agent type. */
function usageFromStreams(streams) {
  const byAgent = {};
  let cost = 0;
  for (const text of streams || []) {
    const names = {};
    for (const line of String(text).split(/\r?\n/)) {
      if (!line.startsWith('{')) continue;
      let e;
      try { e = JSON.parse(line); } catch (err) { continue; }
      if (e.type === 'result' && typeof e.total_cost_usd === 'number') cost += e.total_cost_usd;
      if (e.type !== 'assistant' || !e.message) continue;
      for (const c of e.message.content || []) {
        if (c.type === 'tool_use' && (c.name === 'Task' || c.name === 'Agent') && c.input) names[c.id] = c.input.subagent_type || 'subagent';
      }
      const who = e.parent_tool_use_id ? (names[e.parent_tool_use_id] || 'subagent') : 'conductor';
      const u = e.message.usage || {};
      const row = byAgent[who] || (byAgent[who] = { input_tokens: 0, output_tokens: 0, cache_read_input_tokens: 0, messages: 0 });
      row.input_tokens += (u.input_tokens || 0) + (u.cache_creation_input_tokens || 0);
      row.output_tokens += u.output_tokens || 0;
      row.cache_read_input_tokens += u.cache_read_input_tokens || 0;
      row.messages += 1;
    }
  }
  return { by_agent: byAgent, cost_usd: Math.round(cost * 10000) / 10000 };
}

/** How the clock counts the interval that ends at event b (mirrors lib.js computeClock). */
function intervalKind(L, b, minutes) {
  if (b.kind === 'approval') return 'waiting';
  if (b.kind === 'log' && L.RESUME_RE.test(b.text)) return 'dead';
  if (minutes > L.GAP_MINUTES) return 'unexplained';
  return 'agent';
}

/**
 * The runs of one trace, parents before children, ready for POST /runs/batch.
 * `info` is { id, title, tier, version, metrics, log, approvals, streams, project }.
 */
function buildTrace(L, info) {
  const rows = L.parseConductorLog(info.log).map((r) => ({ ...r, kind: 'log' }));
  const approvals = L.parseApprovals(info.approvals || '').map((a) => ({ ...a, kind: 'approval', phase: null, text: `${a.gate} ${a.status}` }));
  let events = rows.concat(approvals).sort((a, b) => a.t - b.t);
  if (events.length < 2) return [];
  // A change that ran longer than LangSmith's window cannot be shown with true durations.
  if (events[events.length - 1].t - events[0].t > 23 * 3600000) return [];
  // LangSmith accepts start times within 24 hours of now. An older change is replayed: every
  // time moves by the same amount so it ends now, durations are exact, and the recorded times
  // stay in the root's metadata and the `replayed` tag.
  const recorded = { started_at: new Date(events[0].t).toISOString(), ended_at: new Date(events[events.length - 1].t).toISOString() };
  const now = info.now !== undefined ? info.now : Date.now();
  const shift = now - events[0].t > 23 * 3600000 ? now - events[events.length - 1].t : 0;
  if (shift) events = events.map((e) => ({ ...e, t: e.t + shift }));
  const usage = usageFromStreams(info.streams);
  const rootId = stableId(info.id, 'root');
  const rootOrder = `${stamp(events[0].t)}${rootId}`;
  const runs = [];
  const iso = (t) => new Date(t).toISOString();
  const minutes = { agent: 0, waiting: 0, dead: 0, unexplained: 0 };
  let phase = null;
  let phaseRun = null;
  let phaseCount = 0;
  const steps = [];
  let stalls = 0;
  const marks = [];
  const phaseAgent = new Map();
  let rejections = 0;
  for (let i = 1; i < events.length; i++) {
    const a = events[i - 1], b = events[i];
    const mins = Math.max(0, (b.t - a.t) / 60000);
    const kind = intervalKind(L, b, mins);
    minutes[kind] += mins;
    const p = (b.kind === 'log' ? b.phase : (a.kind === 'log' ? a.phase : phase)) || 'unknown';
    if (p !== phase || !phaseRun) {
      phase = p;
      phaseCount += 1;
      const id = stableId(info.id, `phase:${phaseCount}:${p}`);
      phaseRun = {
        id, trace_id: rootId, parent_run_id: rootId, dotted_order: `${rootOrder}.${stamp(a.t)}${id}`,
        name: p, run_type: 'chain', start_time: iso(a.t), end_time: iso(b.t),
        inputs: {}, outputs: { steps: 0 }, tags: ['workhorse', 'phase'],
        extra: { metadata: { phase: p, langgraph_node: p, langgraph_step: phaseCount } },
      };
      runs.push(phaseRun);
    }
    if (kind === 'agent') phaseAgent.set(phaseRun, (phaseAgent.get(phaseRun) || 0) + mins);
    const rejected = b.kind === 'approval' && / rejected$/.test(b.text);
    if (rejected) rejections += 1;
    if (kind === 'dead' && mins >= STALL_MINUTES) stalls += 1;
    const key = rejected ? 'gates_first_time' : kind === 'dead' && mins >= STALL_MINUTES ? 'no_stall' : kind === 'unexplained' ? 'no_unexplained_gap' : null;
    if (key) {
      const text = rejected ? `gate rejected: ${b.text.split(' ')[0]}` : key === 'no_stall' ? `stopped run: ${Math.round(mins)} minutes before it was resumed` : `unexplained gap: ${Math.round(mins)} minutes`;
      marks.push({ key, run: phaseRun, text });
      (phaseRun.extra.metadata.went_wrong = phaseRun.extra.metadata.went_wrong || []).push(text);
    }
    phaseRun.end_time = iso(b.t);
    phaseRun.outputs.steps += 1;
    const who = b.kind === 'approval' ? { agent: 'owner', result: b.text } : agentOf(b.text);
    const id = stableId(info.id, `step:${i}`);
    const step = {
      id, trace_id: rootId, parent_run_id: phaseRun.id, dotted_order: `${phaseRun.dotted_order}.${stamp(a.t)}${id}`,
      name: who.agent, run_type: 'chain',
      start_time: iso(a.t), end_time: iso(b.t),
      inputs: { phase: p }, outputs: { result: who.result },
      tags: ['workhorse', kind], extra: { metadata: { interval: kind, minutes: Math.round(mins * 10) / 10 } },
    };
    steps.push(step);
  }
  const r1 = (n) => Math.round(n * 10) / 10;
  const m = info.metrics || {};
  const budget = info.tier === null || info.tier === undefined ? null : L.budgetMinutes(info.tier, {});
  const finished = info.status !== undefined ? info.status === 'finished' : rows.some((r) => r.phase === 'done');
  const scores = {
    finished: finished ? 1 : 0,
    ...(budget === null ? {} : { within_budget: minutes.agent <= budget ? 1 : 0 }),
    no_stall: stalls ? 0 : 1,
    no_unexplained_gap: minutes.unexplained > 0 ? 0 : 1,
    gates_first_time: rejections ? 0 : 1,
  };
  if (scores.within_budget === 0 && phaseAgent.size) {
    const [worst, mins] = [...phaseAgent.entries()].sort((x, y) => y[1] - x[1])[0];
    marks.push({ key: 'within_budget', run: worst, text: `over budget: ${worst.name} used ${Math.round(mins)} of ${Math.round(minutes.agent)} agent minutes (budget ${budget})` });
  }
  const lastPhase = runs[runs.length - 1];
  if (!scores.finished && lastPhase) marks.push({ key: 'finished', run: lastPhase, text: `not finished: the record stops in ${lastPhase.name}` });
  // One error per trace, on the phase behind the first failing score in SCORE_ORDER, so the
  // miner's reason and node describe the same problem. Every other mark stays in metadata.
  const primary = SCORE_ORDER.map((k) => marks.find((m) => m.key === k)).find(Boolean);
  if (primary) primary.run.error = primary.text;
  runs.unshift({
    id: rootId, trace_id: rootId, dotted_order: rootOrder,
    name: `WorkHorse: ${info.title || info.id}`, run_type: 'chain',
    start_time: iso(events[0].t), end_time: iso(events[events.length - 1].t),
    inputs: { change_id: info.id, request: info.title || info.id },
    outputs: {
      agent_minutes: r1(minutes.agent), waiting_minutes: r1(minutes.waiting), dead_minutes: r1(minutes.dead),
      unexplained_minutes: r1(minutes.unexplained), gate_decisions: approvals.length, scores,
    },
    tags: ['workhorse', `tier-${info.tier === null || info.tier === undefined ? 'unknown' : info.tier}`].concat(info.version ? [`workhorse-${info.version}`] : [], shift ? ['replayed'] : []),
    extra: {
      metadata: {
        change_id: info.id, repository: info.repo || null, recorded_started_at: recorded.started_at,
        recorded_ended_at: recorded.ended_at, replayed: Boolean(shift), tier: info.tier, plugin_version: info.version || null,
        cost_usd: typeof m.cost_usd === 'number' ? m.cost_usd : (usage.cost_usd || null),
        tokens_by_agent: usage.by_agent,
      },
    },
  });
  return runs.concat(steps);
}

/** The root's scores as LangSmith feedback rows, with ids stable per change and key. */
function feedbackFor(runs) {
  const root = runs[0];
  if (!root || !root.outputs || !root.outputs.scores) return [];
  const change = root.inputs.change_id;
  return Object.entries(root.outputs.scores).map(([key, score]) => ({
    id: stableId(change, `feedback:${key}`), run_id: root.id, trace_id: root.id, key, score,
    feedback_source: { type: 'api', metadata: { source: 'workhorse' } },
  }));
}

/** POST the runs to LangSmith in one batch, then their scores as feedback. Resolves
 *  { ok, status, error? }; never throws. */
async function upload(runs, opts) {
  const endpoint = String(opts.endpoint || 'https://api.smith.langchain.com').replace(/\/+$/, '');
  const project = opts.project || 'workhorse-runs';
  const headers = { 'content-type': 'application/json', 'x-api-key': opts.apiKey };
  const call = (p, body) => fetch(`${endpoint}${p}`, { method: 'POST', headers, body: JSON.stringify(body), signal: AbortSignal.timeout(opts.timeoutMs || 30000) });
  try {
    const post = runs.map((r) => ({ ...r, session_name: project }));
    const res = await call('/runs/batch', { post });
    // The ids are stable, so a second upload of the same change is a duplicate, not a failure.
    const alreadySent = res.status === 409;
    if (!res.ok && !alreadySent) return { ok: false, status: res.status, error: (await res.text()).slice(0, 300) };
    let scored = 0;
    for (const f of feedbackFor(runs)) {
      const r = await call('/feedback', f);
      // A score already recorded under the same id is a duplicate, not a failure.
      if (!r.ok && r.status !== 409) return { ok: false, status: r.status, error: `feedback ${f.key}: ${(await r.text()).slice(0, 200)}` };
      scored += 1;
    }
    return { ok: true, status: res.status, scored, ...(alreadySent ? { already_sent: true } : {}) };
  } catch (e) {
    return { ok: false, status: 0, error: e.message };
  }
}

module.exports = { TRACE_SCHEMA, SCORE_ORDER, stableId, stamp, agentOf, usageFromStreams, intervalKind, buildTrace, feedbackFor, upload };
