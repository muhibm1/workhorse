# Status shows gate age

Change id: `2026-09-30-status-shows-gate-age` · Prepared 2026-09-30T05:12Z UTC
Risk tier: 2 (edits scripts/wh.js and hooks/scripts/lib.js, both in profile.tier_floor_paths[2]; the change itself is a tier 1 behaviour change with no data or auth surface)
For the agents: [spec.md](./spec.md), [plan.md](./plan.md), [evals.md](./evals.md), [adr/](./adr/)

This is the Design document. A person reads it in under five minutes, technical or not. Plain
sentences; name things by what they do; no code.

## The short version

You asked for `workhorse status` to say how long each gate has been waiting on you. It will:
the line that today reads "Design is waiting on YOU" will read "Design is waiting on YOU for 3h",
with a test that proves the number. The one thing worth knowing: the age is counted from the
moment the agents handed you the packet, the same stamp that already decides whether a gate is
waiting at all, so the two can never disagree.

## Problem

In your words: "workhorse status doesn't say how long a gate has been waiting." Precisely: the
status command knows which gate waits on you, and the run's clock knows the total time spent
waiting across the whole change, but nothing reports the age of the gate that is waiting right
now. After a weekend, or with three repositories running, you cannot tell which decision has
been sitting longest.

## Outcome

When this is done, every change listed by `workhorse status` that waits on you shows the gate
and its age: `Design is waiting on YOU for 12m`, `for 3h 12m`, `for 2d 4h`. A change the agents
are still working on shows the same line it shows today. The age comes from the machine-readable
digest the command already reads, so the phone watcher and any later screen can show it too.

## What changes for people

- You: one more phrase on each waiting line of `workhorse status`. Nothing else you type or
  read changes. The README row for `workhorse status` mentions the age.
- Agents: nothing. Their own status command and the clock line are unchanged.
- Engineers reading the code: one new formatting function in the shared library, two new fields
  in the digest, one new phrase in the status printer, nine new checks in the test runner.

## What could go wrong, and the guard for each

| Risk | Guard |
|------|-------|
| The age is wrong after you reject a gate and the agents present it again | It counts from the latest presentation; a test rejects, re-presents and checks the age restarts (E7) |
| A corrupted or missing timestamp crashes the status command | The gate is then simply not shown as waiting, as today, and both commands exit cleanly; tested (E9) |
| Two machines share a repository with clocks that disagree, and the age goes negative | Floored to zero minutes; tested (E8) |
| The build stalls because three of the files are "ask first" in your profile | Listed below as D6 and D7; approving this Design is your go-ahead, and the conductor runs the build attended if the hook still asks |
| The number is right but the wording is odd (`72h`, `1h 0m`) | The format is fixed by rule and tested at every boundary (E3 to E5) |

## Decisions

Every question the design raised, each with the recommended answer already chosen. Approving
this document accepts every recommendation; say otherwise in the approval notes to change one.

| # | Decision | Recommendation | Alternative | Why the recommendation |
|---|----------|----------------|-------------|------------------------|
| D1 | Where the age is counted from | The stamp written when the packet was presented to you | The matching row in the conductor log, or the run clock's total waiting time | The stamp already decides whether a gate is waiting; the log is a second copy of it, and the clock total is wrong after the first approval (ADR 0001) |
| D2 | How the age reads | `12m`, `3h 12m`, `2d 4h`; zero parts dropped, minutes dropped past a day | The existing clock form, `3 h 12 m` | The existing form prints `72 h 00 m` for a weekend; an age is one number you glance at (ADR 0002) |
| D3 | Which commands show it | `workhorse status` and the digest it reads | Also the agents' internal `wh.js status` | The request is about your command; the agents do not act on the age; can be added later from the same field |
| D4 | Whether status warns when a gate has waited too long | No threshold now, just the age | Flag a gate waiting over 24 hours | No evidence yet of what "too long" is; the age gives you the data to pick a threshold later |
| D5 | Version bump and changelog entry in this change | No; the release step is yours and bumps both | Bump to 0.4.1 and add the entry here | The profile records releases as a human step, and the version files are sensitive paths |
| D6 | Editing two ask-first paths, `scripts/wh.js` and `hooks/scripts/lib.js` | Approve the edits with this Design; the builder touches only the digest function and adds one formatter | Keep the formatter in `scripts/workhorse.js` to avoid `lib.js` (the `wh.js` edit is unavoidable) | One shared formatter is the repository's pattern and lets any command print the same age; both files are named in each task's heading |
| D7 | Edit a third ask-first path, `hooks/tests/run.js` (matches `hooks/**`), which both tasks change | Approve together with this Design, as for D6: builder only adds new test blocks, changes no existing check | Put the new checks in a separate test file outside `hooks/**`, loaded by `npm test` | profile `sensitive_paths` `hooks/**` |

## How it will be proved

- Profile checks: `npm test` (the plugin's single test runner) and `claude plugin validate .`.
  The other profile commands are empty and are skipped as such.
- Evals, as written in `evals.md`: 9 cases, all machine-run inside `npm test`: 3 golden
  (the digest fields, the status line, the `3h` rendering), 5 edge (format boundaries at
  minutes, hours and days; nothing waiting; reject and re-present; a stamp in the future),
  1 failure (a corrupted stamp). No adversarial case: the stamp is written by the tool itself,
  never read from a pull request, repository content or user input.
- Two requirements are checked outside the eval cases: the README row by a grep, and "no extra
  process spawned per status tick" by the reviewer reading the diff.
- Done looks like: the test run lists the nine checks as `ok`, and one line from the test
  fixture reads `Design is waiting on YOU for 3h`.

## Estimate

Waves: 2. Tasks: 2. Agent-time budget at tier 2: 90 minutes (the change is small; expect well under).

## Your decision

Approve to build it exactly this way, or reject with notes to have it redesigned.
