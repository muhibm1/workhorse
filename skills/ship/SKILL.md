---
name: ship
description: Deploy phase for the active WorkHorse change after G4. Writes release.md with a rehearsed rollback, deploys auto environments, and presents G5 for production.
disable-model-invocation: true
allowed-tools: Agent, Read, Bash(node *), Bash(git *), Bash(gh *)
---

# /workhorse:ship

1. Confirm G4 is `approved`. If not, say so and stop.
2. If the PR is not merged, merge it with `gh pr merge --squash` (or the client's merge style
   from the profile notes) and record the merged commit with
   `wh.js state set merged_commit <sha>`.
3. `wh.js phase deploy`. Dispatch `wh-release-engineer`.
4. Print the deploy record so far and the G5 packet. If G5 is already approved (re-run after
   approval), the release engineer completes production and you print the final record, then
   dispatch `wh-retro-learner`, run `wh.js phase done` and `wh.js active --clear`.
