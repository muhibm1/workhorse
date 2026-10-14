// A small Kafka protocol client for WorkHorse's event log. Zero dependencies, Node 18+.
//
// It speaks the real Kafka binary protocol, so it works unchanged against Redpanda and Apache
// Kafka. It implements only what WorkHorse uses, in the pre-"flexible" API versions every broker
// since Kafka 0.11 accepts: Metadata v1, CreateTopics v0, Produce v3 (record batch format v2,
// CRC-32C), Fetch v4, ListOffsets v1, FindCoordinator v0, OffsetCommit v2 and OffsetFetch v1.
// Not implemented, and refused loudly when met: compressed batches, transactions, SASL and TLS.
// Design: docs/superpowers/specs/2026-10-14-event-bus-design.md, decision D1.
'use strict';
const net = require('net');

const API = { Produce: 0, Fetch: 1, ListOffsets: 2, Metadata: 3, OffsetCommit: 8, OffsetFetch: 9, FindCoordinator: 10, CreateTopics: 19 };
const ERRORS = {
  1: 'OFFSET_OUT_OF_RANGE', 2: 'CORRUPT_MESSAGE', 3: 'UNKNOWN_TOPIC_OR_PARTITION', 5: 'LEADER_NOT_AVAILABLE',
  6: 'NOT_LEADER_FOR_PARTITION', 7: 'REQUEST_TIMED_OUT', 14: 'COORDINATOR_LOAD_IN_PROGRESS',
  15: 'COORDINATOR_NOT_AVAILABLE', 16: 'NOT_COORDINATOR', 25: 'UNKNOWN_MEMBER_ID', 36: 'TOPIC_ALREADY_EXISTS',
  37: 'INVALID_PARTITIONS', 38: 'INVALID_REPLICATION_FACTOR',
};
const RETRIABLE = new Set([5, 6, 7, 14, 15, 16]);

class KafkaError extends Error {
  constructor(code, where) {
    super(`${where}: ${ERRORS[code] || 'error'} (${code})`);
    this.code = code;
    this.retriable = RETRIABLE.has(code);
  }
}

// ---------- CRC-32C (Castagnoli), as record batch v2 requires ----------

const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let i = 0; i < 256; i++) {
    let c = i;
    for (let k = 0; k < 8; k++) c = c & 1 ? (c >>> 1) ^ 0x82f63b78 : c >>> 1;
    t[i] = c >>> 0;
  }
  return t;
})();

/** CRC-32C of a buffer, as an unsigned 32-bit number. */
function crc32c(buf) {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

// ---------- the default partitioner (murmur2, as the Java client computes it) ----------

/** Kafka's murmur2 hash of a key, as a signed 32-bit number. */
function murmur2(data) {
  const buf = Buffer.isBuffer(data) ? data : Buffer.from(String(data), 'utf8');
  const m = 0x5bd1e995, r = 24, len = buf.length;
  let h = (0x9747b28c ^ len) | 0;
  const n4 = len >> 2;
  for (let i = 0; i < n4; i++) {
    const o = i * 4;
    let k = (buf[o] & 0xff) | ((buf[o + 1] & 0xff) << 8) | ((buf[o + 2] & 0xff) << 16) | ((buf[o + 3] & 0xff) << 24);
    k = Math.imul(k, m);
    k ^= k >>> r;
    k = Math.imul(k, m);
    h = Math.imul(h, m);
    h ^= k;
  }
  const tail = len & ~3;
  switch (len % 4) {
    case 3: h ^= (buf[tail + 2] & 0xff) << 16; // falls through
    case 2: h ^= (buf[tail + 1] & 0xff) << 8; // falls through
    case 1: h ^= buf[tail] & 0xff; h = Math.imul(h, m);
  }
  h ^= h >>> 13;
  h = Math.imul(h, m);
  h ^= h >>> 15;
  return h | 0;
}

/** The partition the Java client would pick for a key. */
function partitionFor(key, count) {
  return (murmur2(key) & 0x7fffffff) % count;
}

// ---------- encoding ----------

class Writer {
  constructor() { this.parts = []; }
  int8(v) { const b = Buffer.alloc(1); b.writeInt8(v); this.parts.push(b); return this; }
  int16(v) { const b = Buffer.alloc(2); b.writeInt16BE(v); this.parts.push(b); return this; }
  int32(v) { const b = Buffer.alloc(4); b.writeInt32BE(v); this.parts.push(b); return this; }
  uint32(v) { const b = Buffer.alloc(4); b.writeUInt32BE(v >>> 0); this.parts.push(b); return this; }
  int64(v) { const b = Buffer.alloc(8); b.writeBigInt64BE(BigInt(v)); this.parts.push(b); return this; }
  string(s) {
    if (s === null || s === undefined) return this.int16(-1);
    const b = Buffer.from(String(s), 'utf8');
    return this.int16(b.length).raw(b);
  }
  bytes(b) { if (b === null || b === undefined) return this.int32(-1); return this.int32(b.length).raw(b); }
  raw(b) { this.parts.push(b); return this; }
  array(items, fn) {
    if (items === null) return this.int32(-1);
    this.int32(items.length);
    for (const it of items) fn(this, it);
    return this;
  }
  varint(n) { return this.raw(encodeVarint(zigzag(n))); }
  buffer() { return Buffer.concat(this.parts); }
}

function zigzag(n) { return n >= 0 ? n * 2 : -n * 2 - 1; }
function unzigzag(n) { return n % 2 === 0 ? n / 2 : -(n + 1) / 2; }

/** Unsigned LEB128 of a non-negative safe integer. */
function encodeVarint(u) {
  const out = [];
  while (u >= 0x80) { out.push((u % 0x80) | 0x80); u = Math.floor(u / 0x80); }
  out.push(u);
  return Buffer.from(out);
}

class Reader {
  constructor(buf, off) { this.buf = buf; this.off = off || 0; }
  int8() { const v = this.buf.readInt8(this.off); this.off += 1; return v; }
  int16() { const v = this.buf.readInt16BE(this.off); this.off += 2; return v; }
  int32() { const v = this.buf.readInt32BE(this.off); this.off += 4; return v; }
  uint32() { const v = this.buf.readUInt32BE(this.off); this.off += 4; return v; }
  int64() { const v = this.buf.readBigInt64BE(this.off); this.off += 8; return Number(v); }
  string() { const n = this.int16(); if (n < 0) return null; const s = this.buf.toString('utf8', this.off, this.off + n); this.off += n; return s; }
  bytes() { const n = this.int32(); if (n < 0) return null; const b = this.buf.subarray(this.off, this.off + n); this.off += n; return b; }
  bool() { return this.int8() !== 0; }
  array(fn) { const n = this.int32(); if (n < 0) return null; const out = []; for (let i = 0; i < n; i++) out.push(fn(this)); return out; }
  uvarint() {
    let result = 0, mult = 1, b;
    do {
      if (this.off >= this.buf.length) throw new Error('varint runs past the end of the buffer');
      b = this.buf[this.off++];
      result += (b & 0x7f) * mult;
      mult *= 0x80;
    } while (b & 0x80);
    return result;
  }
  varint() { return unzigzag(this.uvarint()); }
}

// ---------- record batches (magic 2) ----------

/** One uncompressed record batch holding `records` ({key, value, timestamp}). */
function encodeRecordBatch(records) {
  const base = records.length ? records[0].timestamp : Date.now();
  let max = base;
  const recBufs = records.map((r, i) => {
    if (r.timestamp > max) max = r.timestamp;
    const key = r.key === null || r.key === undefined ? null : Buffer.from(String(r.key), 'utf8');
    const value = Buffer.isBuffer(r.value) ? r.value : Buffer.from(String(r.value), 'utf8');
    const body = new Writer()
      .int8(0)
      .varint(r.timestamp - base)
      .varint(i);
    if (key) body.varint(key.length).raw(key); else body.varint(-1);
    body.varint(value.length).raw(value).varint(0); // no headers
    const b = body.buffer();
    return Buffer.concat([encodeVarint(zigzag(b.length)), b]);
  });
  const afterCrc = new Writer()
    .int16(0) // attributes: no compression, create time, not transactional
    .int32(records.length - 1)
    .int64(base)
    .int64(max)
    .int64(-1).int16(-1).int32(-1) // no idempotent producer
    .int32(records.length)
    .raw(Buffer.concat(recBufs))
    .buffer();
  const crc = crc32c(afterCrc);
  const tail = new Writer().int32(-1).int8(2).uint32(crc).raw(afterCrc).buffer();
  return new Writer().int64(0).int32(tail.length).raw(tail).buffer();
}

/** Every record in a fetched record set, with absolute offsets. A partial batch at the end (the
 *  broker cuts at max_bytes) is skipped; the next fetch starts from it. */
function decodeRecordSet(buf) {
  const out = [];
  let off = 0;
  while (off + 12 <= buf.length) {
    const baseOffset = Number(buf.readBigInt64BE(off));
    const batchLength = buf.readInt32BE(off + 8);
    const end = off + 12 + batchLength;
    if (end > buf.length) break;
    const r = new Reader(buf, off + 12);
    r.int32(); // partition leader epoch
    const magic = r.int8();
    if (magic !== 2) throw new Error(`record batch magic ${magic} is not supported (only 2)`);
    const crc = r.uint32();
    if (crc32c(buf.subarray(r.off, end)) !== crc) throw new Error(`record batch at offset ${baseOffset} failed its CRC check`);
    const attributes = r.int16();
    if (attributes & 0x07) throw new Error('compressed record batches are not supported; WorkHorse never writes them');
    r.int32(); // last offset delta
    const baseTimestamp = r.int64();
    r.int64(); r.int64(); r.int16(); r.int32(); // max timestamp, producer id, epoch, base sequence
    const count = r.int32();
    const control = Boolean(attributes & 0x20);
    for (let i = 0; i < count; i++) {
      r.varint(); // record length
      r.int8(); // attributes
      const tsDelta = r.varint();
      const offDelta = r.varint();
      const kl = r.varint();
      const key = kl < 0 ? null : buf.toString('utf8', r.off, r.off + kl); if (kl > 0) r.off += kl;
      const vl = r.varint();
      const value = vl < 0 ? null : buf.subarray(r.off, r.off + vl); if (vl > 0) r.off += vl;
      const hc = r.varint();
      for (let h = 0; h < hc; h++) { const hk = r.varint(); r.off += Math.max(hk, 0); const hv = r.varint(); r.off += Math.max(hv, 0); }
      if (!control) out.push({ offset: baseOffset + offDelta, timestamp: baseTimestamp + tsDelta, key, value });
    }
    off = end;
  }
  return out;
}

// ---------- one broker connection ----------

class Connection {
  constructor(host, port, opts) {
    this.host = host; this.port = port;
    this.timeoutMs = (opts && opts.timeoutMs) || 5000;
    this.clientId = (opts && opts.clientId) || 'workhorse';
    this.correlation = 0;
    this.pending = new Map();
    this.buf = Buffer.alloc(0);
    this.socket = null;
    this.ready = null;
  }

  connect() {
    if (this.ready) return this.ready;
    this.ready = new Promise((resolve, reject) => {
      const s = net.connect({ host: this.host, port: this.port });
      const timer = setTimeout(() => { s.destroy(); reject(new Error(`could not reach the broker at ${this.host}:${this.port} (timed out)`)); }, this.timeoutMs);
      s.once('connect', () => { clearTimeout(timer); s.setNoDelay(true); resolve(this); });
      s.on('error', (e) => { clearTimeout(timer); this.failAll(e); reject(new Error(`could not reach the broker at ${this.host}:${this.port} (${e.code || e.message})`)); });
      s.on('close', () => this.failAll(new Error('the broker closed the connection')));
      s.on('data', (d) => this.onData(d));
      this.socket = s;
    });
    return this.ready;
  }

  onData(d) {
    this.buf = this.buf.length ? Buffer.concat([this.buf, d]) : d;
    while (this.buf.length >= 4) {
      const size = this.buf.readInt32BE(0);
      if (this.buf.length < 4 + size) break;
      const frame = this.buf.subarray(4, 4 + size);
      this.buf = this.buf.subarray(4 + size);
      const id = frame.readInt32BE(0);
      const p = this.pending.get(id);
      if (!p) continue;
      this.pending.delete(id);
      clearTimeout(p.timer);
      try { p.resolve(p.parse(new Reader(frame, 4))); } catch (e) { p.reject(e); }
    }
  }

  failAll(err) {
    for (const [, p] of this.pending) { clearTimeout(p.timer); p.reject(err); }
    this.pending.clear();
  }

  async request(apiKey, version, body, parse) {
    await this.connect();
    const id = ++this.correlation;
    const header = new Writer().int16(apiKey).int16(version).int32(id).string(this.clientId).buffer();
    const msg = Buffer.concat([header, body]);
    const frame = Buffer.concat([new Writer().int32(msg.length).buffer(), msg]);
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`the broker at ${this.host}:${this.port} did not answer within ${this.timeoutMs} ms`));
      }, this.timeoutMs + 1000);
      this.pending.set(id, { resolve, reject, parse, timer });
      this.socket.write(frame);
    });
  }

  close() { if (this.socket) this.socket.destroy(); this.socket = null; this.ready = null; }
}

// ---------- the client ----------

function parseBrokers(list) {
  return String(list || '').split(',').map((s) => s.trim()).filter(Boolean).map((hp) => {
    const i = hp.lastIndexOf(':');
    return i > 0 ? { host: hp.slice(0, i), port: Number(hp.slice(i + 1)) } : { host: hp, port: 9092 };
  });
}

class Client {
  /** opts: { brokers: "host:port,...", clientId, timeoutMs } */
  constructor(opts) {
    this.seeds = parseBrokers(opts.brokers);
    if (!this.seeds.length) throw new Error('no broker address given');
    this.opts = { clientId: opts.clientId || 'workhorse', timeoutMs: opts.timeoutMs || 5000 };
    this.conns = new Map();
    this.nodes = new Map();
    this.topics = new Map();
  }

  conn(host, port) {
    const k = `${host}:${port}`;
    if (!this.conns.has(k)) this.conns.set(k, new Connection(host, port, this.opts));
    return this.conns.get(k);
  }

  async any() {
    let last;
    for (const s of this.seeds) {
      const c = this.conn(s.host, s.port);
      try { await c.connect(); return c; } catch (e) { last = e; this.conns.delete(`${s.host}:${s.port}`); }
    }
    throw last;
  }

  /** Brokers and partition leaders for `topics` (all topics when null). */
  async metadata(topics) {
    const c = await this.any();
    const body = new Writer().array(topics, (w, t) => w.string(t)).buffer();
    const md = await c.request(API.Metadata, 1, body, (r) => {
      const brokers = r.array((x) => ({ node: x.int32(), host: x.string(), port: x.int32(), rack: x.string() }));
      const controller = r.int32();
      const ts = r.array((x) => ({
        error: x.int16(), name: x.string(), internal: x.bool(),
        partitions: x.array((y) => ({ error: y.int16(), partition: y.int32(), leader: y.int32(), replicas: y.array((z) => z.int32()), isr: y.array((z) => z.int32()) })),
      }));
      return { brokers, controller, topics: ts };
    });
    for (const b of md.brokers) this.nodes.set(b.node, b);
    for (const t of md.topics) if (t.error === 0) this.topics.set(t.name, t.partitions.slice().sort((a, b) => a.partition - b.partition));
    return md;
  }

  async partitions(topic) {
    if (!this.topics.has(topic)) {
      const md = await this.metadata([topic]);
      const t = md.topics.find((x) => x.name === topic);
      if (!t || t.error) throw new KafkaError(t ? t.error : 3, `topic ${topic}`);
    }
    return this.topics.get(topic);
  }

  async leader(topic, partition) {
    const ps = await this.partitions(topic);
    const p = ps.find((x) => x.partition === partition);
    if (!p) throw new KafkaError(3, `${topic}[${partition}]`);
    const n = this.nodes.get(p.leader);
    if (!n) throw new KafkaError(5, `${topic}[${partition}]`);
    return this.conn(n.host, n.port);
  }

  async createTopic(name, partitions, configs) {
    const c = await this.any();
    const cfg = Object.entries(configs || {});
    const body = new Writer()
      .array([name], (w, t) => w.string(t).int32(partitions).int16(1).int32(0)
        .array(cfg, (w2, [k, v]) => w2.string(k).string(String(v))))
      .int32(this.opts.timeoutMs)
      .buffer();
    const res = await c.request(API.CreateTopics, 0, body, (r) => r.array((x) => ({ name: x.string(), error: x.int16() })));
    const e = res[0] && res[0].error;
    this.topics.delete(name);
    if (e === 36) return { created: false, exists: true };
    if (e) throw new KafkaError(e, `create topic ${name}`);
    return { created: true, exists: false };
  }

  /** Write records ({key, value, timestamp?}) to one partition. Returns the first offset. */
  async produce(topic, partition, records) {
    const now = Date.now();
    const batch = encodeRecordBatch(records.map((r) => ({ ...r, timestamp: r.timestamp || now })));
    for (let attempt = 0; ; attempt++) {
      const c = await this.leader(topic, partition);
      const body = new Writer()
        .string(null).int16(-1).int32(this.opts.timeoutMs)
        .array([topic], (w, t) => w.string(t).array([partition], (w2, p) => w2.int32(p).bytes(batch)))
        .buffer();
      const res = await c.request(API.Produce, 3, body, (r) => r.array((x) => ({
        name: x.string(), partitions: x.array((y) => ({ partition: y.int32(), error: y.int16(), base: y.int64(), logAppendTime: y.int64() })),
      })));
      const p = res[0].partitions[0];
      if (p.error === 0) return p.base;
      const err = new KafkaError(p.error, `produce ${topic}[${partition}]`);
      if (!err.retriable || attempt >= 2) throw err;
      this.topics.delete(topic);
      await new Promise((r) => setTimeout(r, 100 * 2 ** attempt));
    }
  }

  /** Records of one partition from `offset`, up to `maxBytes`. Returns { records, highWatermark }. */
  async fetch(topic, partition, offset, opts) {
    const o = opts || {};
    const c = await this.leader(topic, partition);
    const body = new Writer()
      .int32(-1).int32(o.maxWaitMs || 0).int32(o.minBytes || 0).int32(o.maxBytes || 4 * 1024 * 1024).int8(0)
      .array([topic], (w, t) => w.string(t).array([partition], (w2, p) => w2.int32(p).int64(offset).int32(o.maxBytes || 4 * 1024 * 1024)))
      .buffer();
    const res = await c.request(API.Fetch, 4, body, (r) => {
      r.int32(); // throttle
      return r.array((x) => ({
        name: x.string(),
        partitions: x.array((y) => ({
          partition: y.int32(), error: y.int16(), highWatermark: y.int64(), lastStable: y.int64(),
          aborted: y.array((z) => ({ producer: z.int64(), first: z.int64() })),
          records: y.bytes(),
        })),
      }));
    });
    const p = res[0].partitions[0];
    if (p.error) throw new KafkaError(p.error, `fetch ${topic}[${partition}]@${offset}`);
    const records = p.records ? decodeRecordSet(p.records).filter((r) => r.offset >= offset) : [];
    return { records, highWatermark: p.highWatermark };
  }

  /** Earliest (-2) or latest (-1) offset of each partition: { [partition]: offset }. */
  async offsets(topic, which) {
    const ps = await this.partitions(topic);
    const byLeader = new Map();
    for (const p of ps) {
      const n = this.nodes.get(p.leader);
      const k = `${n.host}:${n.port}`;
      if (!byLeader.has(k)) byLeader.set(k, { conn: this.conn(n.host, n.port), parts: [] });
      byLeader.get(k).parts.push(p.partition);
    }
    const out = {};
    for (const { conn, parts } of byLeader.values()) {
      const body = new Writer().int32(-1)
        .array([topic], (w, t) => w.string(t).array(parts, (w2, p) => w2.int32(p).int64(which === 'earliest' ? -2 : -1)))
        .buffer();
      const res = await conn.request(API.ListOffsets, 1, body, (r) => r.array((x) => ({
        name: x.string(), partitions: x.array((y) => ({ partition: y.int32(), error: y.int16(), timestamp: y.int64(), offset: y.int64() })),
      })));
      for (const p of res[0].partitions) {
        if (p.error) throw new KafkaError(p.error, `list offsets ${topic}[${p.partition}]`);
        out[p.partition] = p.offset;
      }
    }
    return out;
  }

  async coordinator(group) {
    for (let attempt = 0; ; attempt++) {
      const c = await this.any();
      const res = await c.request(API.FindCoordinator, 0, new Writer().string(group).buffer(), (r) => ({ error: r.int16(), node: r.int32(), host: r.string(), port: r.int32() }));
      if (res.error === 0) return this.conn(res.host, res.port);
      if (!RETRIABLE.has(res.error) || attempt >= 4) throw new KafkaError(res.error, `find coordinator for ${group}`);
      await new Promise((r) => setTimeout(r, 200 * 2 ** attempt));
    }
  }

  /** Commit positions for a group without joining it (Kafka's "simple consumer" commit). */
  async commit(group, topic, positions) {
    const parts = Object.entries(positions).map(([p, o]) => ({ p: Number(p), o }));
    if (!parts.length) return;
    const body = new Writer().string(group).int32(-1).string('').int64(-1)
      .array([topic], (w, t) => w.string(t).array(parts, (w2, x) => w2.int32(x.p).int64(x.o).string(null)))
      .buffer();
    for (let attempt = 0; ; attempt++) {
      const c = await this.coordinator(group);
      const res = await c.request(API.OffsetCommit, 2, body, (r) => r.array((x) => ({ name: x.string(), partitions: x.array((y) => ({ partition: y.int32(), error: y.int16() })) })));
      const bad = res[0].partitions.find((p) => p.error);
      if (!bad) return;
      const err = new KafkaError(bad.error, `commit ${group} ${topic}[${bad.partition}]`);
      // A new group's coordinator can take a moment to load; NOT_COORDINATOR is the broker saying so.
      if (!err.retriable || attempt >= 5) throw err;
      await new Promise((r) => setTimeout(r, 200 * 2 ** attempt));
    }
  }

  /** Committed positions of a group: { [partition]: offset } (-1 when none). */
  async committed(group, topic) {
    const ps = await this.partitions(topic);
    const body = new Writer().string(group).array([topic], (w, t) => w.string(t).array(ps.map((p) => p.partition), (w2, p) => w2.int32(p))).buffer();
    for (let attempt = 0; ; attempt++) {
      const c = await this.coordinator(group);
      const res = await c.request(API.OffsetFetch, 1, body, (r) => r.array((x) => ({
        name: x.string(), partitions: x.array((y) => ({ partition: y.int32(), offset: y.int64(), metadata: y.string(), error: y.int16() })),
      })));
      const bad = res[0].partitions.find((p) => p.error);
      if (bad && RETRIABLE.has(bad.error) && attempt < 5) { await new Promise((r) => setTimeout(r, 200 * 2 ** attempt)); continue; }
      if (bad) throw new KafkaError(bad.error, `committed offsets of ${group}`);
      const out = {};
      for (const p of res[0].partitions) out[p.partition] = p.offset;
      return out;
    }
  }

  close() { for (const c of this.conns.values()) c.close(); this.conns.clear(); }
}

module.exports = { Client, KafkaError, crc32c, murmur2, partitionFor, encodeRecordBatch, decodeRecordSet, parseBrokers, encodeVarint, zigzag };
