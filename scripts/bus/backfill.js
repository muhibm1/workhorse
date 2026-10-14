// Backfill: turn a repository's committed run records (each change's conductor-log.md and
// approvals.md) into events, so runs from before 0.6 can be measured and replayed like new ones.
// Event ids derive from the source (repository, change, row number, row text), so running a
// backfill twice adds nothing: every consumer drops the repeats.
'use strict';
const path = require('path');
const B = require('./index');

function lib() { return require(path.join(__dirname, '..', '..', 'hooks', 'scripts', 'lib.js')); }
function ledger() { return require(path.join(__dirname, '..', 'wh-ledger.js')); }

/** Events for one change's committed files ({ 'conductor-log.md': text, 'approvals.md': text, ... }). */
function eventsFor(repo, id, files) {
  const L = lib();
  const log = files['conductor-log.md'] || '';
  const rows = String(log).split(/\r?\n/).filter((line) => L.parseConductorLog(line).length);
  const first = rows.length ? L.parseConductorLog(rows[0])[0] : null;
  const tier = ledger().tierFrom(files['brief.md'], files['ship.md'], files['intent.md'], files['retro.md']);
  const finished = rows.some((r) => /^done$/i.test(L.parseConductorLog(r)[0].phase)) || Boolean(files['metrics.json']) || Boolean(files['retro.md']);
  const ts0 = first ? new Date(first.t).toISOString() : `${id.slice(0, 10)}T00:00:00.000Z`;
  const base = { repo, change_id: id, host: 'backfill', session_id: 'backfill', actor: { kind: 'cli' } };
  const out = [{ ...base, event_id: B.stableId(repo, id, 'created'), type: 'change.created', ts: ts0, payload: { title: id.slice(11).replace(/-+$/, '').replace(/-/g, ' '), tier, backfilled: true, finished } }];
  rows.forEach((row, i) => {
    const r = L.parseConductorLog(row)[0];
    out.push({ ...base, event_id: B.stableId(repo, id, 'row', String(i), row), type: 'log.row', ts: new Date(r.t).toISOString(), payload: { row: row.trim(), phase: r.phase } });
  });
  const blocks = String(files['approvals.md'] || '').split(/^## /m).slice(1);
  blocks.forEach((b, i) => {
    const head = /^(G\d): (approved|rejected)/.exec(b);
    const when = /^- When: (.*)$/m.exec(b);
    if (!head || !when || Number.isNaN(Date.parse(when[1].trim()))) return;
    const who = /^- Who: (.*)$/m.exec(b);
    const pk = /^- Packet: `([^`]+)` sha256 `([0-9a-f]{64})`/m.exec(b);
    out.push({
      ...base, actor: { kind: 'human' }, event_id: B.stableId(repo, id, 'gate', String(i), head[0], when[1].trim()),
      type: `gate.${head[2]}`, ts: new Date(Date.parse(when[1].trim())).toISOString(),
      payload: { gate: head[1], by: who ? who[1].trim() : null, packet: pk ? pk[1] : null, sha256: pk ? pk[2] : null, bytes: null, backfilled: true },
    });
  });
  if (finished) out.push({ ...base, event_id: B.stableId(repo, id, 'done'), type: 'phase.started', ts: out.reduce((m, e) => (e.ts > m ? e.ts : m), ts0), payload: { phase: 'done', backfilled: true } });
  return out.map((e) => ({ ...e, schema_version: B.SCHEMA_VERSION }));
}

/** Events for every change of a repository at a git ref. */
function eventsForRepo(repoPath, ref, only) {
  const changes = ledger().readChanges(repoPath, ref || 'HEAD');
  const repo = B.repoId(repoPath);
  const out = [];
  for (const id of Object.keys(changes).sort()) {
    if (only && id !== only) continue;
    if (!changes[id]['conductor-log.md']) continue;
    out.push(...eventsFor(repo, id, changes[id]));
  }
  return out;
}

module.exports = { eventsFor, eventsForRepo };
