#!/usr/bin/env node
// Hook and CLI tests. Builds a throwaway repo under the OS temp dir, feeds each hook sample
// JSON on stdin, and asserts the decision. Run: node hooks/tests/run.js
'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync, spawnSync } = require('child_process');

const PLUGIN = path.resolve(__dirname, '..', '..');
const SCRIPTS = path.join(PLUGIN, 'hooks', 'scripts');
const WH = path.join(PLUGIN, 'scripts', 'wh.js');
const L = require(path.join(SCRIPTS, 'lib.js'));

let passed = 0, failed = 0;
function check(name, cond, detail) {
  if (cond) { passed++; console.log(`  ok   ${name}`); }
  else { failed++; console.log(`  FAIL ${name}${detail ? '\n       ' + detail : ''}`); }
}

function hook(script, input) {
  const r = spawnSync(process.execPath, [path.join(SCRIPTS, script)], { input: JSON.stringify(input), encoding: 'utf8' });
  if (r.status !== 0) return { error: r.stderr };
  try { return r.stdout.trim() ? JSON.parse(r.stdout) : {}; } catch (e) { return { error: 'bad json: ' + r.stdout }; }
}
function decision(res) { return (res.hookSpecificOutput && res.hookSpecificOutput.permissionDecision) || (res.decision) || 'none'; }
function wh(cwd, ...a) {
  const r = spawnSync(process.execPath, [WH, ...a], { cwd, encoding: 'utf8' });
  return { code: r.status, out: r.stdout.trim(), err: r.stderr.trim() };
}

// ---------- fixture ----------
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'wh-test-'));
const repo = path.join(tmp, 'repo');
fs.mkdirSync(repo, { recursive: true });
execFileSync('git', ['init', '-q'], { cwd: repo });
execFileSync('git', ['config', 'user.email', 'tester@example.com'], { cwd: repo });
execFileSync('git', ['config', 'user.name', 'Tester'], { cwd: repo });
fs.writeFileSync(path.join(repo, 'README.md'), '# fixture\n');
execFileSync('git', ['add', '.'], { cwd: repo });
execFileSync('git', ['commit', '-q', '-m', 'init'], { cwd: repo });

console.log('yaml parser');
{
  const p = L.parseYaml(fs.readFileSync(path.join(PLUGIN, 'templates', 'profile.yml'), 'utf8'));
  check('parses autonomy', p.autonomy === 'bounded');
  check('parses nested list', Array.isArray(p.conventions.test_globs) && p.conventions.test_globs.includes('**/*.test.*'));
  check('parses inline map', p.environments.prod.auto === false && p.environments.dev.auto === true);
  check('parses numeric-key map with inline list', Array.isArray(p.tier_floor_paths['3']) && p.tier_floor_paths['3'][0] === '**/migrations/**');
  check('parses build.max_parallel', p.build && p.build.max_parallel === 10);
  check('empty string stays empty', p.commands.test === '');
  const q = L.parseYaml([
    'a: "pytest -m \\"not integration\\""',
    "b: 'it''s fine'",
    'c: "C:\\\\tmp"',
  ].join('\n'));
  check('double-quoted escapes are unescaped', q.a === 'pytest -m "not integration"', JSON.stringify(q.a));
  check('single-quoted doubles collapse', q.b === "it's fine", JSON.stringify(q.b));
  check('escaped backslash collapses to one', q.c === 'C:\\tmp', JSON.stringify(q.c));
}

console.log('glob');
{
  check('** matches nested', L.globToRegex('**/migrations/**').test('db/migrations/001.sql'));
  check('** matches top', L.globToRegex('**/migrations/**').test('migrations/001.sql'));
  check('.env* matches at depth', L.globToRegex('.env*').test('apps/web/.env.local'));
  check('*.test.* matches', L.globToRegex('**/*.test.*').test('src/a/b.test.ts'));
  check('no false match', !L.globToRegex('infra/**').test('src/infra.ts'));
}

console.log('cli init/new');
{
  let r = wh(repo, 'init');
  check('init creates profile', r.code === 0 && fs.existsSync(path.join(repo, '.workhorse', 'profile.yml')), r.err);
  // Give the fixture real commands so hooks have something to read.
  let prof = fs.readFileSync(path.join(repo, '.workhorse', 'profile.yml'), 'utf8');
  prof = prof.replace('  name: ""', '  name: "Fixture Co"');
  prof = prof.replace('  test: ""', '  test: "node -e \\"process.exit(0)\\""').replace('prod: { deploy: "", auto: false }', 'prod: { deploy: "deploy-prod.sh", auto: false }');
  fs.writeFileSync(path.join(repo, '.workhorse', 'profile.yml'), prof);
  r = wh(repo, 'new', 'Add health endpoint', '--tier', '0');
  check('new creates change', r.code === 0 && /"change_id"/.test(r.out), r.err);
  const id = JSON.parse(r.out).change_id;
  check('active set', wh(repo, 'active').out === id);
  check('intent scaffolded', fs.existsSync(path.join(repo, 'docs', 'sdlc', id, 'intent.md')));
  check('required gates tier 0 = G4', wh(repo, 'required').out.replace(/\s/g, '') === '["G4"]');
  wh(repo, 'state', 'set', 'tier', '2');
  check('required gates tier 2 = all', JSON.parse(wh(repo, 'required').out).length === 5);
  let g = wh(repo, 'gate', 'G4', 'auto');
  check('cannot auto a required gate', g.code !== 0 && /cannot be auto-approved/.test(g.err), g.err);
  wh(repo, 'state', 'set', 'tier', '0');
  g = wh(repo, 'gate', 'G1', 'auto');
  check('can auto a non-required gate', g.code === 0, g.err);
  const v = wh(repo, 'state', 'set', 'verification.status', 'green');
  check('cannot mark green without verification.md', v.code !== 0, v.out);

  // A greenfield repo with no commands must not report a green that proves nothing.
  const bare = path.join(tmp, 'bare');
  fs.mkdirSync(bare, { recursive: true });
  execFileSync('git', ['init', '-q'], { cwd: bare });
  execFileSync('git', ['config', 'user.email', 'tester@example.com'], { cwd: bare });
  execFileSync('git', ['config', 'user.name', 'Tester'], { cwd: bare });
  wh(bare, 'init');
  wh(bare, 'new', 'Bootstrap');
  const bid = wh(bare, 'active').out;
  fs.writeFileSync(path.join(bare, 'docs', 'sdlc', bid, 'verification.md'),
    '# Verification\n\nStatus: green\n');
  const vac = wh(bare, 'state', 'set', 'verification.status', 'green');
  check('refuses a vacuous green when the profile defines no checks',
    vac.code !== 0 && /prove nothing/.test(vac.err), vac.err || vac.out);
}
const id = wh(repo, 'active').out;
const cwd = repo;
const base = { session_id: 's', cwd, hook_event_name: 'PreToolUse' };
function edit(file) { return { ...base, tool_name: 'Edit', tool_input: { file_path: path.join(repo, file) } }; }
function bash(command, extra) { return { ...base, tool_name: 'Bash', tool_input: { command }, ...(extra || {}) }; }

console.log('protect-paths');
{
  check('denies workflow edit', decision(hook('protect-paths.js', edit('.github/workflows/ci.yml'))) === 'deny');
  check('denies .env edit', decision(hook('protect-paths.js', edit('apps/api/.env.production'))) === 'deny');
  check('asks on migrations', decision(hook('protect-paths.js', edit('db/migrations/002.sql'))) === 'ask');
  check('allows src edit', decision(hook('protect-paths.js', edit('src/index.ts'))) === 'none');
  check('denies approvals.md', decision(hook('protect-paths.js', edit(`docs/sdlc/${id}/approvals.md`))) === 'deny');
  check('no opinion outside repo', decision(hook('protect-paths.js', { ...base, cwd: os.tmpdir(), tool_name: 'Edit', tool_input: { file_path: path.join(os.tmpdir(), 'x.yml') } })) === 'none');
}

console.log('test-lock');
{
  check('allows test edit in normal mode', decision(hook('test-lock.js', edit('src/a.test.ts'))) === 'none');
  wh(repo, 'mode', 'fix');
  check('denies test edit in fix mode', decision(hook('test-lock.js', edit('src/a.test.ts'))) === 'deny');
  check('denies tests dir in fix mode', decision(hook('test-lock.js', edit('tests/e2e/login.spec.ts'))) === 'deny');
  check('allows src edit in fix mode', decision(hook('test-lock.js', edit('src/a.ts'))) === 'none');
  wh(repo, 'mode', 'normal');
}

console.log('worktree-fence');
{
  check('no fence without worktree', decision(hook('worktree-fence.js', edit('src/a.ts'))) === 'none');
  wh(repo, 'state', 'set', 'worktree', '.worktrees/' + id);
  check('denies main checkout src edit', decision(hook('worktree-fence.js', edit('src/a.ts'))) === 'deny');
  check('allows docs/sdlc edit', decision(hook('worktree-fence.js', edit(`docs/sdlc/${id}/plan.md`))) === 'none');
  check('allows edit inside worktree', decision(hook('worktree-fence.js', edit(`.worktrees/${id}/src/a.ts`))) === 'none');
  wh(repo, 'state', 'set', 'worktree', 'null');
}

console.log('bash-guard');
{
  check('denies force push', decision(hook('bash-guard.js', bash('git push --force origin wh/x'))) === 'deny');
  check('denies -f push', decision(hook('bash-guard.js', bash('git push -f'))) === 'deny');
  check('denies push to main', decision(hook('bash-guard.js', bash('git push origin main'))) === 'deny');
  check('allows push to change branch', decision(hook('bash-guard.js', bash('git push -u origin wh/2026-x'))) === 'none');
  check('denies rm -rf /', decision(hook('bash-guard.js', bash('rm -rf /'))) === 'deny');
  check('denies profile deny_commands', decision(hook('bash-guard.js', bash('terraform destroy -auto-approve'))) === 'deny');
  check('asks profile ask_commands', decision(hook('bash-guard.js', bash('terraform apply'))) === 'ask');
  check('allows plain test', decision(hook('bash-guard.js', bash('npm test'))) === 'none');
  check('denies prod deploy without G5', decision(hook('bash-guard.js', bash('./deploy-prod.sh'))) === 'deny');
  check('denies approve from subagent', decision(hook('bash-guard.js', bash(`node "${WH}" approve G4`, { agent_id: 'abc', agent_type: 'wh-conductor' }))) === 'deny');
  check('allows approve from main session', decision(hook('bash-guard.js', bash(`node "${WH}" approve G4`))) === 'none');
}

console.log('gate-guard');
{
  check('denies spec write at tier 2 before G1', (() => { wh(repo, 'state', 'set', 'tier', '2'); return decision(hook('gate-guard.js', edit(`docs/sdlc/${id}/spec.md`))) === 'deny'; })());
  wh(repo, 'state', 'set', 'tier', '0');
  check('allows spec write at tier 0', decision(hook('gate-guard.js', edit(`docs/sdlc/${id}/spec.md`))) === 'none');
  check('denies state.json direct edit', decision(hook('gate-guard.js', edit(`docs/sdlc/${id}/state.json`))) === 'deny');
  check('denies push without green verification', decision(hook('gate-guard.js', bash('git push -u origin wh/x'))) === 'deny');
  fs.writeFileSync(path.join(repo, 'docs', 'sdlc', id, 'verification.md'), '# Verification\n\nStatus: green\n');
  const v = wh(repo, 'state', 'set', 'verification.status', 'green');
  check('marks green with verification.md present', v.code === 0, v.err);
  check('allows push with green verification', decision(hook('gate-guard.js', bash('git push -u origin wh/x'))) === 'none');
  check('denies merge before G4', decision(hook('gate-guard.js', bash('gh pr merge 12'))) === 'deny');
  check('denies release.md before G4', decision(hook('gate-guard.js', edit(`docs/sdlc/${id}/release.md`))) === 'deny');
  // An approval must pin the packet it approves: committed, and hashed.
  const packetRel = `docs/sdlc/${id}/review-packet.md`;
  const packetBody = '# Review packet\n\n## 1. TL;DR\n\nPinned by the approval test.\n';
  fs.writeFileSync(path.join(repo, packetRel), packetBody);
  const a = wh(repo, 'approve', 'G4', 'looks good');
  check('approve records', a.code === 0 && /approved/.test(a.out), a.err);
  const af = fs.readFileSync(path.join(repo, 'docs', 'sdlc', id, 'approvals.md'), 'utf8');
  check('approvals.md has who/when/commit', /Who: tester@example.com/.test(af) && /Artifact commit:/.test(af));
  check('approval committed', /G4 approved/.test(execFileSync('git', ['log', '-1', '--format=%s'], { cwd: repo, encoding: 'utf8' })));
  const recorded = (af.match(/Artifact commit: `([0-9a-f]{7,40})`/) || [])[1];
  const shaLine = af.match(/Packet: `([^`]+)` sha256 `([0-9a-f]{64})`/) || [];
  const expectSha = require('crypto').createHash('sha256').update(packetBody).digest('hex');
  check('approval records the packet sha256 matching its content', shaLine[1] === packetRel && shaLine[2] === expectSha, JSON.stringify(shaLine.slice(1)));
  let inCommit = '';
  try { inCommit = execFileSync('git', ['show', `${recorded}:${packetRel}`], { cwd: repo, encoding: 'utf8' }); } catch (e) { inCommit = ''; }
  check('the recorded commit actually contains the approved packet', inCommit === packetBody, `recorded=${recorded}`);
  check('the approved packet is tracked, not left untracked', execFileSync('git', ['ls-files', packetRel], { cwd: repo, encoding: 'utf8' }).trim() === packetRel);
  check('allows merge after G4', decision(hook('gate-guard.js', bash('gh pr merge 12'))) === 'none');
  check('allows release.md after G4', decision(hook('gate-guard.js', edit(`docs/sdlc/${id}/release.md`))) === 'none');
  // --accept-all answers every decision with the recommendation and keeps any notes.
  fs.writeFileSync(path.join(repo, 'docs', 'sdlc', id, 'release.md'),
    '# Release\n\n## Decisions requested\n\n| # | Decision | Recommendation | Alternative |\n|---|---|---|---|\n| D1 | Deploy Friday | Wait for Monday | Deploy Friday |\n');
  const aa = wh(repo, 'approve', 'G5', '--accept-all', 'fine by me');
  check('--accept-all approves and composes the decision notes', aa.code === 0
    && /D1: recommendation accepted\. fine by me/.test(fs.readFileSync(path.join(repo, 'docs', 'sdlc', id, 'approvals.md'), 'utf8')), aa.err);
  check('a rejection needs no decision answers', wh(repo, 'approve', 'G5', '--reject', 'not yet').code === 0);
  fs.unlinkSync(path.join(repo, 'docs', 'sdlc', id, 'release.md')); // the next checks want no packet on disk
  const rj = wh(repo, 'approve', 'G5', '--reject');
  check('reject needs notes', rj.code !== 0);
  const rj2 = wh(repo, 'approve', 'G5', '--reject', 'not yet');
  check('reject records', rj2.code === 0 && wh(repo, 'state', 'get', 'gates.G5').out === 'rejected');
  const af2 = fs.readFileSync(path.join(repo, 'docs', 'sdlc', id, 'approvals.md'), 'utf8');
  check('a decision with no packet file says so rather than inventing a hash', /## G5: rejected[\s\S]*sha256 `missing/.test(af2));
}

console.log('verify-before-stop');
{
  wh(repo, 'phase', 'build');
  wh(repo, 'state', 'set', 'verification.status', 'red');
  let r = hook('verify-before-stop.js', { ...base, hook_event_name: 'Stop' });
  check('blocks stop in build when red', r.decision === 'block');
  r = hook('verify-before-stop.js', { ...base, hook_event_name: 'Stop', stop_hook_active: true });
  check('does not loop when stop_hook_active', r.decision !== 'block');
  r = hook('verify-before-stop.js', { ...base, hook_event_name: 'SubagentStop', agent_type: 'wh-bug-reviewer' });
  check('lets unrelated subagents stop', r.decision !== 'block');
  r = hook('verify-before-stop.js', { ...base, hook_event_name: 'SubagentStop', agent_type: 'wh-builder' });
  check('blocks builder stop when red', r.decision === 'block');
  wh(repo, 'state', 'set', 'verification.status', 'green');
  r = hook('verify-before-stop.js', { ...base, hook_event_name: 'Stop' });
  check('allows stop when green', r.decision !== 'block');
  wh(repo, 'phase', 'review');
}

console.log('session-context');
{
  const r = hook('session-context.js', { ...base, hook_event_name: 'SessionStart' });
  const ctx = r.hookSpecificOutput && r.hookSpecificOutput.additionalContext || '';
  check('mentions active change', ctx.includes(id));
  check('mentions required gates', /Required human gates/.test(ctx));
}

console.log('digest');
{
  // A second change, so the digest cases are not entangled with the gate-guard fixture above.
  const r = wh(repo, 'new', 'Digest fixture change', '--tier', '1');
  const did = JSON.parse(r.out).change_id;
  const ddir = path.join(repo, 'docs', 'sdlc', did);
  const d = () => JSON.parse(wh(repo, 'digest').out);

  check('digest identifies the change', d().change_id === did && d().title === 'Digest fixture change');
  check('digest reads tier and required gates', d().tier === 1 && d().required_human_gates.join() === 'G2,G4');
  check('digest reads the client name', d().client === 'Fixture Co', d().client);
  check('repo falls back to folder name for a non-hosted remote', d().repo === 'repo');

  fs.writeFileSync(path.join(ddir, 'intent.md'),
    '# Intent\n\n## Problem\n\nOrders vanish with no trace.\n\n## Outcome\n\nEvery order is logged.\n');
  check('digest extracts problem', d().problem === 'Orders vanish with no trace.');
  check('digest extracts outcome', d().outcome === 'Every order is logged.');

  // Intent phase, G2 not yet live: the pipeline is still on the agents, not on the human.
  check('waiting_on is Agents before a gate packet exists', d().waiting_on === 'Agents');
  check('blocking_gate is null before a gate packet exists', d().blocking_gate === null);

  wh(repo, 'phase', 'review');
  check('waiting_on stays Agents while review-packet.md is missing', d().waiting_on === 'Agents');
  fs.writeFileSync(path.join(ddir, 'review-packet.md'), [
    '# Review packet', '', '## 1. TL;DR', '',
    'Adds an order audit log. Twelve tests. You are asked to approve the merge.', '',
    '## 2. Decisions requested', '',
    '| # | Decision | Recommendation |', '|---|---|---|',
    '| D1 | Retain logs for 7 years | Accept |', '| D2 | Log to Postgres not files | Accept |', '',
  ].join('\n'));
  check('waiting_on names the gate once its packet exists', d().waiting_on === 'You (G4)');
  check('blocking_gate is G4', d().blocking_gate === 'G4');
  check('digest extracts the packet TL;DR', /order audit log/i.test(d().tldr));
  check('digest extracts decision rows, skipping the header', d().decisions.length === 2, JSON.stringify(d().decisions));
  check('decision row keeps id and text', /^D1 /.test(d().decisions[0]));

  // A rejected gate waits on the agents reworking it, not on the human; presenting it again sets
  // it back to pending. The old rule (anything not approved is waiting) showed Approve buttons
  // during rework and hid the re-presentation from phone notifications.
  const rjd = wh(repo, 'approve', 'G4', '--reject', 'needs a retention ADR');
  check('reject succeeds for the digest fixture', rjd.code === 0, rjd.err);
  check('a rejected gate waits on Agents, not on the human',
    d().waiting_on === 'Agents' && d().blocking_gate === null, JSON.stringify([d().waiting_on, d().blocking_gate]));
  wh(repo, 'gate', 'G4', 'pending');
  check('presenting the gate again puts it back on the human', d().blocking_gate === 'G4');

  // Approval flips waiting_on and is parsed back out of approvals.md.
  fs.writeFileSync(path.join(ddir, 'verification.md'), '# Verification\n\nStatus: green\n');
  wh(repo, 'state', 'set', 'verification.status', 'green');
  // The packet asks two decisions (D1, D2). An approval must answer both by id: a live G4
  // approval answered one of two, and the retro found the same slip in the change before it.
  const di = d().decision_items;
  check('digest exposes structured decision items', di.length === 2 && di[0].id === 'D1'
    && di[0].decision === 'Retain logs for 7 years' && di[0].recommendation === 'Accept', JSON.stringify(di));
  const half = wh(repo, 'approve', 'G4', 'D1 accepted, ship it');
  check('approve refuses when a packet decision goes unanswered', half.code !== 0 && /do not answer D2/.test(half.err), half.err);
  check('the refusal names the unanswered decision', /D2: Log to Postgres not files/.test(half.err), half.err);
  const ap = wh(repo, 'approve', 'G4', 'D1: accepted. D2: alternative, files are fine here. ship it');
  check('approve succeeds once every decision is answered', ap.code === 0, ap.err);
  const la = d().last_approval;
  check('digest parses the full approval block', la && la.gate === 'G4' && la.status === 'approved'
    && la.who === 'tester@example.com' && la.at.length > 0 && la.notes === 'D1: accepted. D2: alternative, files are fine here. ship it', JSON.stringify(la));
  check('waiting_on clears once the gate is approved', d().waiting_on === 'Agents');

  // page_id round-trips so a resync updates rather than duplicates.
  check('tracker page_id starts null', d().tracker.page_id === null);
  wh(repo, 'state', 'set', 'tracker.page_id', 'notion-abc-123');
  check('tracker page_id round-trips', d().tracker.page_id === 'notion-abc-123');
  check('tracker provider is empty until configured', d().tracker.provider === '');

  const all = JSON.parse(wh(repo, 'digest', '--all').out);
  check('digest --all covers every change', Array.isArray(all) && all.length === 2, `got ${all.length}`);
  check('digest --all includes both ids', all.map((x) => x.change_id).sort().join() === [id, did].sort().join());

  wh(repo, 'active', id); // restore the original fixture for later blocks
}

console.log('status/metrics');
{
  const s = wh(repo, 'status', '--json');
  check('status json', s.code === 0 && JSON.parse(s.out).change_id === id, s.err);
  const m = wh(repo, 'status', '--metrics');
  check('metrics computed', m.code === 0 && JSON.parse(m.out).changes === 2, m.err || m.out);
}

console.log('conductor log');
{
  const before = Date.now();
  const r = wh(repo, 'log', 'wh-spec-architect | spec.md written,', '19 requirements');
  const f = path.join(repo, 'docs', 'sdlc', id, 'conductor-log.md');
  const last = fs.existsSync(f) ? fs.readFileSync(f, 'utf8').trim().split('\n').pop() : '';
  const [stamp, phase, ...rest] = last.split(' | ');
  const t = Date.parse(stamp);
  check('log appends one line with the phase and message', r.code === 0 && phase === L.loadState(repo, id).phase && rest.join(' | ') === 'wh-spec-architect | spec.md written, 19 requirements', r.err || last);
  check('log stamps the real time, not a supplied one', t >= before - 1000 && t <= Date.now() + 1000, stamp);
  check('log refuses an empty message', wh(repo, 'log').code !== 0);
  wh(repo, 'log', `${phase} | wh-release-engineer | release.md written`);
  const repeated = fs.readFileSync(f, 'utf8').trim().split('\n').pop();
  check('log drops a phase the caller repeated', repeated.split(' | ').filter((s) => s === phase).length === 1, repeated);
}

console.log('plugin structure');
{
  const AG = path.join(PLUGIN, 'agents');
  const SK = path.join(PLUGIN, 'skills');
  const agentFiles = fs.readdirSync(AG).filter((f) => f.endsWith('.md'));
  const front = (f) => (fs.readFileSync(path.join(AG, f), 'utf8').match(/^---\n([\s\S]*?)\n---/) || [])[1] || '';
  const field = (fm, k) => ((fm.match(new RegExp(`^${k}:\\s*(.*)$`, 'm')) || [])[1] || '').trim();

  const misnamed = agentFiles.filter((f) => field(front(f), 'name') !== f.replace(/\.md$/, ''));
  check('every agent file name matches its frontmatter name', misnamed.length === 0, misnamed.join(', '));

  // A typo in a skills: list silently drops that skill from the agent, so check every reference.
  const skillDirs = new Set(fs.readdirSync(SK));
  const missing = [];
  for (const f of agentFiles) {
    const list = field(front(f), 'skills').replace(/^\[|\]$/g, '').split(',').map((s) => s.trim()).filter(Boolean);
    for (const s of list) if (!skillDirs.has(s)) missing.push(`${f}: ${s}`);
  }
  check('every skill an agent preloads exists', missing.length === 0, missing.join('; '));

  const noDefense = agentFiles.filter((f) => !/Prompt defense baseline/i.test(fs.readFileSync(path.join(AG, f), 'utf8')));
  check('every agent carries the prompt defense baseline', noDefense.length === 0, noDefense.join(', '));

  const verifierTools = field(front('wh-verifier.md'), 'tools');
  check('verifier cannot spawn agents (least privilege: Bash without Agent)', !/\bAgent\b/.test(verifierTools), verifierTools);

  const ecc = agentFiles.filter((f) => f.startsWith('ecc-'));
  check('nine ECC agents vendored', ecc.length === 9, ecc.join(', '));
  const noAdapter = ecc.filter((f) => !fs.readFileSync(path.join(AG, f), 'utf8').includes('## WorkHorse adapter'));
  check('every vendored ECC agent has the WorkHorse adapter', noAdapter.length === 0, noAdapter.join(', '));
  check('vendored ECC licence and manifest present',
    fs.existsSync(path.join(PLUGIN, 'vendor', 'ecc', 'LICENSE')) && fs.existsSync(path.join(PLUGIN, 'vendor', 'ecc', 'VENDORED.md')));
  const rulesFor = ['common', 'typescript', 'python', 'react', 'web'].filter((r) => !fs.existsSync(path.join(PLUGIN, 'vendor', 'ecc', 'rules', r)));
  check('every rules folder wh-language-standards names is vendored', rulesFor.length === 0, rulesFor.join(', '));

  const conductor = fs.readFileSync(path.join(AG, 'wh-conductor.md'), 'utf8');
  const undispatchable = ecc.filter((f) => !conductor.includes(`workhorse:${f.replace(/\.md$/, '')}`));
  check('the conductor can name every vendored ECC agent', undispatchable.length === 0, undispatchable.join(', '));
}

console.log('artifact-size');
{
  // Two live runs wrote intents of 268 and 270 lines against a 150-line rule; prompt guidance
  // alone did not hold, so a hook now measures after each write.
  const az = path.join(tmp, 'az');
  fs.mkdirSync(az, { recursive: true });
  const g = (...a) => execFileSync('git', a, { cwd: az, encoding: 'utf8' }).trim();
  g('init', '-q'); g('config', 'user.email', 'tester@example.com'); g('config', 'user.name', 'Tester');
  wh(az, 'init');
  const aid = JSON.parse(wh(az, 'new', 'Size me', '--tier', '1').out).change_id;
  const put = (name, n) => {
    const rel = `docs/sdlc/${aid}/${name}`;
    fs.writeFileSync(path.join(az, rel), Array.from({ length: n }, (_, i) => `line ${i + 1}`).join('\n') + '\n');
    return { session_id: 's', cwd: az, hook_event_name: 'PostToolUse', tool_name: 'Write', tool_input: { file_path: path.join(az, rel) } };
  };
  const res = (input) => hook('artifact-size.js', input);

  const big = res(put('intent.md', 200));
  check('an intent over 190 lines is sent back to be cut', big.decision === 'block' && /200 lines; the limit for intent\.md is 190/.test(big.reason || ''), JSON.stringify(big));
  check('an intent within the limit passes silently', res(put('intent.md', 120)).decision === undefined);
  check('a tier-1 spec over 250 lines is sent back', res(put('spec.md', 300)).decision === 'block');
  wh(az, 'state', 'set', 'tier', '2');
  check('the same spec passes at tier 2 (limit 500)', res(put('spec.md', 300)).decision === undefined);
  wh(az, 'state', 'set', 'tier', '3');
  check('a tier-3 spec has no size limit', res(put('spec.md', 900)).decision === undefined);
  check('a plan over 500 lines is sent back', res(put('plan.md', 520)).decision === 'block');
  fs.writeFileSync(path.join(az, 'README.md'), 'x\n'.repeat(1000));
  check('files outside a change folder are ignored',
    res({ session_id: 's', cwd: az, hook_event_name: 'PostToolUse', tool_name: 'Write', tool_input: { file_path: path.join(az, 'README.md') } }).decision === undefined);
}

console.log('phase done');
{
  // A live run reached done with release.md, retro.md and the log never committed.
  const pd = path.join(tmp, 'pd');
  fs.mkdirSync(pd, { recursive: true });
  const g = (...a) => execFileSync('git', a, { cwd: pd, encoding: 'utf8' }).trim();
  g('init', '-q'); g('config', 'user.email', 'tester@example.com'); g('config', 'user.name', 'Tester');
  wh(pd, 'init');
  g('add', '.'); g('commit', '-q', '-m', 'onboard');
  const pid = JSON.parse(wh(pd, 'new', 'Close me', '--tier', '0').out).change_id;
  const dir = `docs/sdlc/${pid}`;
  // A live run closed the change before the retro existed, leaving retro.md out of the close
  // commit; phase done now refuses until it exists.
  const early = wh(pd, 'phase', 'done');
  check('phase done refuses while retro.md is missing', early.code !== 0 && /retro\.md does not exist/.test(early.err), early.err);
  fs.writeFileSync(path.join(pd, dir, 'retro.md'), '# retro\n');
  fs.writeFileSync(path.join(pd, 'unrelated.txt'), 'not part of the change\n');
  fs.mkdirSync(path.join(pd, '.workhorse', 'instincts'), { recursive: true });
  fs.writeFileSync(path.join(pd, '.workhorse', 'instincts', 'wait-for-close.md'), '---\nid: wait-for-close\nconfidence: 0.7\n---\n');
  const r = wh(pd, 'phase', 'done');
  check('phase done commits the change folder', r.code === 0 && g('status', '--porcelain', '--', dir) === '' && g('log', '-1', '--format=%s') === `chore(sdlc): close ${pid}`, r.err || g('status', '--porcelain'));
  check('phase done reports the commit', r.code === 0 && JSON.parse(r.out).committed === g('log', '-1', '--format=%h'), r.out);
  check('phase done leaves files outside the change folder alone', g('status', '--porcelain').includes('unrelated.txt'));
  check('the close commit carries the retro instincts too',
    g('ls-files', '.workhorse/instincts').includes('wait-for-close.md') && g('status', '--porcelain', '--', '.workhorse/instincts') === '');
  JSON.parse(wh(pd, 'new', 'No retro', '--tier', '0').out);
  check('--no-retro closes a change without a retro', wh(pd, 'phase', 'done', '--no-retro').code === 0);
}

console.log('control state location');
{
  // A fresh fixture: these tests move branches and add worktrees, which must not disturb the rest.
  const cs = path.join(tmp, 'cs');
  fs.mkdirSync(cs, { recursive: true });
  const g = (...a) => execFileSync('git', a, { cwd: cs, encoding: 'utf8' }).trim();
  g('init', '-q'); g('config', 'user.email', 'tester@example.com'); g('config', 'user.name', 'Tester');
  wh(cs, 'init');
  g('add', '.'); g('commit', '-q', '-m', 'onboard');   // profile tracked, as in a real client repo
  const cid = JSON.parse(wh(cs, 'new', 'Survive checkout', '--tier', '1').out).change_id;
  wh(cs, 'phase', 'build');

  const stateAt = path.join(cs, '.git', 'workhorse', 'changes', cid, 'state.json');
  check('state.json lives in the git common dir', fs.existsSync(stateAt));
  check('the active change lives in the git common dir',
    fs.readFileSync(path.join(cs, '.git', 'workhorse', 'active'), 'utf8').trim() === cid);
  check('no state.json is written into docs/sdlc', !fs.existsSync(path.join(cs, 'docs', 'sdlc', cid, 'state.json')));
  check('.gitignore covers the legacy active file', fs.readFileSync(path.join(cs, '.gitignore'), 'utf8').includes('.workhorse/active'));

  // The bug this guards: checking out the change branch rewrote tracked state from the branch point,
  // so the active change went empty, the phase went backwards, and every state-driven hook stood down.
  g('checkout', '-q', '-b', 'elsewhere', 'HEAD');
  g('commit', '-q', '--allow-empty', '-m', 'other work');
  check('the active change survives a branch checkout', wh(cs, 'active').out === cid);
  check('the phase survives a branch checkout', wh(cs, 'state', 'get', 'phase').out === 'build');

  // Worktrees share the same state, so hooks enforce inside builder worktrees too.
  const wt = path.join(tmp, 'cs-wt');
  g('worktree', 'add', '-q', wt, '-b', 'builder-t1');
  check('a worktree sees the same active change', wh(wt, 'active').out === cid);
  check('a worktree sees the same phase', wh(wt, 'state', 'get', 'phase').out === 'build');
  wh(wt, 'mode', 'fix');
  check('a change made from a worktree is visible in the main checkout', wh(cs, 'state', 'get', 'mode').out === 'fix');
  const wtTestEdit = { session_id: 's', cwd: wt, hook_event_name: 'PreToolUse', tool_name: 'Edit',
    tool_input: { file_path: path.join(wt, 'tests', 'a.test.js') } };
  check('test-lock enforces inside a builder worktree', decision(hook('test-lock.js', wtTestEdit)) === 'deny');
  wh(cs, 'mode', 'normal');

  // Control state is managed by the CLI only, including from a worktree, where it sits outside the root.
  const editMain = { session_id: 's', cwd: cs, hook_event_name: 'PreToolUse', tool_name: 'Edit', tool_input: { file_path: stateAt } };
  const writeWt = { session_id: 's', cwd: wt, hook_event_name: 'PreToolUse', tool_name: 'Write', tool_input: { file_path: stateAt } };
  check('protect-paths denies editing control state', decision(hook('protect-paths.js', editMain)) === 'deny');
  check('protect-paths denies editing control state from a worktree', decision(hook('protect-paths.js', writeWt)) === 'deny');
}

console.log('legacy state migration');
{
  const lg = path.join(tmp, 'legacy');
  fs.mkdirSync(lg, { recursive: true });
  execFileSync('git', ['init', '-q'], { cwd: lg });
  wh(lg, 'init');
  // Lay down the old layout by hand: the active id in .workhorse/active, state.json in docs/sdlc.
  const lid = '2026-01-01-old-change';
  fs.mkdirSync(path.join(lg, 'docs', 'sdlc', lid), { recursive: true });
  fs.writeFileSync(path.join(lg, '.workhorse', 'active'), lid + '\n');
  fs.writeFileSync(path.join(lg, 'docs', 'sdlc', lid, 'state.json'), JSON.stringify({
    change_id: lid, title: 'old', tier: 1, tier_override: null, phase: 'review', mode: 'normal',
    gates: { G1: 'auto', G2: 'approved', G3: 'auto', G4: 'pending', G5: 'pending' }, verification: { status: 'green' },
  }));
  check('a legacy active change is still found', wh(lg, 'active').out === lid);
  check('legacy state is still read', wh(lg, 'state', 'get', 'phase').out === 'review');
  check('legacy state is migrated into the git common dir',
    fs.existsSync(path.join(lg, '.git', 'workhorse', 'changes', lid, 'state.json')));
}

fs.rmSync(tmp, { recursive: true, force: true });
console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
