// `wh.js bus ...`: the event log's command line (0.6). Every subcommand needs a `bus:` block in
// .workhorse/profile.yml (or WORKHORSE_BUS_BROKERS), except `help`.
//
//   bus init                         create workhorse.events (kept forever) and the dead-letter topic
//   bus status [--json]              broker, event count, this machine's outbox, consumer lag, dead letters
//   bus flush [--json]               send the outbox now
//   bus gate <G> [--change id] [--json]
//                                    ask the log whether a gate is open (exit 0 open, 3 closed)
//   bus gates [--change id] [--json] every gate decision the log holds for a change
//   bus restore [<id> | --from-branch] [--quiet]
//                                    rebuild a change's control state on this machine from the log
//   bus rebuild <approvals|metrics>  delete a consumer's store and rebuild it from the start of the log
//   bus metrics [--change id] [--all-repos] [--json] [--follow]
//                                    timings for every change, from the log (Phase 3)
//   bus replay <id> [--until <iso>|@<offset>] [--into <dir>] [--json]
//                                    one change's history, printed or re-materialized (Phase 4)
//   bus backfill --repo <path>[#<ref>] [--change <id>] [--dry-run]
//                                    turn committed run records into events (runs from before 0.6)
//   bus tail [--n 20]                the latest events of the current repository
//   bus index [--follow] [--json]    refresh written documents in Studbook's local record (Phase 2)
'use strict';
const fs = require('fs');
const path = require('path');
const B = require('./index');
const P = require('./projector');
const M = require('./metrics');
const R = require('./replay');
const F = require('./backfill');
const I = require('./indexer');

function lib() { return require(path.join(__dirname, '..', '..', 'hooks', 'scripts', 'lib.js')); }

function takeFlag(args, name) {
  const i = args.indexOf(name);
  if (i < 0) return null;
  const v = args[i + 1];
  args.splice(i, v === undefined || v.startsWith('--') ? 1 : 2);
  return v === undefined || v.startsWith('--') ? true : v;
}
function hasFlag(args, name) { const i = args.indexOf(name); if (i < 0) return false; args.splice(i, 1); return true; }
function print(x) { process.stdout.write(typeof x === 'string' ? x + '\n' : JSON.stringify(x, null, 2) + '\n'); }
function fail(msg, code) { process.stderr.write(`wh bus: ${msg}\n`); return code || 1; }

function hm(m) {
  if (m === null || m === undefined) return '–';
  const n = Math.round(m);
  return n >= 60 ? `${Math.floor(n / 60)} h ${String(n % 60).padStart(2, '0')} m` : `${n} m`;
}

function changeFrom(root, args) {
  const c = takeFlag(args, '--change');
  return typeof c === 'string' ? c : lib().activeChangeId(root);
}

async function main(argv) {
  const args = argv.slice();
  const sub = args.shift();
  if (!sub || sub === 'help' || sub === '--help') {
    print(fs.readFileSync(__filename, 'utf8').split('\n').filter((l) => l.startsWith('//')).slice(0, 22).map((l) => l.slice(3)).join('\n'));
    return 0;
  }
  const L = lib();
  const root = L.findRoot(process.cwd());
  if (!root) return fail('not inside a WorkHorse repo (no .workhorse/profile.yml found)');
  const cfg = B.config(root);
  if (!cfg) return fail('the event log is off for this repository: add a `bus:` block to .workhorse/profile.yml (see examples/bus/README.md)', 2);
  const json = hasFlag(args, '--json');

  switch (sub) {
    case 'init': {
      const r = await B.init(cfg);
      print(json ? r : Object.entries(r).map(([t, s]) => `${t}: ${s}`).join('\n'));
      return 0;
    }

    case 'flush': {
      const r = await B.flush(root, { cfg, timeoutMs: 10000 });
      print(json ? r : `sent ${r.sent}, still queued ${r.pending}${r.error ? ` (${r.error})` : ''}`);
      return r.error ? 1 : 0;
    }

    case 'status': {
      const t = B.transport(cfg);
      const out = { brokers: cfg.brokers, topic: cfg.topic, outbox: B.pending(root) };
      try {
        const groups = [B.groupName(P.GROUP), B.groupName(M.GROUP)];
        Object.assign(out, { reachable: true }, await B.withTimeout(B.health(cfg, t, groups), 5000, 'reading the log'));
      } catch (e) {
        Object.assign(out, { reachable: false, error: e.message });
      } finally { t.close(); }
      if (json) { print(out); return out.reachable ? 0 : 1; }
      print([
        `Event log: ${cfg.brokers} (${out.reachable ? 'reachable' : `UNREACHABLE: ${out.error}`})`,
        `Topic: ${cfg.topic}${out.reachable ? `, ${out.events} events` : ''}`,
        `This machine's outbox: ${out.outbox} event${out.outbox === 1 ? '' : 's'} waiting to be sent`,
        ...(out.reachable ? Object.entries(out.lag).map(([g, n]) => `Consumer ${g}: ${n === null ? 'no position yet' : `${n} behind`}`) : []),
        ...(out.reachable ? [`Dead letters: ${out.dead_letter === null ? 'topic missing (run wh.js bus init)' : out.dead_letter}`] : []),
      ].join('\n'));
      return out.reachable ? 0 : 1;
    }

    case 'gate': {
      const g = args.shift();
      const id = changeFrom(root, args);
      if (!/^G[1-5]$/.test(String(g)) || !id) return fail('usage: wh.js bus gate <G1..G5> [--change <id>] [--json]');
      const r = await P.gateCheck(root, id, g, { cfg });
      const res = { gate: g, change_id: id, open: r.open, reason: r.reason };
      print(json ? res : `${g} ${r.open ? 'OPEN' : 'CLOSED'}: ${r.reason}`);
      return r.open ? 0 : 3;
    }

    case 'gates': {
      const id = changeFrom(root, args);
      const { store } = await P.catchUp(root, { cfg });
      const repo = B.repoId(root);
      const rows = Object.values(store.changes).filter((c) => c.repo === repo && (!id || c.change_id === id));
      if (json) { print(rows.map((c) => ({ change_id: c.change_id, gates: c.gates, ignored: c.ignored }))); return 0; }
      if (!rows.length) { print(`the event log has no gate decisions for ${id || repo}`); return 0; }
      for (const c of rows) {
        print(`${c.change_id}`);
        for (const [g, r] of Object.entries(c.gates)) print(`  ${g} ${r.status} by ${r.by || '?'} at ${r.at}${r.host ? ` on ${r.host}` : ''}${r.sha256 ? `, packet ${r.packet} sha256 ${r.sha256.slice(0, 12)}${r.bytes !== null ? ` (${r.bytes} bytes)` : ''}` : ''}${r.void_reason ? ` (voided: ${r.void_reason})` : ''}`);
        for (const x of c.ignored) print(`  ignored ${x.gate} ${x.event_id}: ${x.reason}`);
      }
      return 0;
    }

    case 'restore': {
      const quiet = hasFlag(args, '--quiet');
      const fromBranch = hasFlag(args, '--from-branch');
      const force = hasFlag(args, '--force');
      let id = args.shift();
      if (fromBranch || !id) {
        const profile = L.loadProfile(root);
        const prefix = (profile.conventions && profile.conventions.branch_prefix) || 'wh/';
        const branch = L.git(root, ['branch', '--show-current']);
        if (!id && branch.startsWith(prefix)) id = branch.slice(prefix.length);
      }
      if (!id) return fail('usage: wh.js bus restore <change-id> (or run it on the change branch with --from-branch)');
      if (L.loadState(root, id) && !force) {
        if (!quiet) print(`${id} already has control state on this machine; pass --force to replace it from the log`);
        return 0;
      }
      let r;
      try { r = await P.restore(root, id, { cfg }); } catch (e) { return fail(`could not read the event log: ${e.message}`); }
      if (json) print(r);
      else if (!quiet || r.restored) print(r.restored ? `Restored ${id} from the event log: phase ${r.phase}, gates ${Object.entries(r.gates).map(([g, s]) => `${g}=${s}`).join(' ')} (last saved on ${r.from_host || 'unknown'} at ${r.snapshot_at}).` : r.reason);
      return r.restored ? 0 : 4;
    }

    case 'rebuild': {
      const which = args.shift();
      const mod = which === 'approvals' ? P : which === 'metrics' ? M : null;
      if (!mod) return fail('usage: wh.js bus rebuild <approvals|metrics> (the index store is rebuilt by deleting .git/workhorse/bus/index.json)');
      try { fs.unlinkSync(mod.storeFile(root)); } catch (e) { /* nothing to delete */ }
      const t0 = Date.now();
      const { store, applied, dead } = await mod.catchUp(root, { cfg });
      const out = { consumer: which, changes: Object.keys(store.changes).length, applied, dead_lettered: dead, ms: Date.now() - t0 };
      print(json ? out : `Rebuilt ${which} from the start of the log in ${out.ms} ms: ${out.applied} events applied, ${out.changes} changes, ${out.dead_lettered} dead-lettered.`);
      return 0;
    }

    case 'metrics': {
      const follow = hasFlag(args, '--follow');
      const allRepos = hasFlag(args, '--all-repos');
      const change = takeFlag(args, '--change');
      const show = async () => {
        const { store } = await M.catchUp(root, { cfg });
        const rows = M.report(store, { change: typeof change === 'string' ? change : null, repo: allRepos ? null : B.repoId(root) });
        if (json) { print(rows); return; }
        if (!rows.length) { print('the event log has no changes for this repository yet'); return; }
        for (const r of rows) {
          print(`${r.repo}  ${r.change_id}  tier ${r.tier === null ? '?' : r.tier}  ${r.done ? 'done' : r.phase || ''}${r.backfilled ? ' (backfilled)' : ''}`);
          print(`  agents ${hm(r.agent_minutes)} of ${hm(r.budget_minutes)}${r.within_budget ? '' : ' (OVER)'} · waiting ${hm(r.waiting_minutes)} · dead ${hm(r.dead_minutes)} · unexplained ${hm(r.unexplained_minutes)} · wall ${hm(r.wall_minutes)}`);
          const wg = Object.entries(r.waiting_by_gate).map(([g, m]) => `${g} ${hm(m)}`).join(', ');
          if (wg) print(`  waiting per gate: ${wg}`);
          const ph = Object.entries(r.agent_minutes_by_phase).map(([p, m]) => `${p} ${hm(m)}`).join(', ');
          if (ph) print(`  agent time per phase: ${ph}`);
          const se = Object.entries(r.sessions_by_phase).map(([p, n]) => `${p} ${n}`).join(', ');
          if (se) print(`  sessions per phase: ${se}`);
          const tc = Object.entries(r.tool_calls_by_phase).map(([p, n]) => `${p} ${n}`).join(', ');
          if (tc) print(`  tool calls per phase: ${tc}`);
          const bl = Object.entries(r.blocks_by_hook).map(([h, n]) => `${h} ${n}`).join(', ');
          if (bl) print(`  guard blocks: ${bl}`);
          if (r.voided_approvals || r.ignored_approvals) print(`  approvals voided ${r.voided_approvals}, ignored ${r.ignored_approvals}`);
        }
        const t = B.transport(cfg);
        try {
          const h = await B.health(cfg, t, [B.groupName(P.GROUP), B.groupName(M.GROUP)]);
          print(`Health: ${h.events} events; lag ${Object.entries(h.lag).map(([g, n]) => `${g.split('.')[1]} ${n === null ? '?' : n}`).join(', ')}; dead letters ${h.dead_letter === null ? '?' : h.dead_letter}`);
        } catch (e) { /* health is best effort here */ } finally { t.close(); }
      };
      await show();
      if (!follow) return 0;
      for (;;) { await new Promise((r) => setTimeout(r, 5000)); process.stdout.write('\n'); await show(); }
    }

    case 'replay': {
      const id = args.shift();
      const until = takeFlag(args, '--until');
      const into = takeFlag(args, '--into');
      const repoFlag = takeFlag(args, '--repo');
      if (!id) return fail('usage: wh.js bus replay <change-id> [--until <iso>|@<offset>] [--into <dir>] [--json]');
      const t = B.transport(cfg);
      let events;
      try { events = R.cut(await R.changeEvents(cfg, t, typeof repoFlag === 'string' ? repoFlag : B.repoId(root), id), typeof until === 'string' ? until : null); } finally { t.close(); }
      if (!events.length) return fail(`the event log has no events for ${id}`, 4);
      const m = R.materialize(id, events);
      if (typeof into === 'string') {
        const files = R.writeInto(path.resolve(into), id, m);
        print(json ? { into: path.resolve(into), files, events: m.events } : `Replayed ${m.events} events of ${id} into ${path.resolve(into)}: ${files.join(', ')}`);
        return 0;
      }
      if (json) { print({ events: m.events, state: m.state, gates: m.gates, documents: m.documents }); return 0; }
      print(R.timeline(events).join('\n'));
      return 0;
    }

    case 'backfill': {
      const spec = takeFlag(args, '--repo');
      const only = takeFlag(args, '--change');
      const dry = hasFlag(args, '--dry-run');
      if (typeof spec !== 'string') return fail('usage: wh.js bus backfill --repo <path>[#<ref>] [--change <id>] [--dry-run]');
      const i = spec.lastIndexOf('#');
      const repoPath = path.resolve(i > 0 ? spec.slice(0, i) : spec);
      const ref = i > 0 ? spec.slice(i + 1) : 'HEAD';
      const events = F.eventsForRepo(repoPath, ref, typeof only === 'string' ? only : null);
      const changes = new Set(events.map((e) => e.change_id)).size;
      if (dry) { print(json ? events : `${events.length} events for ${changes} changes of ${B.repoId(repoPath)} (dry run; nothing sent)`); return 0; }
      B.emit(root, events, cfg);
      const r = await B.flush(root, { cfg, timeoutMs: 30000 });
      print(json ? { events: events.length, changes, ...r } : `Backfilled ${events.length} events for ${changes} changes of ${B.repoId(repoPath)}: sent ${r.sent}, queued ${r.pending}${r.error ? ` (${r.error})` : ''}. Running it again adds nothing: the ids are stable.`);
      return r.error ? 1 : 0;
    }

    case 'tail': {
      const n = Number(takeFlag(args, '--n')) || 20;
      const t = B.transport(cfg);
      let all;
      try { all = await B.readAll(cfg, t, (e) => e.repo === B.repoId(root)); } finally { t.close(); }
      all.sort((a, b) => String(a.ts).localeCompare(String(b.ts)));
      const last = all.slice(-n);
      if (json) { print(last); return 0; }
      for (const e of last) print(`${e.ts} ${e.change_id} ${e.type} ${JSON.stringify(e.payload).slice(0, 120)}`);
      return 0;
    }

    case 'index': {
      const follow = hasFlag(args, '--follow');
      const pass = async () => {
        let r;
        try { r = await I.run(root, { cfg }); } catch (e) { return { error: e.message, fatal: true }; }
        if (json) print(r);
        else if (r.indexed.length || r.error) print(r.error ? `Studbook did not index ${r.waiting} document(s), kept for the next pass: ${r.error}` : `Indexed ${r.indexed.length} document(s) into Studbook: ${r.indexed.join(', ')}`);
        else if (!follow) print(r.waiting ? `${r.waiting} document(s) written in the last two seconds; run again to index them` : 'nothing to index');
        return r;
      };
      const first = await pass();
      if (first.fatal) return fail(first.error);
      if (!follow) return first.error ? 1 : 0;
      for (;;) { await new Promise((res) => setTimeout(res, I.SETTLE_MS)); const r = await pass(); if (r.fatal) process.stderr.write(`wh bus: ${r.error}\n`); }
    }

    default:
      return fail(`unknown subcommand "${sub}". Run "wh.js bus help".`);
  }
}

module.exports = { main };
