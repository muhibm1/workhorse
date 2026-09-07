---
name: approve
description: Record your decision at a WorkHorse gate. Approve advances the pipeline; reject re-enters the phase with your notes. Writes approvals.md and commits it. Only you run this.
disable-model-invocation: true
allowed-tools: Bash(node *), Read, Agent
---

# /workhorse:approve

Arguments: `$ARGUMENTS` = `<G1|G2|G3|G4|G5> [--reject] [notes...]`.

This is the human act in the loop. The command records who (from `git config user.email`),
when, the artifact commit, the tier, and your notes, appends to `approvals.md`, updates
`state.json`, and commits both.

1. Run exactly: `node "${CLAUDE_PLUGIN_ROOT}/scripts/wh.js" approve $ARGUMENTS`
2. Print its output.
3. If approved: say what phase comes next and offer `/workhorse:run` to continue. Do not
   continue automatically; the user may want to read something first.
4. If rejected: dispatch `wh-conductor` with the prompt "Gate <G> was rejected; re-enter its
   phase using the rejection notes in approvals.md as input and present the gate again", and
   print its report.

Never run this on the user's behalf from inside another skill or agent. If you are a subagent,
the bash-guard hook will refuse it.
