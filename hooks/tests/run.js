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

console.log('status/metrics');
{
  const s = wh(repo, 'status', '--json');
  check('status json', s.code === 0 && JSON.parse(s.out).change_id === id, s.err);
  const m = wh(repo, 'status', '--metrics');
  check('metrics computed', m.code === 0 && JSON.parse(m.out).changes === 1, m.err);
}

fs.rmSync(tmp, { recursive: true, force: true });
console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
