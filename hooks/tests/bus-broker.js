#!/usr/bin/env node
// The event-log tests that need a real Kafka-protocol broker (0.6). Skipped unless
// WORKHORSE_BUS_TEST_BROKERS names one, e.g. a Redpanda started from examples/bus/compose.yml:
//
//   WORKHORSE_BUS_TEST_BROKERS=127.0.0.1:19092 [WORKHORSE_BUS_TEST_CONTAINER=wh-redpanda] node hooks/tests/bus-broker.js
//
// With WORKHORSE_BUS_TEST_CONTAINER set, "broker down" really stops and restarts that Docker
// container; without it, the change is pointed at a port nothing listens on. CI runs it with the
// container (the `event-log` job).
'use strict';
process.env.WORKHORSE_NO_WATCH = '1';
process.env.WORKHORSE_NO_TRACE = '1';
process.env.WORKHORSE_NO_NOTIFY = '1';
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync, spawnSync } = require('child_process');

const BROKERS = process.env.WORKHORSE_BUS_TEST_BROKERS;
if (!BROKERS) { console.log('bus-broker: WORKHORSE_BUS_TEST_BROKERS is not set; skipped'); process.exit(0); }
const CONTAINER = process.env.WORKHORSE_BUS_TEST_CONTAINER || '';
const PLUGIN = path.resolve(__dirname, '..', '..');
const WH = path.join(PLUGIN, 'scripts', 'wh.js');
const SCRIPTS = path.join(PLUGIN, 'hooks', 'scripts');
const K = require(path.join(PLUGIN, 'scripts', 'bus', 'kafka.js'));
const B = require(path.join(PLUGIN, 'scripts', 'bus', 'index.js'));
const P = require(path.join(PLUGIN, 'scripts', 'bus', 'projector.js'));

let passed = 0, failed = 0;
function check(name, cond, detail) {
  if (cond) { passed++; console.log(`  ok   ${name}`); } else { failed++; console.log(`  FAIL ${name}${detail ? '\n       ' + detail : ''}`); }
}
const env = { ...process.env };
delete env.WORKHORSE_BUS_BROKERS;
const run = (cwd, ...a) => { const r = spawnSync(process.execPath, [WH, ...a], { cwd, encoding: 'utf8', env }); return { code: r.status, out: r.stdout.trim(), err: r.stderr.trim() }; };
const hk = (script, input) => { const r = spawnSync(process.execPath, [path.join(SCRIPTS, script)], { input: JSON.stringify(input), encoding: 'utf8', env }); try { return r.stdout.trim() ? JSON.parse(r.stdout) : {}; } catch (e) { return { error: r.stdout + r.stderr }; } };
const decision = (res) => (res.hookSpecificOutput && res.hookSpecificOutput.permissionDecision) || 'none';
const g = (cwd, ...a) => execFileSync('git', a, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
const gate = (cwd, G) => { const r = run(cwd, 'bus', 'gate', G, '--json'); try { return JSON.parse(r.out); } catch (e) { return { open: false, reason: r.err }; } };
const sleep = (ms) => spawnSync(process.execPath, ['-e', `setTimeout(() => {}, ${ms})`]);

const topic = `workhorse.test.${Date.now()}`;
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'wh-bus-'));
const remote = path.join(tmp, 'remote.git');
g(tmp, 'init', '-q', '--bare', remote);

function clone(name, brokers) {
  const dir = path.join(tmp, name);
  g(tmp, 'clone', '-q', remote, dir);
  g(dir, 'config', 'user.email', 'owner@example.com'); g(dir, 'config', 'user.name', 'Owner');
  return dir;
}

console.log(`event log against a real broker (${BROKERS}, topic ${topic})`);
const a = clone('machine-a');
run(a, 'init');
fs.appendFileSync(path.join(a, '.workhorse', 'profile.yml'), `commands:\n  test: "true"\nbus:\n  brokers: "${BROKERS}"\n  topic: ${topic}\n  dead_letter: ${topic}.dead-letter\n`);
g(a, 'add', '-A'); g(a, 'commit', '-q', '-m', 'init'); g(a, 'push', '-q', 'origin', 'HEAD');
const init = run(a, 'bus', 'init');
check('bus init creates both topics on the broker', new RegExp(`${topic.replace(/\./g, '\\.')}: created`).test(init.out), init.err);
const id = JSON.parse(run(a, 'new', 'cross machine', '--tier', '2').out).change_id;
const brief = path.join(a, 'docs', 'sdlc', id, 'brief.md');
fs.writeFileSync(brief, '# Brief\n\nTier 2\n\n## Your decision\n\nApprove.\n');
run(a, 'present', 'G2');
const ap = JSON.parse(run(a, 'approve', 'G2', '--accept-all').out);
check('the approval is on the broker', /^on the log as wh-gate-event:/.test(ap.event_log || ''), JSON.stringify(ap));
g(a, 'push', '-q', 'origin', `wh/${id}`);

// Cross-machine approval: a second clone, its own control state, only the broker in common.
const b = clone('machine-b');
g(b, 'checkout', '-q', `wh/${id}`);
const sc = hk('session-context.js', { hook_event_name: 'SessionStart', cwd: b });
check('cross-machine: the second clone restores the change from the broker', /Restored .*G2=approved/.test((sc.hookSpecificOutput || {}).additionalContext || ''));
const vfile = (root) => ({ tool_name: 'Write', tool_input: { file_path: path.join(root, 'docs', 'sdlc', id, 'verification.md') }, cwd: root });
check('cross-machine: the second clone never asks for G2 again', decision(hk('gate-guard.js', vfile(b))) === 'none' && gate(b, 'G2').open === true);

// Double delivery: copy every event of the topic twice into a second topic; project both.
(async () => {
  const c = new K.Client({ brokers: BROKERS });
  try {
    const cfg = { brokers: BROKERS, topic, deadLetter: `${topic}.dead-letter`, partitions: 6 };
    await c.createTopic(`${topic}.twice`, 6, { 'retention.ms': '-1' });
    const parts = await c.partitions(topic);
    for (const { partition } of parts) {
      const { records } = await c.fetch(topic, partition, 0);
      if (!records.length) continue;
      const recs = records.map((r) => ({ key: r.key, value: r.value }));
      await c.produce(`${topic}.twice`, partition, recs);
      await c.produce(`${topic}.twice`, partition, recs);
    }
    const one = await P.catchUp(a, { cfg, file: path.join(tmp, 'once.json') });
    const two = await P.catchUp(a, { cfg: { ...cfg, topic: `${topic}.twice` }, file: path.join(tmp, 'twice.json') });
    check('double delivery: a projection over every event twice is byte-identical', JSON.stringify(one.store.changes) === JSON.stringify(two.store.changes) && Object.keys(one.store.changes).length === 1);
    const lag = await c.committed(B.groupName(P.GROUP), topic);
    check('the projector commits its group offset, so lag is visible to Kafka tools', Object.values(lag).some((o) => o > 0), JSON.stringify(lag));
  } finally { c.close(); }

  // Broker down.
  const stop = () => (CONTAINER ? spawnSync('docker', ['stop', CONTAINER], { encoding: 'utf8' }) : null);
  const start = () => (CONTAINER ? spawnSync('docker', ['start', CONTAINER], { encoding: 'utf8' }) : null);
  const profileB = path.join(b, '.workhorse', 'profile.yml');
  const original = fs.readFileSync(profileB, 'utf8');
  if (CONTAINER) stop(); else fs.writeFileSync(profileB, original.replace(BROKERS, '127.0.0.1:1'));
  const down = gate(b, 'G2');
  check(`broker down (${CONTAINER ? 'container stopped' : 'unreachable port'}): the gate is closed`, down.open === false && /unreachable/.test(down.reason), JSON.stringify(down));
  check('broker down: the gated write is refused', decision(hk('gate-guard.js', vfile(b))) === 'deny');
  const q = JSON.parse(run(b, 'approve', 'G2', '--accept-all').out);
  check('broker down: a new approval is queued in the outbox, not lost', /queued as wh-gate-event/.test(q.event_log || '') && B.pending(b) > 0, JSON.stringify(q));
  if (CONTAINER) {
    start();
    for (let i = 0; i < 60; i++) { if (spawnSync('docker', ['exec', CONTAINER, 'rpk', 'cluster', 'health', '--exit-when-healthy'], { encoding: 'utf8', timeout: 10000 }).status === 0) break; sleep(1000); }
  } else fs.writeFileSync(profileB, original);
  let fl = {};
  for (let i = 0; i < 10; i++) { fl = JSON.parse(run(b, 'bus', 'flush', '--json').out || '{}'); if (fl.pending === 0) break; sleep(1000); }
  check('broker back: the outbox drains', fl.pending === 0 && fl.sent > 0, JSON.stringify(fl));
  check('broker back: the gate opens again', gate(b, 'G2').open === true);

  // Replay from the broker.
  const into = path.join(tmp, 'replay');
  const rp = run(a, 'bus', 'replay', id, '--into', into);
  check('replay from the broker reproduces the conductor log of the clone that kept writing it', rp.code === 0 && fs.readFileSync(path.join(into, 'conductor-log.md'), 'utf8').includes('G2 Design presented'), rp.err);
  const st = JSON.parse(run(a, 'bus', 'status', '--json').out);
  check('status reads the broker: events, lag, dead letters', st.reachable === true && st.events > 0 && st.dead_letter === 0, JSON.stringify(st));

  fs.rmSync(tmp, { recursive: true, force: true });
  console.log(`\n${passed} passed, ${failed} failed`);
  process.exit(failed ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
