// Shared helpers for WorkHorse hooks and the wh CLI. Zero dependencies. Node 18+.
'use strict';
const fs = require('fs');
const path = require('path');

// ---------- stdin / stdout contract ----------

function readStdinJson() {
  try {
    const raw = fs.readFileSync(0, 'utf8');
    return raw.trim() ? JSON.parse(raw) : {};
  } catch (e) {
    return {};
  }
}

function emit(obj) {
  process.stdout.write(JSON.stringify(obj));
}

function preToolDecision(decision, reason, extra) {
  const out = { hookSpecificOutput: { hookEventName: 'PreToolUse', permissionDecision: decision } };
  if (reason) out.hookSpecificOutput.permissionDecisionReason = reason;
  if (extra && extra.additionalContext) out.hookSpecificOutput.additionalContext = extra.additionalContext;
  emit(out);
}

function allow(reason) { preToolDecision('allow', reason); }
function deny(reason) { preToolDecision('deny', reason); }
function ask(reason) { preToolDecision('ask', reason); }

// Fail open: warn Claude, but do not block. Used when state cannot be read.
function failOpen(msg) {
  emit({ hookSpecificOutput: { hookEventName: 'PreToolUse', permissionDecision: 'allow', additionalContext: `[workhorse] ${msg}` } });
}

// ---------- repo discovery ----------

function findRoot(startDir) {
  if (process.env.WORKHORSE_ROOT && fs.existsSync(path.join(process.env.WORKHORSE_ROOT, '.workhorse', 'profile.yml'))) {
    return process.env.WORKHORSE_ROOT;
  }
  let dir = path.resolve(startDir || process.cwd());
  for (let i = 0; i < 40; i++) {
    if (fs.existsSync(path.join(dir, '.workhorse', 'profile.yml'))) return dir;
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return null;
}

function isInsideWorktree(root) {
  return root ? /[\\/]\.worktrees[\\/]/.test(root + path.sep) : false;
}

function loadProfile(root) {
  const p = path.join(root, '.workhorse', 'profile.yml');
  return parseYaml(fs.readFileSync(p, 'utf8'));
}

function activeChangeId(root) {
  const p = path.join(root, '.workhorse', 'active');
  if (!fs.existsSync(p)) return null;
  const id = fs.readFileSync(p, 'utf8').trim();
  return id || null;
}

function changeDir(root, id) {
  return path.join(root, 'docs', 'sdlc', id);
}

function loadState(root, id) {
  const p = path.join(changeDir(root, id), 'state.json');
  if (!fs.existsSync(p)) return null;
  return JSON.parse(fs.readFileSync(p, 'utf8'));
}

function saveState(root, id, state) {
  state.updated_at = new Date().toISOString();
  const p = path.join(changeDir(root, id), 'state.json');
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, JSON.stringify(state, null, 2) + '\n');
}

// Returns { root, profile, id, state } or nulls, never throws.
function loadContext(cwd) {
  const out = { root: null, profile: null, id: null, state: null, error: null };
  try {
    out.root = findRoot(cwd);
    if (!out.root) return out;
    out.profile = loadProfile(out.root);
    out.id = activeChangeId(out.root);
    if (out.id) out.state = loadState(out.root, out.id);
  } catch (e) {
    out.error = e.message;
  }
  return out;
}

// ---------- gates ----------

const ALL_GATES = ['G1', 'G2', 'G3', 'G4', 'G5'];
const TIER_GATES = {
  0: ['G4'],
  1: ['G2', 'G4'],
  2: ['G1', 'G2', 'G3', 'G4', 'G5'],
  3: ['G1', 'G2', 'G3', 'G4', 'G5'],
};

function effectiveTier(state) {
  if (!state) return 0;
  if (state.tier_override !== null && state.tier_override !== undefined) return Number(state.tier_override);
  return state.tier === null || state.tier === undefined ? 0 : Number(state.tier);
}

// Which gates need a human for this change. Autonomy can add gates, never remove G4.
function requiredGates(state, profile) {
  const tier = effectiveTier(state);
  const autonomy = (profile && profile.autonomy) || 'bounded';
  if (autonomy === 'assisted' || autonomy === 'shadow') return ALL_GATES.slice();
  const gates = new Set(TIER_GATES[Math.min(Math.max(tier, 0), 3)] || ['G4']);
  gates.add('G4');
  return ALL_GATES.filter((g) => gates.has(g));
}

function gateSatisfied(state, profile, gate) {
  const required = requiredGates(state, profile).includes(gate);
  const status = state && state.gates ? state.gates[gate] : 'pending';
  if (!required) return true;
  return status === 'approved';
}

// Artifact that opens each phase, and the gate that must be satisfied before it may be written.
const PHASE_ARTIFACT_GATE = {
  'spec.md': 'G1',
  'evals.md': 'G1',
  'plan.md': 'G2',
  'verification.md': 'G3',
  'review-packet.md': 'G3',
  'release.md': 'G4',
};

// ---------- paths ----------

function normalize(p) {
  return p.replace(/\\/g, '/');
}

function relToRoot(root, filePath) {
  const abs = path.isAbsolute(filePath) ? filePath : path.resolve(process.cwd(), filePath);
  const rel = path.relative(root, abs);
  if (rel.startsWith('..')) return null; // outside root
  return normalize(rel);
}

// Minimal glob: ** matches any path segment(s), * matches within a segment, ? one char.
function globToRegex(glob) {
  let g = normalize(glob).replace(/^\.\//, '');
  let re = '';
  for (let i = 0; i < g.length; i++) {
    const c = g[i];
    if (c === '*') {
      if (g[i + 1] === '*') {
        // ** or **/
        if (g[i + 2] === '/') { re += '(?:.*/)?'; i += 2; } else { re += '.*'; i += 1; }
      } else {
        re += '[^/]*';
      }
    } else if (c === '?') re += '[^/]';
    else if ('.+^${}()|[]\\'.includes(c)) re += '\\' + c;
    else re += c;
  }
  // A glob without a slash matches at any depth (like gitignore).
  if (!g.includes('/')) re = '(?:.*/)?' + re;
  return new RegExp('^' + re + '$');
}

function matchesAny(relPath, globs) {
  if (!relPath || !Array.isArray(globs)) return null;
  const p = normalize(relPath);
  for (const g of globs) {
    if (typeof g === 'string' && globToRegex(g).test(p)) return g;
  }
  return null;
}

function toolFilePath(input) {
  const ti = (input && input.tool_input) || {};
  return ti.file_path || ti.notebook_path || ti.path || null;
}

// ---------- tiny YAML subset parser ----------
// Supports: nested maps by indentation, "- item" lists, scalars, quoted strings, comments,
// inline [a, b] lists and { k: v } maps, and lists of maps. Enough for profile.yml.

function parseScalar(s) {
  s = s.trim();
  if (s === '' ) return '';
  if (s === '~' || s === 'null') return null;
  if (s === 'true') return true;
  if (s === 'false') return false;
  if (/^-?\d+(\.\d+)?$/.test(s)) return Number(s);
  if ((s[0] === '"' && s[s.length - 1] === '"') || (s[0] === "'" && s[s.length - 1] === "'")) return s.slice(1, -1);
  if (s[0] === '[' && s[s.length - 1] === ']') {
    const inner = s.slice(1, -1).trim();
    return inner ? splitTop(inner).map(parseScalar) : [];
  }
  if (s[0] === '{' && s[s.length - 1] === '}') {
    const inner = s.slice(1, -1).trim();
    const obj = {};
    if (!inner) return obj;
    for (const part of splitTop(inner)) {
      const idx = part.indexOf(':');
      if (idx < 0) continue;
      obj[part.slice(0, idx).trim()] = parseScalar(part.slice(idx + 1));
    }
    return obj;
  }
  return s;
}

// Split on top-level commas, respecting quotes and brackets.
function splitTop(s) {
  const out = [];
  let depth = 0, cur = '', q = null;
  for (const ch of s) {
    if (q) { cur += ch; if (ch === q) q = null; continue; }
    if (ch === '"' || ch === "'") { q = ch; cur += ch; continue; }
    if (ch === '[' || ch === '{') depth++;
    if (ch === ']' || ch === '}') depth--;
    if (ch === ',' && depth === 0) { out.push(cur); cur = ''; continue; }
    cur += ch;
  }
  if (cur.trim()) out.push(cur);
  return out;
}

function stripComment(line) {
  let q = null, out = '';
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (q) { out += ch; if (ch === q) q = null; continue; }
    if (ch === '"' || ch === "'") { q = ch; out += ch; continue; }
    if (ch === '#' && (i === 0 || /\s/.test(line[i - 1]))) break;
    out += ch;
  }
  return out.replace(/\s+$/, '');
}

function parseYaml(text) {
  const lines = text.split(/\r?\n/).map(stripComment).filter((l) => l.trim() !== '');
  let i = 0;
  function indentOf(l) { return l.match(/^ */)[0].length; }

  function parseBlock(indent) {
    // Decide list or map by first line.
    if (i >= lines.length) return null;
    const first = lines[i];
    if (indentOf(first) < indent) return null;
    if (first.trim().startsWith('- ')) return parseList(indentOf(first));
    return parseMap(indentOf(first));
  }

  function parseMap(indent) {
    const obj = {};
    while (i < lines.length) {
      const line = lines[i];
      const ind = indentOf(line);
      if (ind < indent) break;
      if (ind > indent) { i++; continue; } // stray, skip
      const t = line.trim();
      if (t.startsWith('- ')) break;
      const idx = t.indexOf(':');
      if (idx < 0) { i++; continue; }
      const key = t.slice(0, idx).trim().replace(/^["']|["']$/g, '');
      const rest = t.slice(idx + 1).trim();
      i++;
      if (rest === '') {
        // nested block or empty
        if (i < lines.length && indentOf(lines[i]) > indent) obj[key] = parseBlock(indentOf(lines[i]));
        else if (i < lines.length && indentOf(lines[i]) === indent && lines[i].trim().startsWith('- ')) obj[key] = parseList(indent);
        else obj[key] = null;
      } else {
        obj[key] = parseScalar(rest);
      }
    }
    return obj;
  }

  function parseList(indent) {
    const arr = [];
    while (i < lines.length) {
      const line = lines[i];
      const ind = indentOf(line);
      if (ind < indent) break;
      if (ind > indent) { i++; continue; }
      const t = line.trim();
      if (!t.startsWith('- ')) break;
      const rest = t.slice(2).trim();
      i++;
      if (rest.includes(':') && !rest.startsWith('[') && !rest.startsWith('{') && !/^["']/.test(rest)) {
        // list of maps: treat "- key: v" as first entry of a map at indent+2
        const idx = rest.indexOf(':');
        const key = rest.slice(0, idx).trim();
        const val = rest.slice(idx + 1).trim();
        const item = {};
        item[key] = val === '' ? (i < lines.length && indentOf(lines[i]) > indent ? parseBlock(indentOf(lines[i])) : null) : parseScalar(val);
        // continuation keys at deeper indent
        if (i < lines.length && indentOf(lines[i]) > indent && !lines[i].trim().startsWith('- ')) {
          Object.assign(item, parseMap(indentOf(lines[i])));
        }
        arr.push(item);
      } else {
        arr.push(parseScalar(rest));
      }
    }
    return arr;
  }

  return parseBlock(0) || {};
}

// ---------- misc ----------

function nowIso() { return new Date().toISOString(); }

function git(root, args) {
  const { execFileSync } = require('child_process');
  try {
    return execFileSync('git', args, { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
  } catch (e) {
    return '';
  }
}

module.exports = {
  readStdinJson, emit, preToolDecision, allow, deny, ask, failOpen,
  findRoot, isInsideWorktree, loadProfile, activeChangeId, changeDir, loadState, saveState, loadContext,
  ALL_GATES, TIER_GATES, effectiveTier, requiredGates, gateSatisfied, PHASE_ARTIFACT_GATE,
  normalize, relToRoot, globToRegex, matchesAny, toolFilePath,
  parseYaml, nowIso, git,
};
