---
name: wh-review-packet
description: How to write a WorkHorse gate packet, the single document a human reads to approve or reject a gate. Loaded by the packet compiler and by any agent presenting a gate (intent writer at G1, spec architect at G2, planner at G3, release engineer at G5).
user-invocable: false
---

# The gate packet

The human judges a packet, not raw output. Every gate uses the same six sections so the reader
learns one shape. The packet is a decision aid: it exists to let one person make a correct
call in under ten minutes.

## Sections, in order

1. **TL;DR.** Three sentences. What was done. Why. What the reader is being asked to decide.
   If they read nothing else, this must be enough to say yes or no.
2. **Decisions requested.** A table. Each row: the decision, the agents' recommendation, the
   alternative, and what changes downstream if the human picks the alternative. Never more than
   five rows; if there are more, the phase is not finished.
3. **Evidence.** A table of every check: command, exit code, output path, and status
   `confirmed` or `believed, not verified`. Include checks that were not run with the reason.
   Eval pass rates by category against targets.
4. **Findings** (G4) or **Constraint audit** (G2). Merged from the reviewers, sorted by
   severity. Each has a resolution: fixed (commit), accepted (by whom, why), or open. Anything
   open above medium blocks the recommendation.
5. **Risk register.** Likelihood, impact, mitigation, owner.
6. **Diff tour** (G4) or **Design tour** (G2). Ordered by risk, not by filename. Protected and
   sensitive paths first, then data and auth, then business logic, then tests, then docs. Each
   entry says what changed and why it sits at that position.
7. **Checklist.** Items the human ticks. At tier 2 and above the security baseline pre-ship
   checklist is embedded verbatim.

Finish with the exact approve and reject commands, in this form and no other (there is no
separate reject command; rejection is a flag on approve):

```
/workhorse:approve <G> 
/workhorse:approve <G> --reject "notes"
```

## Rules

- Write for a reader who did not watch the work. No references to "the earlier conversation".
- Numbers in tables, not prose.
- Link every artifact by relative path.
- Do not soften findings. A finding that was fixed says "fixed in <commit>"; one that was not
  says "open".
- The recommendation line is one of: `Recommend approve`, `Recommend approve with conditions:
  ...`, `Recommend reject: ...`. Never leave it out.
- Length: aim for one screen per section. A packet over 400 lines means the change should have
  been split; say so in the TL;DR.

## Rejection handling

When a gate is rejected, the notes in `approvals.md` become the first input to the re-entered
phase. The next packet for the same gate starts with a section "Response to rejection" that
quotes each note and says what changed.
