# Verification: status shows gate age

Change id: `2026-09-30-status-shows-gate-age`
Status: green
Run at: 2026-09-30T07:26:06.525Z UTC
Commit: `ed05ceb65d82`

Status is green only when every defined check exited 0 and every eval category met its target.
"No check defined" rows do not count as passes; they are listed so the gap is visible.

## What was measured

<!-- wh:verify-start -->
<!-- written by `wh.js verify`; edit outside the markers -->
- Lint: 0 errors (`claude plugin validate .`).
- Test suite: 323 passed, 0 failed, 0 skipped (`npm test`).
<!-- wh:verify-end -->

Evals: `npm test` re-run to `verify-logs/evals.log`, exit 0, 323 passed; each of E1-E11 appears as an ok line. R7: README.md line 72 holds `workhorse status` and `how long`. R8: `git diff master...HEAD -- scripts/workhorse.js` adds no spawnSync or whJson lines (3 insertions, 1 deletion).

Up from 312 tests on master (previous change `2026-09-29-studbook-tools-for-designer-and-discovery-analys` recorded 278 with desk tests, not comparable). No previous change to compare by name beyond that.

## Known failures

None.

## Notes for the Ship document

None.


## Checks

| Check | Command | Exit code | Output | Status |
|-------|---------|-----------|--------|--------|
| install |  | | | no check defined |
| typecheck |  | | | no check defined |
| lint | `claude plugin validate .` | 0 | `verify-logs/lint.log` | confirmed |
| test | `npm test` | 0 | `verify-logs/test.log` | confirmed |
| build |  | | | no check defined |
| e2e |  | | | no check defined |
| security_audit |  | | | no check defined |
| screenshot |  | | | no check defined |

## Evals

| Category | Cases | Passed | Target | Met |
|----------|-------|--------|--------|-----|
| golden | 4 (E1, E2, E3, E10) | 4/4 | 100% | met |
| edge | 6 (E4-E8, E11) | 6/6 | 100% | met |
| failure | 1 (E9) | 1/1 | 100% | met |
| adversarial | 0 | n/a | not applicable per evals.md | no cases |

## Failures and fixes

Chronological. Each failure names the check, the cause, the fix commit, and the re-run.

| # | Check | Cause | Fix commit | Re-run exit code |
|---|-------|-------|------------|------------------|
| | | | | |

## Not verified

Anything believed but not run, with the reason.

- Nothing automatable left unrun. No manual cases.
