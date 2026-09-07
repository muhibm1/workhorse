---
name: review
description: Review phase only for the active WorkHorse change. Runs the bug, conformance, security, and adoption reviewers in parallel, compiles review-packet.md, pushes the branch, opens the PR, and presents G4.
disable-model-invocation: true
allowed-tools: Agent, Read, Bash(node *), Bash(git *), Bash(gh *)
---

# /workhorse:review

1. Confirm `verification.status` is `green`. If not, say so and stop; the gate-guard hook
   will refuse the push anyway.
2. Dispatch `wh-conductor` with the prompt:

   > Run only the Review phase for the active change, following the review row of your phase
   > table: the four reviewers in parallel, then the packet compiler, then push the branch and
   > open a PR with the packet TL;DR as the description. Present G4 and stop.

3. Print the packet's TL;DR, decisions, recommendation, and PR link, then the approve and
   reject commands.
