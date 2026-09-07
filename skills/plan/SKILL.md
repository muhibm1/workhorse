---
name: plan
description: Plan phase only for the active WorkHorse change. Runs the implementation planner to produce plan.md with file-disjoint parallel waves, then presents G3 if required.
disable-model-invocation: true
allowed-tools: Agent, Read, Bash(node *), Bash(git *)
---

# /workhorse:plan

1. Confirm G2 is `approved` or `auto`. If not, say so and stop.
2. `wh.js phase plan`.
3. Dispatch `wh-implementation-planner`.
4. Print the wave table and the G3 packet from `plan.md`. If G3 is in `wh.js required`, stop
   for approval. Otherwise `wh.js gate G3 auto` and say the next step is `/workhorse:build`
   or `/workhorse:run`.
