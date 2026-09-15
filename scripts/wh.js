#!/usr/bin/env node
// WorkHorse CLI. Called by the /wh-* skills and by agents. Zero dependencies.
//
//   wh.js init                              scaffold .workhorse/ and docs/sdlc/ in the current repo
//   wh.js new "<title>" [--tier N]          create a change, scaffold artifacts, set it active
//   wh.js active [id|--clear]               show or set the active change
//   wh.js state get [key.path]              print state (or one key) as JSON
//   wh.js state set <key.path> <value>      set a key (numbers/booleans/null/JSON parsed)
//   wh.js phase <name>                      set phase (intent|spec|plan|build|verify|review|deploy|done);
//                                           "done" also commits the change's artifacts
//   wh.js mode <normal|fix>                 set fix mode (locks tests)
//   wh.js gate <G1..G5> <status>            set a gate status: pending|auto|approved|rejected|n/a
//   wh.js approve <gate> [--reject] [notes] record a human decision in approvals.md (main session only)
//   wh.js required                          list human gates required for the active change
//   wh.js log "<agent> | <result>"          append a line to conductor-log.md, stamped with the real time
//   wh.js status [--json] [--metrics]       human-readable status
//   wh.js scaffold <template> [--out path]  render a template with state placeholders
//   wh.js digest [--json] [--all]           emit the tracker sync payload (one change, or every change)
//   wh.js plugin-root                       print the plugin root path
'use strict';
const fs = require('fs');
const crypto = require('crypto');
const path = require('path');
const L = require(path.join(__dirname, '..', 'hooks', 'scripts', 'lib.js'));

const PLUGIN_ROOT = path.resolve(__dirname, '..');
const TEMPLATES = path.join(PLUGIN_ROOT, 'templates');
const PHASES = ['intent', 'spec', 'plan', 'build', 'verify', 'review', 'deploy', 'done'];
/** The packet a human reads at each gate, and therefore the artifact an approval must pin. */
const GATE_PACKET = { G1: 'intent.md', G2: 'spec.md', G3: 'plan.md', G4: 'review-packet.md', G5: 'release.md' };

// The gate that closes each phase, and the artifact that must exist for that gate to be live.
// A phase whose gate is required, still pending, and whose packet exists is waiting on a human.
const PHASE_GATE = { intent: 'G1', spec: 'G2', plan: 'G3', review: 'G4', deploy: 'G5' };
const PHASE_ARTIFACT = {
  intent: 'intent.md', spec: 'spec.md', plan: 'plan.md',
  review: 'review-packet.md', deploy: 'release.md',
};


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
    // Control state lives in the git common dir (see lib.js). These ignores cover the legacy file
    // and the no-git fallback, so neither can ever be committed and then rewritten by a checkout.
    const gi = path.join(root, '.gitignore');
    for (const line of ['.worktrees/', '.workhorse/active', '.workhorse/state/']) {
      const cur = fs.existsSync(gi) ? fs.readFileSync(gi, 'utf8') : '';
      if (!cur.split(/\r?\n/).includes(line)) fs.appendFileSync(gi, (cur && !cur.endsWith('\n') ? '\n' : '') + line + '\n');
    }
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
    L.setActiveChangeId(root, id);
    const vars = stateVars(root, id, state);
    for (const t of ['intent.md', 'approvals.md']) {
      fs.writeFileSync(path.join(dir, t), render(fs.readFileSync(path.join(TEMPLATES, t), 'utf8'), vars));
    }
    out({ change_id: id, dir: path.relative(root, dir), branch: state.branch });
    break;
  }

  case 'active': {
    const root = requireRoot();
    if (hasFlag('--clear')) { L.setActiveChangeId(root, ''); out('cleared'); break; }
    if (args[0]) {
      if (!fs.existsSync(L.changeDir(root, args[0])) && !L.loadState(root, args[0])) die(`no such change ${args[0]}`);
      L.setActiveChangeId(root, args[0]);
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
        // A profile with no checks would make "every defined check passed" vacuously true, so a
        // greenfield repo could report green having run nothing. Refuse that outright.
        const prof = L.loadProfile(root);
        const CHECKS = ['typecheck', 'lint', 'test', 'build', 'e2e', 'security_audit', 'screenshot'];
        const defined = CHECKS.filter((c) => (prof.commands || {})[c]);
        if (defined.length === 0) {
          die('cannot mark verification green: .workhorse/profile.yml defines no checks, so green would prove nothing. Set at least commands.test, then re-verify.');
        }
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
    // The retro must exist before the change closes, so the close commit carries it. A live run
    // closed first and would have left retro.md out of history; the order is now enforced here.
    if (p === 'done' && !hasFlag('--no-retro') &&
        !fs.existsSync(path.join(L.changeDir(root, id), 'retro.md'))) {
      die('cannot close the change: retro.md does not exist. Dispatch wh-retro-learner first, or pass --no-retro to close without one.');
    }
    state.phase = p;
    if (p !== 'verify' && p !== 'build') state.mode = 'normal';
    L.saveState(root, id, state);
    let committed = null;
    if (p === 'done') {
      // Close the change in git history. A live run reached done with release.md, retro.md and
      // the last conductor-log lines never committed, so the record of the change was incomplete.
      const dirRel = path.relative(root, L.changeDir(root, id)).split(path.sep).join('/');
      // The retro's instinct files live at .workhorse/instincts/, outside the change folder,
      // because they accumulate across changes. A live run left them untracked; they are the
      // record of what the pipeline learned, so the close commit carries them too.
      const paths = [dirRel];
      if (fs.existsSync(path.join(root, '.workhorse', 'instincts'))) paths.push('.workhorse/instincts');
      L.git(root, ['add', '--', ...paths]);
      // Exits non-zero when nothing is staged; then there is nothing left to record.
      L.git(root, ['commit', '-q', '-m', `chore(sdlc): close ${id}`, '--', ...paths]);
      committed = L.git(root, ['log', '-1', '--format=%h', '--', ...paths]) || null;
    }
    out(committed ? { phase: p, committed } : { phase: p });
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

    // Pin what is being decided before recording the decision. Without this the recorded commit
    // was simply HEAD, which did not contain the packet: agents write artifacts but nothing had
    // committed them, so an approved spec could be edited afterwards with no trace of what was
    // actually signed off. Commit the change's artifacts first, so the recorded commit really
    // contains the packet, and hash the packet itself, so any later edit is detectable.
    const dirRel = path.relative(root, L.changeDir(root, id)).split(path.sep).join('/');
    const packetRel = `${dirRel}/${GATE_PACKET[g]}`;
    const packetAbs = path.join(root, packetRel);
    const packetSha = fs.existsSync(packetAbs)
      ? crypto.createHash('sha256').update(fs.readFileSync(packetAbs)).digest('hex')
      : null;
    L.git(root, ['add', '--', dirRel]);
    // Exits non-zero when nothing is staged (already committed); HEAD then contains it anyway.
    L.git(root, ['commit', '-q', '-m', `chore(sdlc): ${g} packet for ${id}`, '--', dirRel]);
    const commit = L.git(root, ['rev-parse', 'HEAD']) || 'no-commit';
    const at = L.nowIso();
    const status = reject ? 'rejected' : 'approved';
    const block = [
      '',
      `## ${g}: ${status}`,
      '',
      `- Who: ${who}`,
      `- When: ${at}`,
      `- Artifact commit: \`${commit}\` (contains the packet below)`,
      `- Packet: \`${packetRel}\` sha256 \`${packetSha || 'missing: no packet file existed at decision time'}\``,
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
    // state.json is machine state kept outside git; approvals.md is the audit record.
    L.git(root, ['add', '--', path.relative(root, af)]);
    const sha = L.git(root, ['commit', '-q', '-m', `chore(sdlc): ${g} ${status} for ${id}`, '--', path.relative(root, af)]);
    out({ gate: g, status, who, at, committed: sha !== '' || L.git(root, ['log', '-1', '--format=%h']) });
    break;
  }

  case 'log': {
    // The conductor has no clock of its own; a live run showed it inventing timestamps that ran
    // ahead of the file's own write time. The CLI stamps the time and the phase instead.
    const root = requireRoot();
    const { id, state } = requireActive(root);
    // The CLI adds the phase itself; drop one the caller included, which doubled it in live logs.
    const msg = args.join(' ').replace(/\s+/g, ' ').trim().replace(new RegExp(`^${state.phase}\\s*\\|\\s*`), '');
    if (!msg) die('usage: wh.js log "<agent> | <result>"');
    const f = path.join(L.changeDir(root, id), 'conductor-log.md');
    if (!fs.existsSync(f)) fs.writeFileSync(f, `# Conductor log: ${id}\n\n`);
    const line = `${L.nowIso()} | ${state.phase} | ${msg}`;
    fs.appendFileSync(f, line + '\n');
    out(line);
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

  case 'digest': {
    const root = requireRoot();
    const all = hasFlag('--all');
    hasFlag('--json'); // accepted and ignored: the digest is always JSON
    if (all) {
      const ids = L.listChangeIds(root);
      out(ids.map((cid) => buildDigest(root, cid, L.loadState(root, cid))));
      break;
    }
    const { id, state } = requireActive(root);
    out(buildDigest(root, id, state));
    break;
  }

  default:
    die(`unknown command "${cmd || ''}". See the header of scripts/wh.js for usage.`);
}

function computeMetrics(root) {
  const base = path.join(root, 'docs', 'sdlc');
  const rows = [];
  for (const id of L.listChangeIds(root)) {
    const s = L.loadState(root, id);
    if (!s) continue;
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

// ---------- tracker digest ----------

function readArtifact(root, id, name) {
  const p = path.join(L.changeDir(root, id), name);
  return fs.existsSync(p) ? fs.readFileSync(p, 'utf8') : '';
}

// First prose paragraph under the heading matching `re`, collapsed to one line.
function sectionText(md, re, maxLen) {
  if (!md) return '';
  const lines = md.split(/\r?\n/);
  let i = lines.findIndex((l) => re.test(l));
  if (i < 0) return '';
  const buf = [];
  for (i += 1; i < lines.length; i++) {
    const l = lines[i];
    if (/^#{1,6}\s/.test(l)) break;
    if (!l.trim()) { if (buf.length) break; continue; }
    if (/^(\||-{3,}|<!--)/.test(l.trim())) break;
    buf.push(l.trim());
  }
  const t = buf.join(' ').replace(/\s+/g, ' ').trim();
  return maxLen && t.length > maxLen ? t.slice(0, maxLen - 1) + '\u2026' : t;
}

// Rows of the "Decisions requested" table in a gate packet, as short strings.
function decisionRows(md, max) {
  if (!md) return [];
  const lines = md.split(/\r?\n/);
  const start = lines.findIndex((l) => /^#{1,6}.*decisions requested/i.test(l));
  if (start < 0) return [];
  const rows = [];
  for (let i = start + 1; i < lines.length && rows.length < (max || 5); i++) {
    const l = lines[i].trim();
    if (/^#{1,6}\s/.test(l)) break;
    if (!l.startsWith('|')) continue;
    const cells = l.split('|').slice(1, -1).map((c) => c.trim());
    if (cells.length < 2) continue;
    if (/^:?-{2,}/.test(cells[0])) continue;
    if (/^#$/.test(cells[0]) && /^decision$/i.test(cells[1] || '')) continue;
    const text = cells.slice(0, 3).filter(Boolean).join(' \u2014 ');
    if (text) rows.push(text.length > 300 ? text.slice(0, 299) + '\u2026' : text);
  }
  return rows;
}

function lastApproval(root, id) {
  const md = readArtifact(root, id, 'approvals.md');
  if (!md) return null;
  // Split rather than match: a lazy regex with an `m`-flag `$` stops at the first line break.
  const blocks = md.split(/^## /m).slice(1);
  for (let i = blocks.length - 1; i >= 0; i--) {
    const b = blocks[i];
    const head = b.match(/^(G\d): (approved|rejected)/);
    if (!head) continue;
    const field = (n) => ((b.match(new RegExp('^- ' + n + ': (.*)$', 'm')) || [])[1] || '').trim();
    return { gate: head[1], status: head[2], who: field('Who'), at: field('When'), notes: field('Notes') };
  }
  return null;
}

function buildDigest(root, id, state) {
  const profile = (() => { try { return L.loadProfile(root); } catch (e) { return {}; } })();
  const tier = L.effectiveTier(state);
  const required = L.requiredGates(state, profile);
  const gates = state.gates || {};
  const phase = state.phase;

  const gateHere = PHASE_GATE[phase];
  const artifactHere = PHASE_ARTIFACT[phase];
  const packetExists = artifactHere
    ? fs.existsSync(path.join(L.changeDir(root, id), artifactHere))
    : false;
  // Only a pending gate waits on the human. A rejected one waits on the agents reworking it; the
  // conductor sets it back to pending when it presents the gate again. Treating "rejected" as
  // waiting (the old `!== 'approved'`) showed Approve buttons and would have suppressed the
  // re-presentation notification, because the gate never appeared to change.
  const humanGate =
    gateHere && required.includes(gateHere) && (gates[gateHere] || 'pending') === 'pending' && packetExists
      ? gateHere
      : null;

  const packetMd = artifactHere ? readArtifact(root, id, artifactHere) : '';
  const intentMd = readArtifact(root, id, 'intent.md');
  const verification = state.verification || {};

  // owner/repo only when origin is a real git host; a local or odd remote falls back to the folder.
  const remote = L.git(root, ['config', '--get', 'remote.origin.url']);
  const hosted = /^(https?:\/\/|git@|ssh:\/\/)/.test(remote || '');
  const repoName = hosted
    ? remote.replace(/\.git$/, '').split(/[/:]/).slice(-2).join('/')
    : path.basename(root);

  return {
    change_id: id,
    title: state.title || id,
    client: (profile.client && profile.client.name) || '',
    repo: repoName,
    tier,
    tier_reason: state.tier_reason || '',
    phase,
    mode: state.mode || 'normal',
    status_label: phase === 'done' ? 'Done' : phase.charAt(0).toUpperCase() + phase.slice(1),
    waiting_on: humanGate ? 'You (' + humanGate + ')' : (phase === 'done' ? 'Nobody' : 'Agents'),
    blocking_gate: humanGate,
    gates,
    required_human_gates: required,
    verification: verification.status || 'none',
    branch: state.branch || '',
    pr_url: state.pr_url || '',
    commit: L.git(root, ['rev-parse', '--short', 'HEAD']) || '',
    problem: sectionText(intentMd, /^#{1,6}\s*problem\b/i, 600),
    outcome: sectionText(intentMd, /^#{1,6}\s*outcome\b/i, 600),
    tldr: sectionText(packetMd, /^#{1,6}.*(tl;dr|tldr)/i, 900),
    decisions: decisionRows(packetMd, 5),
    last_approval: lastApproval(root, id),
    artifacts: fs.existsSync(L.changeDir(root, id))
      ? fs.readdirSync(L.changeDir(root, id)).filter((f) => f.endsWith('.md')).sort()
      : [],
    artifact_dir: 'docs/sdlc/' + id + '/',
    tracker: {
      provider: (profile.tracker && profile.tracker.provider) || '',
      database: (profile.tracker && profile.tracker.database) || '',
      page_id: (state.tracker && state.tracker.page_id) || null,
    },
    updated_at: state.updated_at || L.nowIso(),
  };
}
