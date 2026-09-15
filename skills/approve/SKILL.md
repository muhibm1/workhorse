---
name: approve
description: Record your decision at a WorkHorse gate. Approve advances the pipeline; reject re-enters the phase with your notes. Asks you about each decision the packet requested, writes approvals.md and commits it. Only you run this.
disable-model-invocation: true
allowed-tools: Bash(node *), Read, Agent, AskUserQuestion
---

# /workhorse:approve

Arguments: `$ARGUMENTS` = `<G1|G2|G3|G4|G5> [--reject | --accept-all] [notes...]`.

This is the human act in the loop. The command records who (from `git config user.email`),
when, the tier, and your notes. It first commits the change's artifacts so the approval pins
exactly what you read, records that commit and the packet's sha256, appends to `approvals.md`
and commits it, then updates the change's control state in `.git/workhorse` (never committed).

An approval must answer every decision the packet requested. `wh.js approve` refuses one that
does not name each decision id in its notes. (Two live G4 approvals in a row answered only
some of the packet's decisions; the retro flagged it both times.)

1. If the arguments contain `--reject` or `--accept-all`, skip to step 3.
2. Run `node "${CLAUDE_PLUGIN_ROOT}/scripts/wh.js" digest --json` and read `decision_items`.
   For each item, ask the user with AskUserQuestion: the question is `<id>: <decision>`, the
   options are "Recommendation: <recommendation>" (first), "Alternative: <alternative>" (when
   one is given), and "Other". Take any note the user adds. Then build the notes as one clause
   per decision, `D1: recommendation accepted, <note>; D2: alternative chosen, <note>`,
   followed by the free notes from the arguments. If `decision_items` is empty, use the
   arguments' notes as they are.
3. Run exactly: `node "${CLAUDE_PLUGIN_ROOT}/scripts/wh.js" approve <gate> [--reject | --accept-all] "<notes>"`
4. Print its output. If it refused because a decision is unanswered, show the list it printed
   and go back to step 2 for those decisions.
5. If approved: say what phase comes next and offer `/workhorse:run` to continue. Do not
   continue automatically; the user may want to read something first.
6. If rejected: dispatch `wh-conductor` with the prompt "Gate <G> was rejected; re-enter its
   phase using the rejection notes in approvals.md as input and present the gate again", and
   print its report.

Never run this on the user's behalf from inside another skill or agent. If you are a subagent,
the bash-guard hook will refuse it. Never answer a decision yourself: every answer comes from
the user through the question, or from their explicit `--accept-all`.
