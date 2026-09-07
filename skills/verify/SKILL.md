---
name: verify
description: Verify phase only for the active WorkHorse change. Runs every profile check and the evals, loops the fixer with tests locked until green (max 5), and records verification.md.
disable-model-invocation: true
allowed-tools: Agent, Read, Bash(node *), Bash(git *)
---

# /workhorse:verify

1. Dispatch `wh-conductor` with the prompt:

   > Run only the Verify phase for the active change, following the Verify section of your
   > instructions. Stop when verification is green or after five fix loops with a blocked
   > report.

2. Print the conductor's report, the checks table from `verification.md`, and `wh.js status`.
   Next step: `/workhorse:review`.
