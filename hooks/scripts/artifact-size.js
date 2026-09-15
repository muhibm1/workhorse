#!/usr/bin/env node
// PostToolUse (Edit|Write|MultiEdit): hold a change's intent, spec, and plan to a size a human
// can read at a gate. Prompt guidance alone did not hold: two live runs wrote a 268- and a
// 270-line intent.md against a 150-line rule, and a 535-line spec for one endpoint. This hook
// measures after every write; when a file is over its limit it returns decision "block", which
// feeds the reason back to the writing agent. The write itself stands; the agent is told to cut.
'use strict';
const fs = require('fs');
const path = require('path');
const L = require('./lib');

// Limits in lines, with slack over what the agent prompts ask for. null means no limit.
const LIMITS = {
  'intent.md': () => 190,
  'spec.md': (tier) => (tier <= 1 ? 250 : tier === 2 ? 500 : null),
  'plan.md': () => 500,
};

const input = L.readStdinJson();
const ctx = L.loadContext(input.cwd);
if (!ctx.root) return L.emit({});
const file = L.toolFilePath(input);
if (!file) return L.emit({});
const rel = L.relToRoot(ctx.root, file);
if (rel === null) return L.emit({});
const m = /^docs\/sdlc\/[^/]+\/(intent|spec|plan)\.md$/.exec(rel);
if (!m) return L.emit({});

const name = `${m[1]}.md`;
const tier = L.effectiveTier(ctx.state);
const limit = LIMITS[name](tier);
if (limit === null) return L.emit({});

let lines;
try {
  lines = fs.readFileSync(path.join(ctx.root, rel), 'utf8').trimEnd().split('\n').length;
} catch (e) {
  return L.emit({});
}
if (lines <= limit) return L.emit({});

const scope = name === 'spec.md' ? ` at tier ${tier}` : '';
L.emit({
  decision: 'block',
  reason:
    `[workhorse] ${rel} is ${lines} lines; the limit for ${name}${scope} is ${limit}. A human reads it at a gate. ` +
    'Cut it and write the file again: a section that does not apply becomes one "Not applicable: reason" line, ' +
    'cite the intent, profile, and codebase map instead of restating them, and move detail only a builder needs into an ADR.',
});
