#!/usr/bin/env node
// WorkHorse CLI. Called by the /wh-* skills and by agents. Zero dependencies.
//
//   wh.js init                              scaffold .workhorse/ and docs/sdlc/ in the current repo
//   wh.js new "<title>" [--tier N]          create a change, scaffold artifacts, set it active
//   wh.js active [id|--clear]               show or set the active change
//   wh.js state get [key.path]              print state (or one key) as JSON
//   wh.js state set <key.path> <value>      set a key (numbers/booleans/null/JSON parsed)
//   wh.js phase <name>                      set phase (intent|spec|plan|build|verify|review|deploy|done)
//   wh.js mode <normal|fix>                 set fix mode (locks tests)
//   wh.js gate <G1..G5> <status>            set a gate status: pending|auto|approved|rejected|n/a
//   wh.js approve <gate> [--reject] [notes] record a human decision in approvals.md (main session only)
//   wh.js required                          list human gates required for the active change
//   wh.js status [--json] [--metrics]       human-readable status
//   wh.js scaffold <template> [--out path]  render a template with state placeholders
//   wh.js plugin-root                       print the plugin root path
'use strict';
const fs = require('fs');
const path = require('path');
const L = require(path.join(__dirname, '..', 'hooks', 'scripts', 'lib.js'));

const PLUGIN_ROOT = path.resolve(__dirname, '..');
const TEMPLATES = path.join(PLUGIN_ROOT, 'templates');
const PHASES = ['intent', 'spec', 'plan', 'build', 'verify', 'review', 'deploy', 'done'];

const args = process.argv.slice(2);
const cmd = args.shift();

function die(msg, code) { process.stderr.write(`wh: ${msg}\n`); process.exit(code || 1); }
function out(s) { process.stdout.write(typeof s === 'string' ? s + '\n' : JSON.stringify(s, null, 2) + '\n'); }

function requireRoot() {
  const root = L.findRoot(process.cwd());
  if (!root) die('not inside a WorkHorse repo (no .workhorse/profile.yml found). Run "wh.js init" or /workhorse:onboard first.');
  return root;
}
function requireActive(root) {
  const id = L.activeChangeId(root);
  if (!id) die('no active change. Run "wh.js new <title>" or /workhorse:intent.');
  const state = L.loadState(root, id);
  if (!state) die(`state.json missing for change ${id}`);
  return { id, state };
}
function slug(s) {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 48);
}
function today() { return new Date().toISOString().slice(0, 10); }
function flag(name) {
  const i = args.indexOf(name);
  if (i < 0) return null;
  const v = args[i + 1];
  args.splice(i, 2);
  return v === undefined ? true : v;
}
function hasFlag(name) {
  const i = args.indexOf(name);
  if (i < 0) return false;
  args.splice(i, 1);
  return true;
}
function parseValue(v) {
  if (v === undefined) return null;
  if (v === 'null') return null;
  if (v === 'true') return true;
  if (v === 'false') return false;
  if (/^-?\d+(\.\d+)?$/.test(v)) return Number(v);
  if (/^[\[{"]/.test(v)) { try { return JSON.parse(v); } catch (e) { /* fallthrough */ } }
  return v;
}
function setPath(obj, keyPath, value) {
  const parts = keyPath.split('.');
  let cur = obj;
  for (let i = 0; i < parts.length - 1; i++) {
    if (typeof cur[parts[i]] !== 'object' || cur[parts[i]] === null) cur[parts[i]] = {};
    cur = cur[parts[i]];
  }
  cur[parts[parts.length - 1]] = value;
}
function getPath(obj, keyPath) {
  return keyPath.split('.').reduce((o, k) => (o == null ? undefined : o[k]), obj);
}
function render(template, vars) {
  return template.replace(/\{\{(\w+)\}\}/g, (m, k) => (vars[k] !== undefined && vars[k] !== null ? String(vars[k]) : m));
}
function stateVars(root, id, state) {
  const p = (() => { try { return L.loadProfile(root); } catch (e) { return {}; } })();
  return {
    change_id: id,
    title: state.title || id,
    tier: L.effectiveTier(state),
    tier_reason: state.tier_reason || '',
    branch: state.branch || '',
    worktree: state.worktree || '',
    date: today(),
    timestamp: L.nowIso(),
    commit: L.git(root, ['rev-parse', '--short', 'HEAD']) || '',
    requester: L.git(root, ['config', 'user.email']) || '',
    client_name: (p.client && p.client.name) || '',
    branch_prefix: (p.conventions && p.conventions.branch_prefix) || 'wh/',
    commit_style: (p.conventions && p.conventions.commit_style) || 'conventional',
    protected_paths: ((p.protected_paths || []).join(', ')),
    install: (p.commands && p.commands.install) || '',
    typecheck: (p.commands && p.commands.typecheck) || '',
    lint: (p.commands && p.commands.lint) || '',
    test: (p.commands && p.commands.test) || '',
    build: (p.commands && p.commands.build) || '',
    skills: '',
    gate: '',
    pr_url: state.pr_url || '',
    version: '',
    security_checklist: L.effectiveTier(state) >= 2 ? '\n### Pre-ship security checklist (tier 2+)\n\nSee the wh-security-baseline skill; every item must be ticked or explicitly waived with a reason.\n' : '',
  };
}

switch (cmd) {
  case 'plugin-root': out(PLUGIN_ROOT); break;

  case 'init': {
    const root = process.cwd();
    const wh = path.join(root, '.workhorse');
    fs.mkdirSync(wh, { recursive: true });
    fs.mkdirSync(path.join(root, 'docs', 'sdlc'), { recursive: true });
    const prof = path.join(wh, 'profile.yml');
    if (!fs.existsSync(prof)) fs.copyFileSync(path.join(TEMPLATES, 'profile.yml'), prof);
    const active = path.join(wh, 'active');
    if (!fs.existsSync(active)) fs.writeFileSync(active, '');
    const gi = path.join(root, '.gitignore');
    const line = '.worktrees/';
    const cur = fs.existsSync(gi) ? fs.readFileSync(gi, 'utf8') : '';
    if (!cur.split(/\r?\n/).includes(line)) fs.appendFileSync(gi, (cur && !cur.endsWith('\n') ? '\n' : '') + line + '\n');
    out(`initialised ${wh} and docs/sdlc/. Edit .workhorse/profile.yml (or run /workhorse:onboard to have it written for you).`);
    break;
  }

  case 'new': {
    const root = requireRoot();
    const tier = flag('--tier');
    const title = args.join(' ').trim();
    if (!title) die('usage: wh.js new "<title>" [--tier N]');
    const id = `${today()}-${slug(title)}`;
    const dir = L.changeDir(root, id);
    if (fs.existsSync(dir)) die(`change ${id} already exists`);
    fs.mkdirSync(path.join(dir, 'adr'), { recursive: true });
    const profile = L.loadProfile(root);
    const state = JSON.parse(fs.readFileSync(path.join(TEMPLATES, 'state.json'), 'utf8'));
    state.change_id = id;
    state.title = title;
    state.tier = tier !== null ? Number(tier) : null;
    state.branch = `${(profile.conventions && profile.conventions.branch_prefix) || 'wh/'}${id}`;
    state.phase = 'intent';
    L.saveState(root, id, state);
    fs.writeFileSync(path.join(root, '.workhorse', 'active'), id + '\n');
    const vars = stateVars(root, id, state);
    for (const t of ['intent.md', 'approvals.md']) {
      fs.writeFileSync(path.join(dir, t), render(fs.readFileSync(path.join(TEMPLATES, t), 'utf8'), vars));
    }
    out({ change_id: id, dir: path.relative(root, dir), branch: state.branch });
    break;
  }

  case 'active': {
    const root = requireRoot();
    if (hasFlag('--clear')) { fs.writeFileSync(path.join(root, '.workhorse', 'active'), ''); out('cleared'); break; }
    if (args[0]) {
      if (!fs.existsSync(L.changeDir(root, args[0]))) die(`no such change ${args[0]}`);
      fs.writeFileSync(path.join(root, '.workhorse', 'active'), args[0] + '\n');
      out(args[0]);
    } else out(L.activeChangeId(root) || '');
    break;
  }

  case 'state': {
    const root = requireRoot();
    const { id, state } = requireActive(root);
    const sub = args.shift();
    if (sub === 'get') { const k = args[0]; out(k ? getPath(state, k) : state); break; }
    if (sub === 'set') {
      const k = args[0]; const v = parseValue(args[1]);
      if (!k) die('usage: wh.js state set <key.path> <value>');
      if (k === 'gates' || k.startsWith('gates.')) {
        // Gates are set through "gate" (auto/n-a/pending) or "approve" (approved/rejected).
        die('use "wh.js gate <G> <status>" for gate status; "approved" is only set by "wh.js approve".');
      }
      if (k === 'verification.status' && v === 'green') {
        const vf = path.join(L.changeDir(root, id), 'verification.md');
        if (!fs.existsSync(vf)) die('cannot mark verification green: verification.md does not exist');
        const txt = fs.readFileSync(vf, 'utf8');
        if (!/^Status:\s*green/m.test(txt)) die('cannot mark verification green: verification.md does not say "Status: green"');
        setPath(state, 'verification.at', L.nowIso());
      }
      setPath(state, k, v);
      L.saveState(root, id, state);
      out({ [k]: v });
      break;
    }
    die('usage: wh.js state get [key] | set <key> <value>');
    break;
  }

  case 'phase': {
    const root = requireRoot();
    const { id, state } = requireActive(root);
    const p = args[0];
    if (!PHASES.includes(p)) die(`phase must be one of ${PHASES.join(', ')}`);
    state.phase = p;
    if (p !== 'verify' && p !== 'build') state.mode = 'normal';
    L.saveState(root, id, state);
    out({ phase: p });
    break;
  }

  case 'mode': {
    const root = requireRoot();
    const { id, state } = requireActive(root);
    const m = args[0];
    if (m !== 'normal' && m !== 'fix') die('mode must be normal or fix');
    state.mode = m;
    L.saveState(root, id, state);
    out({ mode: m });
    break;
  }

  case 'gate': {
    const root = requireRoot();
    const { id, state } = requireActive(root);
    const [g, s] = args;
    if (!L.ALL_GATES.includes(g)) die('gate must be G1..G5');
    if (!['pending', 'auto', 'n/a'].includes(s)) die('status must be pending, auto, or n/a (approved/rejected come from "approve")');
    const profile = L.loadProfile(root);
    if (s === 'auto' && L.requiredGates(state, profile).includes(g)) die(`${g} is a required human gate for tier ${L.effectiveTier(state)} under autonomy "${profile.autonomy || 'bounded'}"; it cannot be auto-approved.`);
    state.gates = state.gates || {};
    state.gates[g] = s;
    L.saveState(root, id, state);
    out({ [g]: s });
    break;
  }

  case 'approve': {
    const root = requireRoot();
    const { id, state } = requireActive(root);
    const reject = hasFlag('--reject');
    const g = args.shift();
    if (!L.ALL_GATES.includes(g)) die('usage: wh.js approve <G1..G5> [--reject] [notes]');
    const notes = args.join(' ').trim();
    if (reject && !notes) die('a rejection needs notes so the phase can be re-entered with them');
    const who = L.git(root, ['config', 'user.email']) || process.env.USER || process.env.USERNAME || 'unknown';
    const commit = L.git(root, ['rev-parse', 'HEAD']) || 'no-commit';
    const at = L.nowIso();
    const status = reject ? 'rejected' : 'approved';
    const block = [
      '',
      `## ${g}: ${status}`,
      '',
      `- Who: ${who}`,
      `- When: ${at}`,
      `- Artifact commit: \`${commit}\``,
      `- Tier at decision: ${L.effectiveTier(state)}${state.tier_override !== null && state.tier_override !== undefined ? ' (override)' : ''}`,
      `- Notes: ${notes || 'none'}`,
      '',
    ].join('\n');
    const af = path.join(L.changeDir(root, id), 'approvals.md');
    if (!fs.existsSync(af)) fs.writeFileSync(af, render(fs.readFileSync(path.join(TEMPLATES, 'approvals.md'), 'utf8'), stateVars(root, id, state)));
    fs.appendFileSync(af, block);
    state.gates = state.gates || {};
    state.gates[g] = status;
    if (reject) state.last_rejection = { gate: g, notes, at };
    L.saveState(root, id, state);
    // Commit the approval so the audit trail is in git history.
    L.git(root, ['add', path.relative(root, af), path.relative(root, path.join(L.changeDir(root, id), 'state.json'))]);
    const sha = L.git(root, ['commit', '-q', '-m', `chore(sdlc): ${g} ${status} for ${id}`, '--', path.relative(root, af), path.relative(root, path.join(L.changeDir(root, id), 'state.json'))]);
    out({ gate: g, status, who, at, committed: sha !== '' || L.git(root, ['log', '-1', '--format=%h']) });
    break;
  }

  case 'required': {
    const root = requireRoot();
    const { state } = requireActive(root);
    out(L.requiredGates(state, L.loadProfile(root)));
    break;
  }

  case 'status': {
    const root = requireRoot();
    const json = hasFlag('--json');
    const metrics = hasFlag('--metrics');
    const profile = L.loadProfile(root);
    const id = L.activeChangeId(root);
    if (metrics) { out(computeMetrics(root)); break; }
    if (!id) { out(json ? { active: null } : 'No active change.'); break; }
    const state = L.loadState(root, id);
    const req = L.requiredGates(state, profile);
    const blocking = req.find((g) => (state.gates || {})[g] !== 'approved');
    const summary = {
      change_id: id, title: state.title, tier: L.effectiveTier(state), phase: state.phase, mode: state.mode,
      branch: state.branch, worktree: state.worktree, gates: state.gates, required_human_gates: req,
      verification: state.verification, next_blocking_gate: blocking || null, autonomy: profile.autonomy || 'bounded',
      artifacts: fs.existsSync(L.changeDir(root, id)) ? fs.readdirSync(L.changeDir(root, id)).filter((f) => f !== 'adr') : [],
    };
    if (json) { out(summary); break; }
    out([
      `Change: ${id} "${state.title}"`,
      `Tier: ${summary.tier}   Phase: ${state.phase}   Mode: ${state.mode}   Autonomy: ${summary.autonomy}`,
      `Branch: ${state.branch || '-'}   Worktree: ${state.worktree || '-'}`,
      `Gates: ${Object.entries(state.gates || {}).map(([g, v]) => `${g}=${v}`).join('  ')}`,
      `Required human gates: ${req.join(', ')}`,
      `Verification: ${(state.verification || {}).status || 'none'}`,
      `Next blocking gate: ${blocking || 'none'}`,
      `Artifacts: ${summary.artifacts.join(', ') || 'none'}`,
    ].join('\n'));
    break;
  }

  case 'scaffold': {
    const root = requireRoot();
    const { id, state } = requireActive(root);
    const outPath = flag('--out');
    const gate = flag('--gate');
    const name = args[0];
    if (!name) die('usage: wh.js scaffold <template.md> [--out path] [--gate G4]');
    const src = path.join(TEMPLATES, name);
    if (!fs.existsSync(src)) die(`no template ${name}`);
    const vars = stateVars(root, id, state);
    if (gate) vars.gate = gate;
    const text = render(fs.readFileSync(src, 'utf8'), vars);
    const dest = outPath ? path.resolve(root, outPath) : path.join(L.changeDir(root, id), name);
    if (fs.existsSync(dest)) die(`${path.relative(root, dest)} exists; delete it first if you mean to regenerate`);
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    fs.writeFileSync(dest, text);
    out(path.relative(root, dest));
    break;
  }

  default:
    die(`unknown command "${cmd || ''}". See the header of scripts/wh.js for usage.`);
}

function computeMetrics(root) {
  const base = path.join(root, 'docs', 'sdlc');
  if (!fs.existsSync(base)) return { changes: 0 };
  const rows = [];
  for (const id of fs.readdirSync(base)) {
    const sp = path.join(base, id, 'state.json');
    if (!fs.existsSync(sp)) continue;
    const s = JSON.parse(fs.readFileSync(sp, 'utf8'));
    const af = path.join(base, id, 'approvals.md');
    const txt = fs.existsSync(af) ? fs.readFileSync(af, 'utf8') : '';
    const approvals = (txt.match(/^## G\d: (approved|rejected)/gm) || []);
    const rejections = approvals.filter((a) => a.endsWith('rejected')).length;
    const vtxt = fs.existsSync(path.join(base, id, 'verification.md')) ? fs.readFileSync(path.join(base, id, 'verification.md'), 'utf8') : '';
    const fixRows = (vtxt.match(/^\| \d+ \|/gm) || []).length;
    rows.push({ id, tier: L.effectiveTier(s), phase: s.phase, rejections, fix_iterations: fixRows, gates: s.gates });
  }
  const done = rows.filter((r) => r.phase === 'done' || r.phase === 'deploy');
  return {
    changes: rows.length,
    completed: done.length,
    single_pass_rate: rows.length ? Number((rows.filter((r) => r.rejections === 0).length / rows.length).toFixed(2)) : null,
    mean_rework_cycles: rows.length ? Number((rows.reduce((a, r) => a + r.rejections, 0) / rows.length).toFixed(2)) : null,
    mean_fix_iterations: rows.length ? Number((rows.reduce((a, r) => a + r.fix_iterations, 0) / rows.length).toFixed(2)) : null,
    by_tier: [0, 1, 2, 3].map((t) => ({ tier: t, count: rows.filter((r) => r.tier === t).length })),
    changes_detail: rows,
  };
}
