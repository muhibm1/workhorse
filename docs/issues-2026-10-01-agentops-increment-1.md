# What broke running WorkHorse on AgentOps increment 1

Recorded 2026-10-01 from the first change on a greenfield repository (`muhibm1/agentops`,
change `2026-10-01-increment-1-scaffold`, tier 2), run from a the harness desktop session that
had loaded plugin 0.3.13 while 0.4.0 was installed. Every item below was observed in that session;
nothing is inferred from documentation. The fix column is a proposal, not a decision.

## The headline

The design promises two human touches per change. Increment 1 took seven:

| # | Touch | Designed? |
|---|---|---|
| 1 | Push `main` to the new remote by hand (agents cannot push `main`) | No |
| 2 | Approve G2 through 17 decision questions | Yes |
| 3 | Run `/workhorse:run` to continue after G2 | No (the CLI path resumes itself; the skill path does not) |
| 4 | Approve G4 | Yes |
| 5 | Run `/workhorse:run`, which blocked on the merge | No |
| 6 | Mark the PR ready by hand, then merge it by hand | No |
| 7 | Run `/workhorse:run` again to close, then merge a second docs-only PR for the records | No |

Agent time was 65 of 90 minutes, inside budget for the first time at tier 2. The pipeline's own
work was fine. The seams between the pipeline and the human are what failed.

## Issues

Severity: **high** breaks or stalls a run; **medium** costs the owner a manual step or hides a
fact; **low** is noise or wording.

### 1. The session ran plugin 0.3.13 while 0.4.0 was installed (high)

the harness loads plugins at session start. The session began 2026-09-29; `claude plugin update`
installed 0.4.0 on 2026-09-30 04:29 UTC. Every `/workhorse:*` skill in the session resolved to
`plugins/cache/workhorse/workhorse/0.3.13/`, while the `workhorse` CLI used 0.4.0. Nothing warned.
Consequences: the PR stayed a draft at Ship (the ready-at-Ship step exists only in 0.4.0), and the
skill-path approvals and resumes used old code.

Fix: `wh.js` compares its own version with `installed_plugins.json` on every command and prints a
one-line warning when they differ, and `session-context` prints the loaded version at start.

### 2. The `workhorse` npm shim fails under Git Bash on Windows (high)

```
Error: Cannot find module '~\anaconda3\Library\c~\AppData\Roaming\npm\node_modules\workhorse-plugin\scripts\workhorse.js'
```

The shim's `/c/Users/...` path is rewritten by MSYS and prefixed with the Anaconda library root.
`workhorse doctor` reports "ok" because it is run from PowerShell. Workaround used all session:
`node ~/AppData/Roaming/npm/node_modules/workhorse-plugin/scripts/workhorse.js`.

Fix: the `bin` entry should resolve through `require.resolve` relative to the package, not an
absolute path; `doctor` should run the shim from `bash -lc` on Windows when bash is present.

### 3. The shipper's merge is denied by the permission classifier on every repository (high)

Observed on Portfolio PR #19 (2026-09-28) and AgentOps PR #1 (2026-10-01): the deploy-mode
shipper dispatch is refused as a "production deploy" and the run blocks. The profile had no deploy
command for any environment, so there was nothing to deploy; the merge itself was the blocked step.
The retro proposed the right first fix (skip deploy mode when no environment has a deploy
command). The larger fix: treat "the owner merges" as the designed path, not a block. After G4 the
conductor marks the PR ready, posts one comment naming the merge as the owner's step, writes the
deploy record, and moves to done when the merge is observed (`gh pr view --json mergedAt`), with
no `/workhorse:run` needed.

### 4. Gate and retro records land after the merge and need a second PR (medium)

The G4 packet, the approval, the close and the retro were committed on the change branch after
the PR merged, so `main` lacked them and a docs-only PR #2 was needed (the same pattern as
Portfolio PR #20). A fifth line (`done; retro dispatched`) was written to `conductor-log.md`
after the close commit and sat uncommitted.

Fix: commit and push the records before asking for the merge (approve → commit → push →
"please merge"), run the retro before the merge is requested or commit it to a records branch
that auto-opens its PR, and write the done line before `phase done` commits.

### 5. No agent watches CI on the pull request before Ship (medium)

Requirement R20 (a green Actions run) was never verified by an agent; the Ship document said so
and left it to the owner. The owner watched run 36814695863 (76 passed) by hand before approving.

Fix: the shipper runs `gh pr checks --watch` after pushing, records the run id and result in
`ship.md`'s proof table, and does not present G4 until the checks have finished.

### 6. Seventeen decision rows at G2, five rounds of questions to approve (medium)

The brief carried 17 decisions, including where a fake-model file lives and which four packages to
pin. The approve skill asks one question per decision, four at a time. The owner accepted every
recommendation. "Every question becomes a decision row" has turned builder notes into owner
decisions.

Fix: the designer keeps a decision row only for choices with a cost the owner would feel (money,
scope, a sensitive path, a deviation from the approved design) and puts the rest under "Builder
notes" in `plan.md`. The approve skill offers "accept all recommendations" first and asks
per-decision only on request.

### 7. `format-on-write` runs `ruff format` on YAML and Markdown and fails before `.venv` exists (low)

Every write to `profile.yml`, `constraints.md` and the specs produced a failed hook. It blocked
nothing but it is noise on every edit of a greenfield repository.

Fix: the hook filters by the formatter's file types and skips silently when the command is absent.

### 8. `deny_commands` matches substrings of the whole command, including file content (medium)

The discovery analyst put a SQL table-drop phrase in `deny_commands` and the hook then refused the
analyst's own `sed` edit of `profile.yml`, because the entry matched the heredoc text. Scenario 8's
fixture contains the same phrase on purpose, so it can never be a deny entry.

Fix: match deny entries against the command's first token and arguments, not against heredoc or
quoted file content; document the matching rule in the template.

### 9. `wh.js init` writes a `.gitignore` without the security baseline (medium)

The generated file ignored only `.worktrees/`, `.workhorse/active` and `.workhorse/state/`. The
analyst flagged the missing `.env*`, `!.env.example`, virtualenv, database and audit-log entries
as debt and did not fix them, because they were outside its four outputs. The main session added
them by hand.

Fix: the template `.gitignore` carries `.env*` and `!.env.example` always, and the analyst appends
stack-specific entries as part of onboarding.

### 10. Approvals record the stale global git email (low)

`approvals.md` shows `who: 90530587+muhibm1@users.noreply.github.com` from `git config user.email`, an old
employer address, on a public portfolio repository.

Fix: record the GitHub login from `gh api user` when `gh` is signed in, as the 0.4.0 GitHub path
already does, and fall back to the git email.

### 11. The polish pass covered two files of a seven-task diff (medium)

The conductor reported that polish "read only state.py and cli.py, so it did not cover the rest of
the diff" and changed nothing.

Fix: polish receives the full file list from the fold and must report which files it read.

### 12. The security reviewer's AgentShield scan is refused by the harness and never runs (medium)

The `npx` scan was denied and the Ship document records it as not run. The same happened on the
WorkHorse gate-age change. A mandatory tier 2 check that never executes is a green check that
proves nothing.

Fix: pre-flight the scan command in `doctor` and in `verify`; if it cannot run in this harness,
replace it with a vendored check or drop it from the mandatory list with a recorded reason.

### 13. Conformance presented Ship with 3 of 23 requirements untraced (low)

"Traced 20 of 23" was accepted without the three being named as accepted gaps.

Fix: `artifact-check` refuses a Ship document whose conformance review has untraced requirements
without a resolution row each.

### 14. Style rules are not enforced on artifacts (low)

A separate commit "remove em-dashes from ship packet" was needed after the shipper wrote em dashes,
which the owner's voice rule bans. The CI runner was set to `ubuntu-latest` though every other
owner repository pins `ubuntu-24.04`.

Fix: `artifact-check` carries a banned-characters list from the profile's `style_notes`; the
builder's CI template pins the runner.

### 15. `doctor` wording when run in a folder that is not yet onboarded (low)

In the empty AgentOps folder it printed "FIX this folder is a WorkHorse repository -> cd into a
repository, or run /workhorse:onboard". The first clause says the opposite of what it means.

### 16. Clock understates the wait after Ship is presented (low)

`ship.md` pasted the clock at presentation time (waiting 12 m); the status after the block showed
50 m. The retro noticed. Fix: the done phase rewrites the clock line from the final `WH clock`.

### 17. The first push of a new repository has no agent path (low, by design)

`bash-guard` refuses `gh repo create --source . --remote origin` because it contains a push to
`main`. Correct for safety; the onboarding skill should say so and hand the owner the two commands
instead of letting the run discover it.

## Order to fix

1. Issues 3 and 4 together: they are one design change (the owner merges; records precede the
   merge). They remove touches 3, 5, 6 and 7 from the table above.
2. Issue 1 (version drift warning) and 2 (the shim), because every other fix is invisible if the
   session runs old code or the CLI does not start.
3. Issue 5 (watch CI) and 6 (decision bloat), which decide what the owner reads at G4 and how long
   G2 takes.
4. The rest in a single hygiene change: 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17.

Each fix is a WorkHorse change with its own evals; the eval for 3 and 4 is a dry run on
`examples/hello-service` that counts owner touches and asserts two.

## Added during increment 2

### 18. `verify-before-stop` fires on the main session while a background conductor builds (medium)

With increment 2 in its build phase, the main session's Stop hook demanded that it run the
profile's checks and write `verification.md`. The main session was not building; the conductor was,
in the background. Obeying would have raced the builders and could have recorded a result for code
still changing. Fix: the hook applies only to builder, fixer and verifier agents (it already keys
on SubagentStop for those) and skips the main session when the run lock is held by another session.

### 19. Worktrees have no virtualenv, so the format hook fails in every builder worktree (low)

Builders ran Python from the main checkout's `.venv`; the PostToolUse formatter reported "failed"
on every write in a worktree. Fix: resolve tool paths against the main checkout, or create the
worktree with a link to the main venv.

### 20. `WH fold` takes one task per call (low)

The conductor folded wave 2 one task at a time. Fix: accept a task list, as the usage text
`fold --tasks 1,2` already advertises.

### 21. Conductor and shipper disagree on finding counts (low)

The conductor's log said 8 mediums; the shipper counted 13 from the reports and `ship.md` follows
the reports. Fix: one count, computed by `wh.js` from the review files, used by both.

## Added during increment 3

### 22. The conductor dies on a usage limit with no resume marker (medium)

The build conductor was killed by an API session limit at 09:07 UTC, after the fixer and a green
verify. Nothing in state said where it stopped; the main session reconstructed it from
`conductor-log.md` and git. Fix: the conductor writes a `resume_at` field to state after every
step, and `workhorse resume` prints it.

### 23. Evals are green while two high defects exist (high)

Verify passed 64 of 64 evals at f2dfd3a with two highs present (crash after apply recorded as not
applied; a failed metrics read declared "cleared"). The eval design covered the happy path and
declared failures, never "crash between effect and record" or "read fails during verification".
Fix: `wh-evals` requires those two failure cases for every side-effecting call.

### 24. Evals are not rerun after review fixes (medium)

Ship cited 64 of 64 at f2dfd3a while the shipped head was 8465aa2, twelve fix commits later, and
`verification.md` still said "partial (evals not yet run)". Fix: `wh.js verify --final` reruns the
eval-backed tests at the head being presented, and the Ship document refuses a stale head.

### 25. The record-after-merge gap persisted on every change (medium)

Increment 3 needed records PR #6 for the G5 packet, approval, close and retro, the third such PR in
three changes. Pushing the G4 approval to the branch before the merge (done by hand this time)
kept G4 in the code PR; G5 and the retro still trail. This is issue 4, confirmed again.

### 26. Tier 3 budget is unrealistic for a 24-requirement change (low)

211.8 agent minutes against 180. The retro attributes 109 to review and fixing, driven by a fix
round that introduced a regression. Fix: the designer warns at G2 when a tier 3 change has more
than 20 requirements or more than 60 eval cases, and suggests a split.

## Added during increment 4 (no-spend half)

### 27. A killed headless run leaves a live-looking lock, and taking it over needs the owner (medium)

`workhorse "<problem> -> <outcome>"` was started from a background shell, which the harness stops
at its time limit. The headless Claude process died with it 30 minutes in, after the designer,
constraint auditor and eval designer had finished but before G2 was presented. The run lock still
names the dead session, `lock acquire` refuses, and `--force` is refused by the auto-mode
classifier as a safety bypass, so only the owner can clear it. Fix: the lock records the holder's
PID and `lock acquire` treats a lock whose PID is gone as stale without `--force`; the CLI start
command detaches the headless run from the calling shell so a shell time limit cannot kill it.
