---
name: build
description: Build phase only for the active WorkHorse change. Runs plan.md tasks as parallel waves of up to profile.build.max_parallel builders in isolated worktrees, with readability and simplification passes per wave.
disable-model-invocation: true
allowed-tools: Agent, Read, Bash(node *), Bash(git *)
---

# /workhorse:build

1. Confirm G3 is `approved` or `auto` and `plan.md` exists. If not, say so and stop.
2. Dispatch `wh-conductor` with the prompt:

   > Run only the Build phase for the active change, following the Build section of your
   > instructions: waves from plan.md, up to build.max_parallel builders per wave in isolated
   > worktrees, fold each wave, then readability and simplifier passes. Stop after the last
   > wave is folded; do not start Verify.

3. Print the conductor's report and `wh.js status`. Next step: `/workhorse:verify`.
