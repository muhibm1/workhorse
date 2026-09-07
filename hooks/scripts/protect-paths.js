#!/usr/bin/env node
// PreToolUse (Edit|Write|MultiEdit|NotebookEdit): deny protected_paths, ask on sensitive_paths.
'use strict';
const L = require('./lib');

const input = L.readStdinJson();
const ctx = L.loadContext(input.cwd);
if (!ctx.root || !ctx.profile) return L.emit({}); // not a WorkHorse repo: no opinion
if (ctx.error) return L.failOpen(`protect-paths could not read profile: ${ctx.error}`);

const file = L.toolFilePath(input);
if (!file) return L.emit({});
const rel = L.relToRoot(ctx.root, file);
if (rel === null) return L.emit({});

// approvals.md is written only by the approve script, never by a tool call.
if (/^docs\/sdlc\/[^/]+\/approvals\.md$/.test(rel)) {
  return L.deny('approvals.md is append-only and written by /workhorse:approve. Do not edit it directly.');
}

const hit = L.matchesAny(rel, ctx.profile.protected_paths);
if (hit) return L.deny(`"${rel}" matches protected path "${hit}" in .workhorse/profile.yml. Ask the human to change it or to lift the protection.`);

const soft = L.matchesAny(rel, ctx.profile.sensitive_paths);
if (soft) return L.ask(`"${rel}" matches sensitive path "${soft}" in .workhorse/profile.yml. Confirm this edit is intended.`);

L.emit({});
