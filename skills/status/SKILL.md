---
name: status
description: Show the active WorkHorse change, its tier, phase, gate statuses, verification state, what is blocking, and optionally the engagement metrics.
disable-model-invocation: true
allowed-tools: Bash(node *), Read
---

# /workhorse:status

Arguments: `$ARGUMENTS` may be `--metrics` for the leading and lagging indicators across all
changes in this repo, or `--json`.

1. Run `node "${CLAUDE_PLUGIN_ROOT}/scripts/wh.js" status $ARGUMENTS` and print the output.
2. If a gate is blocking, print the packet path and the approve and reject commands.
3. If there is no active change, list the changes under `docs/sdlc/` with their phase from
   each `state.json`, newest first, and say how to resume one
   (`wh.js active <id>` then `/workhorse:run`).
