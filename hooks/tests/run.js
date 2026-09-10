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
  const a = wh(repo, 'approve', 'G4', 'looks good');
  check('approve records', a.code === 0 && /approved/.test(a.out), a.err);
  const af = fs.readFileSync(path.join(repo, 'docs', 'sdlc', id, 'approvals.md'), 'utf8');
  check('approvals.md has who/when/commit', /Who: tester@example.com/.test(af) && /Artifact commit:/.test(af));
  check('approval committed', /G4 approved/.test(execFileSync('git', ['log', '-1', '--format=%s'], { cwd: repo, encoding: 'utf8' })));
  check('allows merge after G4', decision(hook('gate-guard.js', bash('gh pr merge 12'))) === 'none');
  check('allows release.md after G4', decision(hook('gate-guard.js', edit(`docs/sdlc/${id}/release.md`))) === 'none');
  const rj = wh(repo, 'approve', 'G5', '--reject');
  check('reject needs notes', rj.code !== 0);
  const rj2 = wh(repo, 'approve', 'G5', '--reject', 'not yet');
  check('reject records', rj2.code === 0 && wh(repo, 'state', 'get', 'gates.G5').out === 'rejected');
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

  // Approval flips waiting_on and is parsed back out of approvals.md.
  fs.writeFileSync(path.join(ddir, 'verification.md'), '# Verification\n\nStatus: green\n');
  wh(repo, 'state', 'set', 'verification.status', 'green');
  const ap = wh(repo, 'approve', 'G4', 'ship it');
  check('approve succeeds for the digest fixture', ap.code === 0, ap.err);
  const la = d().last_approval;
  check('digest parses the full approval block', la && la.gate === 'G4' && la.status === 'approved'
    && la.who === 'tester@example.com' && la.at.length > 0 && la.notes === 'ship it', JSON.stringify(la));
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

fs.rmSync(tmp, { recursive: true, force: true });
console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
