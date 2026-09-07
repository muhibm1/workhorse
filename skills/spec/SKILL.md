---
name: spec
description: Spec phase only for the active WorkHorse change. Runs the spec architect, constraint auditor, and eval designer, then presents G2.
disable-model-invocation: true
allowed-tools: Agent, Read, Bash(node *), Bash(git *)
---

# /workhorse:spec

1. Confirm an active change exists and G1 is `approved` or `auto`
   (`node "${CLAUDE_PLUGIN_ROOT}/scripts/wh.js" status --json`). If not, say what is missing.
2. `wh.js phase spec`.
3. Dispatch `wh-spec-architect`. When it returns, dispatch `wh-constraint-auditor` and
   `wh-eval-designer` in parallel (one message, two Agent calls).
4. If the auditor reports any `high` finding, dispatch `wh-spec-architect` again with the
   findings. Repeat at most twice. If highs remain, present them to the user as a decision.
5. Print the G2 packet from the end of `spec.md` and the audit result line. G2 is always a
   human gate at tier 1 and above; at tier 0 run `wh.js gate G2 auto` and say so.
