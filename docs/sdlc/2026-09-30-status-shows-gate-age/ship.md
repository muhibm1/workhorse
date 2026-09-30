# Ship: status shows gate age

Change id: `2026-09-30-status-shows-gate-age` · Tier 2 · Branch `wh/2026-09-30-status-shows-gate-age` · PR https://github.com/muhibm1/workhorse/pull/23
Prepared 2026-09-30 UTC · Design approved: see [approvals.md](./approvals.md)

Approving merges the PR. No environment deploys automatically in this profile.

## The short version

`workhorse status` now says how long each waiting gate has waited, for example "Design is waiting on YOU for 3h". The age counts from the moment the agents handed you the packet, and the digest carries two new fields so other screens can show it. You are deciding whether to merge it; the release (version bump and install) stays your step.

## What changed

Plain words: one new formatter turns minutes into `12m`, `3h 12m` or `2d 4h`, the digest adds the gate's presented time and its age, and the status line prints it. Nothing else you type or read changes. Diff tour, riskiest first (confirmed from `git diff master...HEAD`):

1. `scripts/wh.js` (+8, ask-first path, tier floor) - digest gains `gate_waiting_since` and `gate_waiting_minutes`; null when no gate waits or the stamp is unreadable; future stamps floor to 0.
2. `hooks/scripts/lib.js` (+15/-1, ask-first path) - new exported `fmtAge`; bad input renders `0m`.
3. `hooks/tests/run.js` (+58, ask-first path) - new checks E1 to E9 and a README grep; no existing check changed.
4. `scripts/workhorse.js` (+3/-1) - requires the shared library and appends " for <age>" to a waiting line.
5. `README.md` (+1/-1) - the status row mentions the age.
6. `docs/sdlc/2026-09-30-status-shows-gate-age/` - brief, spec, plan, evals, two ADRs, reviews, verification. No protected path is touched.

Not committed: `desk/studbook-verify.tmp.png`, an unrelated stray file (confirmed untracked).

## Proof

| Check | Command | Exit code | Output | Status |
|-------|---------|-----------|--------|--------|
| install | none defined | n/a | n/a | no check defined |
| typecheck | none defined | n/a | n/a | no check defined |
| lint | `claude plugin validate .` | 0 | [lint.log](./verify-logs/lint.log) | confirmed |
| test | `npm test` (323 passed, 0 failed, 0 skipped) | 0 | [test.log](./verify-logs/test.log) | confirmed |
| build, e2e, security_audit, screenshot | none defined | n/a | n/a | no check defined |

Evals: golden 4/4, edge 6/6, failure 1/1, adversarial 0/0 (no cases, none apply), all targets met (confirmed, [verification.md](./verification.md)).
Known pre-existing failures (`wh.js known-failure list`): two Paddock e2e rows from another change; this change touches nothing under desk/ and e2e is not defined in the profile.

## What the reviewers found

Six reports in [reviews/](./reviews/). Critical 0, high 0, medium 0, low 4, accepted 0.

| Severity | Reviewer | File:line | Finding | Resolution |
|----------|----------|-----------|---------|------------|
| low | silent-failure-hunter | scripts/wh.js buildDigest | An unreadable presented stamp drops the gate, so status shows "agents working" and no waiting gate | left as is; matches the existing rule and eval E9; no follow-up filed |
| low | silent-failure-hunter | hooks/scripts/lib.js:540 | Negative or non-numeric input renders `0m` with no signal | left as is; deliberate and tested (E8) |
| low | adoption | scripts/wh.js:877 | Comment cites "ADR 0001" by number, not path | left as is; a later edit could name the full path |
| low | adoption | scripts/wh.js:910 | New digest fields not listed in any doc or in desk types | left as is; no doc lists digest fields (believed, not verified) |

Spec conformance: 8 of 8 requirements traced to code and test (R8 by diff reading). Adoption score: 4.
Not verified: the security reviewer's AgentShield scan of `hooks/` (ecc-agentshield 1.6.0) was refused by the auto-mode classifier and did not run; a human can allow it or run it. The rest of the security report is from reading the diff (confirmed).

## Decisions

| # | Decision | Recommendation | Alternative | Why the recommendation |
|---|----------|----------------|-------------|------------------------|
| D8 | Rollback rehearsal | Not rehearsed; revert the merge commit if needed | Rehearse in dev | dev has no deploy command and prod is never a rehearsal target; the change is display-only |
| D1 | Age counts from | Presented stamp | Log row or clock total | Same stamp decides "waiting" (ADR 0001) |
| D2 | Age format | `12m`, `3h 12m`, `2d 4h` | Clock form | Reads at a glance (ADR 0002) |
| D3 | Where shown | `workhorse status` and the digest | Also agents' `wh.js status` | The request is about your command |
| D4 | Too-long warning | None now | Flag over 24h | No evidence for a threshold |
| D5 | Version bump | Not here | Bump to 0.4.1 | Release is a human step |
| D6 | Edit `scripts/wh.js`, `hooks/scripts/lib.js` | Approved with G2 | Formatter in workhorse.js | Repo pattern: one shared formatter |
| D7 | Edit `hooks/tests/run.js` | Approved with G2 | Separate test file | Only new blocks added |

D1 to D7 are carried from the [brief](./brief.md); no others were taken during the build. Approving accepts every recommendation.

## Deploy and undo

| Environment | Command | Automatic on approval | Rollback |
|-------------|---------|-----------------------|----------|
| dev | none (the checkout and master on GitHub) | yes, nothing to run | `git revert <squash commit>` on master |
| staging | none | no | not applicable |
| prod | the profile's plugin install command | no, your step | revert on master, then run the same install command again |

Rollback rehearsed (tier 2): not rehearsed: dev has no deploy command and production is never the rehearsal target (see D8).
Config and secrets touched (names only): none.

## Clock

Clock: agents 22 m of 1 h 30 m budget · waiting on you 2 h 02 m · dead 0 m · wall 2 h 24 m

## Your decision

Approve to merge and deploy, or reject with notes to send it back.

```
/workhorse:approve G4
/workhorse:approve G4 --reject "notes"
```
