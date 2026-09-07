# Verification: {{title}}

Change id: `{{change_id}}`
Status: green | red | partial
Run at: {{timestamp}} UTC
Commit: `{{commit}}`

Status is green only when every defined check exited 0 and every eval category met its target.
"No check defined" rows do not count as passes; they are listed so the gap is visible.

## Checks

| Check | Command | Exit code | Output | Status |
|-------|---------|-----------|--------|--------|
| typecheck | | | `path/to/log` | confirmed |
| lint | | | | |
| test | | | | |
| build | | | | |
| e2e | | | | |
| security_audit | | | | |
| screenshot | | | | |

## Evals

| Category | Cases | Passed | Target | Met |
|----------|-------|--------|--------|-----|
| golden | | | 100% | |
| edge | | | 100% | |
| failure | | | 100% | |
| adversarial | | | 100% | |

## Failures and fixes

Chronological. Each failure names the check, the cause, the fix commit, and the re-run.

| # | Check | Cause | Fix commit | Re-run exit code |
|---|-------|-------|------------|------------------|
| | | | | |

## Not verified

Anything believed but not run, with the reason.

- 
