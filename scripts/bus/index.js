// WorkHorse's event log: configuration, the event envelope, the local outbox, and a consumer
// loop with retries and a dead-letter topic. Zero dependencies.
//
// The log is opt-in per repository (a `bus:` block in .workhorse/profile.yml). Without it every
// function here is a no-op and WorkHorse behaves exactly as before 0.6.
// Design: docs/superpowers/specs/2026-10-14-event-bus-design.md.
'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const K = require('./kafka');

const SCHEMA_VERSION = 1;
const DEFAULT_TOPIC = 'workhorse.events';
const DEFAULT_PARTITIONS = 6;
const DEAD_LETTER = 'workhorse.dead-letter';

function lib() { return require(path.join(__dirname, '..', '..', 'hooks', 'scripts', 'lib.js')); }

// ---------- configuration ----------

/** The bus settings for a repository, or null when its profile does not turn the log on.
 *  WORKHORSE_BUS_BROKERS overrides the broker list (and turns the log on for tests); "off"
 *  turns it off. */
function config(root, profile) {
  const env = process.env.WORKHORSE_BUS_BROKERS;
  if (env === 'off') return null;
  let p = profile;
  if (p === undefined && root) { try { p = lib().loadProfile(root); } catch (e) { p = null; } }
  const b = (p && p.bus) || null;
  const brokers = env || (b && b.brokers) || null;
  if (!brokers) return null;
  return {
    brokers: String(brokers),
    topic: (b && b.topic) || DEFAULT_TOPIC,
    deadLetter: (b && b.dead_letter) || DEAD_LETTER,
    partitions: Number((b && b.partitions) || DEFAULT_PARTITIONS),
  };
}

/** Where this machine's bus files live: the outbox and each consumer's store. */
function busDir(root) { return path.join(lib().stateRoot(root), 'bus'); }

// ---------- transports ----------

/** A client for the configured log: the Kafka protocol, or (for tests) a folder of JSON lines
 *  addressed as `file:<dir>` with the same interface and semantics. */
function transport(cfg, opts) {
  if (cfg.brokers.startsWith('file:')) return new FileLog(cfg.brokers.slice(5));
  return new K.Client({ brokers: cfg.brokers, timeoutMs: (opts && opts.timeoutMs) || 3000, clientId: 'workhorse' });
}

/** An append-only log in a folder: <dir>/<topic>/<partition>.jsonl, one record per line, the
 *  offset being the line number. A file named DOWN in the folder makes every call fail, which is
 *  how the tests stop "the broker". */
class FileLog {
  constructor(dir) { this.dir = dir; }
  check() { if (fs.existsSync(path.join(this.dir, 'DOWN'))) throw new Error(`could not reach the broker at file:${this.dir} (down)`); }
  topicDir(t) { return path.join(this.dir, t); }
  lines(t, p) {
    const f = path.join(this.topicDir(t), `${p}.jsonl`);
    if (!fs.existsSync(f)) return [];
    return fs.readFileSync(f, 'utf8').split('\n').filter(Boolean);
  }
  async createTopic(name, partitions, configs) {
    this.check();
    const d = this.topicDir(name);
    if (fs.existsSync(path.join(d, 'meta.json'))) return { created: false, exists: true };
    fs.mkdirSync(d, { recursive: true });
    fs.writeFileSync(path.join(d, 'meta.json'), JSON.stringify({ partitions, configs: configs || {} }));
    return { created: true, exists: false };
  }
  async partitions(topic) {
    this.check();
    const m = path.join(this.topicDir(topic), 'meta.json');
    if (!fs.existsSync(m)) await this.createTopic(topic, DEFAULT_PARTITIONS);
    const n = JSON.parse(fs.readFileSync(m, 'utf8')).partitions;
    return Array.from({ length: n }, (_, i) => ({ partition: i }));
  }
  async produce(topic, partition, records) {
    this.check();
    await this.partitions(topic);
    const base = this.lines(topic, partition).length;
    const now = Date.now();
    fs.appendFileSync(path.join(this.topicDir(topic), `${partition}.jsonl`),
      records.map((r) => JSON.stringify({ key: r.key, value: Buffer.isBuffer(r.value) ? r.value.toString('utf8') : String(r.value), timestamp: r.timestamp || now })).join('\n') + '\n');
    return base;
  }
  async fetch(topic, partition, offset) {
    this.check();
    const ls = this.lines(topic, partition);
    const records = ls.slice(offset).map((l, i) => { const r = JSON.parse(l); return { offset: offset + i, key: r.key, value: Buffer.from(r.value, 'utf8'), timestamp: r.timestamp }; });
    return { records, highWatermark: ls.length };
  }
  async offsets(topic, which) {
    this.check();
    const out = {};
    for (const { partition } of await this.partitions(topic)) out[partition] = which === 'earliest' ? 0 : this.lines(topic, partition).length;
    return out;
  }
  groupFile(group) { return path.join(this.dir, '_groups', `${group.replace(/[^\w.-]/g, '_')}.json`); }
  async commit(group, topic, positions) {
    this.check();
    const f = this.groupFile(group);
    const cur = fs.existsSync(f) ? JSON.parse(fs.readFileSync(f, 'utf8')) : {};
    cur[topic] = { ...(cur[topic] || {}), ...positions };
    fs.mkdirSync(path.dirname(f), { recursive: true });
    fs.writeFileSync(f, JSON.stringify(cur));
  }
  async committed(group, topic) {
    this.check();
    const f = this.groupFile(group);
    const cur = fs.existsSync(f) ? JSON.parse(fs.readFileSync(f, 'utf8')) : {};
    const out = {};
    for (const { partition } of await this.partitions(topic)) out[partition] = (cur[topic] || {})[partition] !== undefined ? cur[topic][partition] : -1;
    return out;
  }
  async groups() {
    const d = path.join(this.dir, '_groups');
    return fs.existsSync(d) ? fs.readdirSync(d).map((f) => f.replace(/\.json$/, '')) : [];
  }
  close() {}
}

// ---------- the envelope ----------

let repoCache = null;
/** A machine-independent name for the repository: its origin URL without scheme, user or
 *  `.git` (github.com/muhibm1/workhorse), read from .git/config without spawning git. Falls
 *  back to the folder name. */
function repoId(root) {
  if (repoCache && repoCache.root === root) return repoCache.id;
  let id = path.basename(path.resolve(root));
  try {
    const common = lib().gitCommonDir(root);
    const cfg = fs.readFileSync(path.join(common, 'config'), 'utf8');
    const m = /\[remote "origin"\][^[]*?url\s*=\s*(.+)/.exec(cfg);
    if (m) id = normalizeRemote(m[1].trim()) || id;
  } catch (e) { /* no git config: keep the folder name */ }
  repoCache = { root, id };
  return id;
}

/** github.com/owner/name from any of the URL shapes git accepts. */
function normalizeRemote(url) {
  let u = String(url || '').trim();
  const scp = /^[\w.-]+@([^:/]+):(.+)$/.exec(u);
  if (scp) u = `${scp[1]}/${scp[2]}`;
  u = u.replace(/^[a-z+]+:\/\//i, '').replace(/^[^@/]+@/, '').replace(/\.git$/, '').replace(/\/+$/, '');
  return u.toLowerCase();
}

/** One event. `actor` is { kind: agent|human|cli, agent_id, agent_type }. */
function envelope(root, fields) {
  return {
    event_id: fields.event_id || crypto.randomUUID(),
    change_id: fields.change_id,
    repo: fields.repo || repoId(root),
    session_id: fields.session_id || `cli:${os.hostname()}`,
    actor: fields.actor || { kind: 'cli' },
    host: fields.host || os.hostname(),
    type: fields.type,
    ts: fields.ts || new Date().toISOString(),
    schema_version: SCHEMA_VERSION,
    payload: fields.payload || {},
  };
}

/** A stable event id derived from its source, so a backfill run twice adds nothing new. */
function stableId(...parts) {
  const h = crypto.createHash('sha1').update(parts.join('\u0000')).digest('hex');
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-5${h.slice(13, 16)}-a${h.slice(17, 20)}-${h.slice(20, 32)}`;
}

// ---------- the outbox (design D7) ----------
//
// One small file per emit in .git/workhorse/bus/outbox/, written under a temporary name and
// renamed into place, so a reader never sees half a file and no writer ever appends to a file a
// flush is reading. Names sort by time, then process, then a counter, which keeps each process's
// events in the order it wrote them.

function outboxDir(root) { return path.join(busDir(root), 'outbox'); }
let emitSeq = 0;

/** Queue events for the log. One file write, never throws, never touches the network. Returns
 *  the events, or [] when the repository does not turn the log on. */
function emit(root, events, cfg) {
  const list = Array.isArray(events) ? events : [events];
  try {
    if (!root || !list.length) return [];
    const c = cfg !== undefined ? cfg : config(root);
    if (!c) return [];
    const full = list.filter((e) => e && e.type && e.change_id).map((e) => (e.event_id && e.schema_version ? e : envelope(root, e)));
    if (!full.length) return [];
    const dir = outboxDir(root);
    fs.mkdirSync(dir, { recursive: true });
    const name = `${String(Date.now()).padStart(15, '0')}-${String(process.pid).padStart(8, '0')}-${String(emitSeq++).padStart(6, '0')}`;
    const tmp = path.join(dir, `.${name}.tmp`);
    fs.writeFileSync(tmp, full.map((e) => JSON.stringify(e)).join('\n') + '\n');
    fs.renameSync(tmp, path.join(dir, `${name}.jsonl`));
    return full;
  } catch (e) {
    return [];
  }
}

function readJsonLines(f) {
  if (!fs.existsSync(f)) return [];
  const out = [];
  for (const line of fs.readFileSync(f, 'utf8').split('\n')) {
    if (!line.trim()) continue;
    try { out.push(JSON.parse(line)); } catch (e) { /* not a whole line: skip it */ }
  }
  return out;
}

/** The outbox's files, oldest first. */
function outboxFiles(root) {
  const dir = outboxDir(root);
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir).filter((f) => f.endsWith('.jsonl') && !f.startsWith('.')).sort().map((f) => path.join(dir, f));
}

/** Events still waiting to leave this machine. */
function pending(root) { return outboxFiles(root).reduce((n, f) => n + readJsonLines(f).length, 0); }

function withTimeout(promise, ms, what) {
  let timer;
  return Promise.race([
    promise.finally(() => clearTimeout(timer)),
    new Promise((_, reject) => { timer = setTimeout(() => reject(new Error(`${what} timed out after ${ms} ms`)), ms); }),
  ]);
}

/** Send the outbox to the log, oldest first. Returns { sent, pending, error }. A lock file lets
 *  one process flush at a time; a file is deleted only after the broker acknowledged every event
 *  in it. A send that fails half-way may repeat some events next time, which every consumer
 *  drops by event id (rule 3). */
async function flush(root, opts) {
  const o = opts || {};
  const cfg = o.cfg || config(root);
  if (!cfg) return { sent: 0, pending: 0, error: null };
  const dir = busDir(root);
  const lock = path.join(dir, 'flush.lock');
  fs.mkdirSync(dir, { recursive: true });
  const deadline = Date.now() + (o.timeoutMs || 3000);
  let fd = null;
  while (fd === null) {
    try { fd = fs.openSync(lock, 'wx'); } catch (e) {
      try { if (Date.now() - fs.statSync(lock).mtimeMs > 30000) { fs.unlinkSync(lock); continue; } } catch (e2) { continue; }
      if (Date.now() > deadline) return { sent: 0, pending: pending(root), error: 'another flush holds the lock' };
      await new Promise((r) => setTimeout(r, 25));
    }
  }
  let sent = 0, error = null, t = null;
  try {
    const files = outboxFiles(root);
    if (files.length) {
      t = o.transport || transport(cfg, { timeoutMs: o.timeoutMs || 3000 });
      const parts = await withTimeout(t.partitions(cfg.topic), Math.max(deadline - Date.now(), 1), 'reading the topic');
      const byPartition = new Map();
      let total = 0;
      for (const f of files) {
        for (const ev of readJsonLines(f)) {
          const p = K.partitionFor(ev.change_id, parts.length);
          if (!byPartition.has(p)) byPartition.set(p, []);
          byPartition.get(p).push({ key: ev.change_id, value: JSON.stringify(ev), timestamp: Date.parse(ev.ts) || Date.now() });
          total++;
        }
      }
      for (const [p, recs] of byPartition) {
        await withTimeout(t.produce(cfg.topic, p, recs), Math.max(deadline - Date.now(), 1), 'sending events');
      }
      for (const f of files) fs.unlinkSync(f);
      sent = total;
    }
  } catch (e) {
    error = e.message;
  } finally {
    if (t && !o.transport) t.close();
    try { fs.closeSync(fd); fs.unlinkSync(lock); } catch (e) { /* already gone */ }
  }
  return { sent, pending: pending(root), error };
}

// ---------- consumers ----------

/** Read a JSON store file, or the empty store. */
function loadStore(file, empty) {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch (e) { return empty(); }
}

/** Replace a store file atomically, so a crash leaves the old or the new one, never half. */
function saveStore(file, store) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(store, null, 1) + '\n');
  fs.renameSync(tmp, file);
}

/**
 * Bring a consumer's store up to the end of the log. The store holds its own offsets
 * (store.meta.offsets) and is saved, with them, before the group offset is committed: a crash
 * between the two re-reads nothing and loses nothing. Each event is applied by `apply(store,
 * event, at)`; one that fails three times, or is not valid JSON, goes to the dead-letter topic
 * with the error, and the loop carries on (rule 5).
 *   opts: { cfg, transport, group, file, empty, apply, saveEvery, hooks: { afterSave } }
 */
async function catchUp(opts) {
  const { cfg, group, file, empty, apply } = opts;
  const t = opts.transport || transport(cfg, { timeoutMs: opts.timeoutMs || 3000 });
  const store = opts.store || loadStore(file, empty);
  store.meta = store.meta || {};
  store.meta.offsets = store.meta.offsets || {};
  store.meta.seen = store.meta.seen || {};
  let applied = 0, dead = 0;
  try {
    const parts = await t.partitions(cfg.topic);
    for (const { partition } of parts) {
      let off = store.meta.offsets[partition] || 0;
      for (;;) {
        const { records, highWatermark } = await t.fetch(cfg.topic, partition, off);
        if (!records.length) break;
        for (const rec of records) {
          const at = { partition, offset: rec.offset };
          let ev = null, lastErr = null;
          try { ev = JSON.parse(rec.value.toString('utf8')); } catch (e) { lastErr = e; }
          if (ev && (typeof ev !== 'object' || !ev.event_id || !ev.type)) { lastErr = new Error('not a WorkHorse event (no event_id or type)'); ev = null; }
          if (ev) {
            for (let attempt = 0; attempt < 3; attempt++) {
              try { if (apply(store, ev, at) !== false) applied++; lastErr = null; break; } catch (e) {
                lastErr = e;
                if (attempt < 2) await new Promise((r) => setTimeout(r, (opts.backoffMs || 50) * 2 ** attempt));
              }
            }
          }
          if (lastErr) {
            await deadLetter(t, cfg, group, rec, at, lastErr);
            dead++;
          }
          off = rec.offset + 1;
          store.meta.offsets[partition] = off;
        }
        if (off >= highWatermark) break;
      }
    }
    saveStore(file, store);
    if (opts.hooks && opts.hooks.afterSave) opts.hooks.afterSave(store);
    try { await t.commit(group, cfg.topic, store.meta.offsets); } catch (e) { /* lag reporting only; the store holds the truth */ }
  } finally {
    if (!opts.transport) t.close();
  }
  return { store, applied, dead };
}

/** Write a failed record to the dead-letter topic with where it came from and why. */
async function deadLetter(t, cfg, group, rec, at, err) {
  const parts = await t.partitions(cfg.deadLetter);
  const key = rec.key || '';
  const value = JSON.stringify({
    consumer: group, topic: cfg.topic, partition: at.partition, offset: at.offset,
    error: String((err && err.message) || err), at: new Date().toISOString(),
    raw: rec.value ? rec.value.toString('utf8').slice(0, 65536) : null,
  });
  await t.produce(cfg.deadLetter, K.partitionFor(key, parts.length), [{ key, value }]);
}

/** Create both topics: events kept forever (the log is the truth), and the dead-letter topic. */
async function init(cfg, t) {
  const tr = t || transport(cfg);
  try {
    const a = await tr.createTopic(cfg.topic, cfg.partitions, { 'retention.ms': '-1', 'cleanup.policy': 'delete' });
    const b = await tr.createTopic(cfg.deadLetter, 1, { 'retention.ms': '-1' });
    return { [cfg.topic]: a.created ? 'created' : 'exists', [cfg.deadLetter]: b.created ? 'created' : 'exists' };
  } finally { if (!t) tr.close(); }
}

/** Every event of the topic, in partition then offset order (for replay, metrics and tests). */
async function readAll(cfg, t, filter) {
  const out = [];
  const parts = await t.partitions(cfg.topic);
  for (const { partition } of parts) {
    let off = 0;
    for (;;) {
      const { records, highWatermark } = await t.fetch(cfg.topic, partition, off);
      if (!records.length) break;
      for (const r of records) {
        off = r.offset + 1;
        let ev; try { ev = JSON.parse(r.value.toString('utf8')); } catch (e) { continue; }
        if (!filter || filter(ev)) out.push({ ...ev, _at: { partition, offset: r.offset } });
      }
      if (off >= highWatermark) break;
    }
  }
  return out;
}

/** Consumer lag per group and the dead-letter depth: the bus's two health numbers. */
async function health(cfg, t, groups) {
  const end = await t.offsets(cfg.topic, 'latest');
  const lag = {};
  for (const g of groups) {
    try {
      const c = await t.committed(g, cfg.topic);
      lag[g] = Object.keys(end).reduce((s, p) => s + Math.max(0, end[p] - Math.max(c[p] === undefined ? -1 : c[p], 0)), 0);
    } catch (e) { lag[g] = null; }
  }
  let deadDepth = 0;
  try {
    const de = await t.offsets(cfg.deadLetter, 'latest');
    const ds = await t.offsets(cfg.deadLetter, 'earliest');
    deadDepth = Object.keys(de).reduce((s, p) => s + (de[p] - (ds[p] || 0)), 0);
  } catch (e) { deadDepth = null; }
  const events = Object.values(end).reduce((a, b) => a + b, 0);
  return { events, lag, dead_letter: deadDepth };
}

/** The consumer group name for one consumer on this machine (design D10). */
function groupName(name) { return `workhorse.${name}.${os.hostname().toLowerCase().replace(/[^a-z0-9.-]/g, '-')}`; }

module.exports = {
  SCHEMA_VERSION, DEFAULT_TOPIC, DEAD_LETTER,
  config, busDir, transport, FileLog, repoId, normalizeRemote, envelope, stableId,
  emit, flush, pending, outboxDir, outboxFiles, readJsonLines,
  loadStore, saveStore, catchUp, deadLetter, init, readAll, health, groupName, withTimeout,
};
