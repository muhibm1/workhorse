// The Studbook streaming indexer: reads `doc.written` and `doc.decided` events for this
// repository and refreshes just those documents in Studbook's local record, through Studbook's
// own per-document entry point (`python -m localrecord.sync --repo <name>=<path> --only <path>`).
// That entry point runs the same parse, chunk and embed steps as a full sync, so the record it
// leaves equals the one a full sync would; Studbook's parity test checks this row for row.
// Phase 2 of the event-bus design (0.6.1).
//
// At-least-once: paths read from the log wait in the store's `pending` list until Studbook
// reports success, so a crash or a failed run is retried on the next pass. Re-indexing a path
// that did not change embeds nothing.
'use strict';
const path = require('path');
const { spawnSync } = require('child_process');
const B = require('./index');

const GROUP = 'index';
const SETTLE_MS = 2000;

function lib() { return require(path.join(__dirname, '..', '..', 'hooks', 'scripts', 'lib.js')); }
function storeFile(root) { return path.join(B.busDir(root), 'index.json'); }
function empty() { return { schema: 1, meta: { offsets: {}, seen: {} }, pending: {}, runs: 0, last: null }; }

/** The indexer's settings from the profile's `bus:` block, or null when no Studbook is named. */
function settings(root, profile) {
  let p = profile;
  if (p === undefined) { try { p = lib().loadProfile(root); } catch (e) { p = null; } }
  const b = (p && p.bus) || {};
  if (!b.studbook) return null;
  const dir = path.resolve(root, String(b.studbook));
  const python = b.studbook_python
    ? path.resolve(root, String(b.studbook_python))
    : path.join(dir, '.venv', process.platform === 'win32' ? 'Scripts/python.exe' : 'bin/python');
  const name = String(b.studbook_repo || path.basename(root)).toLowerCase();
  return { dir, python, name, db: b.studbook_db ? path.resolve(root, String(b.studbook_db)) : null };
}

/** A record path from an event, when the event names a document of a change; else null. */
function pathOf(ev) {
  const p = ev.payload || {};
  const rel = ev.type === 'doc.written' ? p.path : ev.type === 'doc.decided' ? p.packet : null;
  return typeof rel === 'string' && /^docs\/sdlc\/[^/]+\/.+\.md$/.test(rel) && !rel.includes('..') ? rel : null;
}

/** Remember a document event of this repository as pending; every other event is only marked seen. */
function applyFor(repo) {
  return (store, ev) => {
    if (store.meta.seen[ev.event_id]) return false;
    store.meta.seen[ev.event_id] = 1;
    store.pending = store.pending || {};
    const rel = ev.repo === repo ? pathOf(ev) : null;
    if (!rel) return false;
    if (!store.pending[rel] || ev.ts > store.pending[rel]) store.pending[rel] = ev.ts;
    return true;
  };
}

/** The argument list Studbook's entry point takes for these paths. */
function command(s, root, paths) {
  const args = ['-m', 'localrecord.sync', '--repo', `${s.name}=${root}`];
  for (const p of paths) args.push('--only', p);
  if (s.db) args.push('--db', s.db);
  return args;
}

/** Read the log, then index every pending path whose last event is older than the settle time. */
async function run(root, opts) {
  const o = opts || {};
  const cfg = o.cfg || B.config(root);
  if (!cfg) throw new Error('the event log is not configured for this repository');
  const s = o.settings || settings(root);
  if (!s) throw new Error('no Studbook is named: add `studbook: <path to the studbook checkout>` to the `bus:` block');
  const file = o.file || storeFile(root);
  const { store, applied, dead } = await B.catchUp({ cfg, transport: o.transport, group: B.groupName(GROUP), file, empty, apply: applyFor(B.repoId(root)), timeoutMs: o.timeoutMs });
  const now = o.now || Date.now();
  const settle = o.settleMs === undefined ? SETTLE_MS : o.settleMs;
  const due = Object.keys(store.pending || {}).filter((p) => now - Date.parse(store.pending[p]) >= settle).sort();
  const result = { applied, dead, indexed: [], waiting: Object.keys(store.pending || {}).length - due.length, error: null };
  if (!due.length) return result;
  const r = spawnSync(s.python, command(s, root, due), { cwd: s.dir, encoding: 'utf8', timeout: o.timeoutMsIndex || 600000, windowsHide: true });
  store.runs = (store.runs || 0) + 1;
  if (r.status === 0) {
    for (const p of due) delete store.pending[p];
    result.indexed = due;
    store.last = { at: new Date().toISOString(), paths: due.length, ok: true };
  } else {
    result.error = (r.error && r.error.message) || String(r.stderr || '').trim().split('\n').slice(-3).join(' ') || `exit ${r.status}`;
    store.last = { at: new Date().toISOString(), paths: due.length, ok: false, error: result.error };
  }
  B.saveStore(file, store);
  result.waiting = Object.keys(store.pending).length;
  return result;
}

module.exports = { GROUP, SETTLE_MS, storeFile, empty, settings, pathOf, applyFor, command, run };
