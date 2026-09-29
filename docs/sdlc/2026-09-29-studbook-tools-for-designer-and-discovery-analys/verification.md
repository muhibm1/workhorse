# Verification: Studbook tools for designer and discovery analyst

Change id: `2026-09-29-studbook-tools-for-designer-and-discovery-analys`
Status: green
Run at: 2026-09-29T17:50:49.801Z UTC
Commit: `c319f0053fe3`

Status is green only when every defined check exited 0 and every eval category met its target.
"No check defined" rows do not count as passes; they are listed so the gap is visible.

## What was measured

<!-- wh:verify-start -->
<!-- written by `wh.js verify`; edit outside the markers -->
- Type check: 0 errors (`npm --prefix desk run typecheck`).
- Lint: 0 errors (`npm --prefix desk run lint`).
- Test suite: 278 passed, 0 failed, 1 skipped (`npm test && npm --prefix desk test`).
- Build: succeeded (`npm --prefix desk run build`).
- e2e: known failure, cited from .workhorse/known-failures.md (base f06c635: believed, not verified at base: smoke.spec.ts locators 'Studbook' and fleet card are ambiguous (strict mode, 2 elements); this change touches only agents/*.md and no file under desk/). Known failure, (base f06c635), cited not re-run.
- Dependency audit: 0 vulnerabilities (`npm --prefix desk audit`).
<!-- wh:verify-end -->


## Checks

| Check | Command | Exit code | Output | Status |
|-------|---------|-----------|--------|--------|
| install | npm --prefix desk ci | | | skipped (runs with --install) |
| typecheck | `npm --prefix desk run typecheck` | 0 | `verify-logs/typecheck.log` | confirmed |
| lint | `npm --prefix desk run lint` | 0 | `verify-logs/lint.log` | confirmed |
| test | `npm test && npm --prefix desk test` | 0 | `verify-logs/test.log` | confirmed |
| build | `npm --prefix desk run build` | 0 | `verify-logs/build.log` | confirmed |
| e2e | `npm --prefix desk run e2e` | known | `verify-logs/known-failures` | known failure (base f06c635), cited not re-run |
| security_audit | `npm --prefix desk audit` | 0 | `verify-logs/security_audit.log` | confirmed |
| screenshot |  | | | no check defined |

## Evals

All cases re-run at HEAD `c319f00` (confirmed, Grep tool and git commands; the bullet window is the lead line plus 7 lines).

| Category | Cases | Passed | Target | Met |
|----------|-------|--------|--------|-----|
| golden | 4 (E1-E4) | 4 | 100% | yes |
| edge | 2 (E5, E7) | 2 | 100% | yes |
| failure | 1 (E8) | 1 | 100% | yes |
| adversarial | 1 (E6) | 1 | 100% | yes |
| non-functional | 1 (N1) | 1 | at most 9 added, 1 deleted per file | yes |

- E1, E2: each `tools:` line equals the spec Interfaces line exactly (designer line 4, analyst line 4).
- E3, E4: tool names, call cap phrase, `own_change_id` (designer) all inside the window; lead appears once per file (analyst line 34, designer line 37).
- E5: `continue without it` at analyst line 41 (window 34-41) and designer line 43 (window 37-44).
- E6: `untrusted data` and `believed, not verified` inside the window in both files.
- E7: `git diff --name-only master...HEAD -- agents/` lists exactly the two agent files.
- E8: `claude plugin validate .` printed "Validation passed"; `npm test` exit 0, 264 passed, 0 failed (`verify-logs/evals.log` was not written; output read from the run).
- N1: `git diff --numstat master...HEAD` gives designer +9 -1, analyst +9 -1.

## Known failures

- e2e (`npm --prefix desk run e2e`), base f06c635, cited from `.workhorse/known-failures.md` (two rows). This change touches no file under desk/.

No previous change to compare with.

## Not verified

- Screenshot check: no command defined in the profile.
- Live behaviour of the agents calling Studbook: the cases check prose and frontmatter only.

## Notes for the Ship document

- Untracked stray file `desk/studbook-verify.tmp.png` is not part of the change; delete or leave out of the commit.
- e2e known failure also writes desk/playwright-report, which eslint does not ignore (per known-failures.md); lint is now exit 0 in summary.json.
- Phrase checks used the Grep tool rather than the grep pipes named in evals.md; same lines and counts.
