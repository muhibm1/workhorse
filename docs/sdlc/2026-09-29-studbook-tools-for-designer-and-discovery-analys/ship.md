# Ship: Studbook tools for designer and discovery analyst

Change id: `2026-09-29-studbook-tools-for-designer-and-discovery-analys` · Tier 1 · Branch `wh/2026-09-29-studbook-tools-for-designer-and-discovery-analys` at `c319f00` · PR https://github.com/muhibm1/workhorse/pull/17
Prepared 2026-09-29 UTC · Design approved: see [approvals.md](./approvals.md)

This is the Ship document. Approving it merges the change. The only environment marked automatic is `dev`, whose deploy command is empty, so nothing else runs.

## The short version

Two planning agents (the designer and the discovery analyst) can now search and ask Studbook, the record of past WorkHorse work, so they start from what earlier changes decided. It changes two agent definition files only, adding two named tools and a short capped-use bullet in each. You are deciding whether to merge it; it reaches your machine only after your manual 0.3.13 release and plugin reinstall.

## What changed

In plain words: each agent may now call `search_record` (up to 3 times) and `ask_record` (once) per session, treats the answers as untrusted data, labels them `believed, not verified`, and carries on without Studbook if it is unavailable. The analyst also passes the lowercase repo key and retries once without it if nothing comes back.

1. `agents/wh-designer.md` (+9 -1): tools line gains the two Studbook tools; one bullet in Inputs. First because agent files decide what the agents may do.
2. `agents/wh-discovery-analyst.md` (+9 -1): same, plus the repo-key and retry wording added after review. Second, same reason.
3. `docs/sdlc/2026-09-29-studbook-tools-for-designer-and-discovery-analys/` (brief, spec, plan, evals, ADR 0001, reviews, verification, logs): the record. Last, documentation only.
4. `.workhorse/known-failures.md`: two e2e rows cited below. Config, listed last.

Not in the commit: `desk/studbook-verify.tmp.png` and any `desk/*.tmp.cjs` (confirmed untracked stray files; left out).

## Proof

| Check | Command | Exit code | Output | Status |
|-------|---------|-----------|--------|--------|
| typecheck | `npm --prefix desk run typecheck` | 0 | [typecheck.log](./verify-logs/typecheck.log) | confirmed |
| lint | `npm --prefix desk run lint` | 0 | [lint.log](./verify-logs/lint.log) | confirmed |
| test | `npm test && npm --prefix desk test` | 0 (278 passed, 0 failed, 1 skipped) | [test.log](./verify-logs/test.log) | confirmed |
| build | `npm --prefix desk run build` | 0 | [build.log](./verify-logs/build.log) | confirmed |
| e2e | `npm --prefix desk run e2e` | known failure | [known-failures](./verify-logs/known-failures) | cited, not re-run |
| security audit | `npm --prefix desk audit` | 0 (0 vulnerabilities) | [security_audit.log](./verify-logs/security_audit.log) | confirmed |
| plugin manifest | `claude plugin validate .` | 0 ("Validation passed") | read from run, no log file | confirmed |
| screenshot | none defined | n/a | n/a | not run: no command in the profile |

Evals: golden 4/4, edge 2/2, failure 1/1, adversarial 1/1, non-functional 1/1, all at 100% target ([verification.md](./verification.md)).
Not verified: live behaviour of the agents calling Studbook (evals check prose and frontmatter only), and whether the harness names the tools `mcp__studbook__*` (believed, not verified).
Known pre-existing failures cited from `wh.js known-failure list` (base f06c635, e2e): Paddock's Playwright smoke test is flaky on this machine (locators ambiguous, timeouts), Paddock is retired, and this change touches no file under `desk/`.

## What the reviewers found

Reports: [reviews/](./reviews/). No critical or high findings. The one medium is fixed.

| Severity | Reviewer | File:line | Finding | Resolution |
|----------|----------|-----------|---------|------------|
| medium | wh-bug-reviewer | `agents/wh-discovery-analyst.md:34` | An unguided `repo` value (for example `WorkHorse`) gives a silent empty result | fixed in 5aa83a1; closed on re-check (confirmed) |
| low | wh-conformance-reviewer | brief.md D2 | No permanent test in `hooks/tests/run.js`; evals are one-off command checks | accepted: recommendation taken (D2), tier-2 path avoided |
| low | wh-conformance-reviewer | brief.md D1 | Two user-level allow rules needed for the studbook tools, outside the repo | open by design: needs owner action (D1) |
| low | wh-conformance-reviewer | brief.md D3-D5 | Version bump deferred, exact-name tool lists, caps 3 and 1 | accepted: recommendations taken |
| none | ecc-silent-failure-hunter | n/a | 0 findings | n/a |

Known gap, unreviewed as a finding: no E9 eval covers the repo-key and retry wording, so a later edit could remove it unnoticed (raised in the bug re-check). Outside scope: Studbook's case-sensitive `repo` matching lives in the studbook repository.
Fixer commits: 5aa83a1 (the medium), 7b8cd91 and c319f00 (wording, evals E4, E5 and N1 kept compliant).
Spec conformance: 7 of 7 requirements traced to code and test. Adoption score: not reported by the reviewers.

## Decisions

Approving accepts every recommendation below.

| # | Decision | Recommendation | Alternative | Why the recommendation |
|---|----------|----------------|-------------|------------------------|
| D1 | Permission for headless runs | You add `mcp__studbook__search_record` and `mcp__studbook__ask_record` to your user-level allow list (needs you) | Add to Paddock's default tool list (tier-2 change) | Covers CLI and Paddock, one minute; without it the agents run without the record |
| D2 | Testing | Command checks in evals plus existing suite | Permanent test in the runner | Avoids two extra gates for a two-file prose change |
| D3 | Release | Bump to 0.3.13 in your manual release | Bump inside this change | Version files are sensitive paths |
| D4 | Tool access | Exact tool names, keep each agent's list (ADR 0001) | Inherit all services | Avoids write-capable tools the agents do not need |
| D5 | Usage cap | 3 searches, 1 ask per session | Search only | Bounds time and cost |

## Deploy and undo

| Environment | Command | Automatic on approval | Rollback |
|-------------|---------|-----------------------|----------|
| dev | none (empty in profile) | yes | not applicable, nothing deployed |
| staging | none (empty in profile) | no | not applicable |
| prod | `claude plugin install workhorse` | no | `git revert <merge commit>` then reinstall the plugin |

Rollback rehearsed (tier 2+): not applicable at tier 1.
Config and secrets touched (names only): none in the repo. D1 asks the owner to edit a user-level permissions list.

## Clock

Clock: agents 42 m of 30 m budget (OVER) · waiting on you 1 m · dead 8 m · wall 52 m

## Your decision

Approve to merge, or reject with notes to send it back. After approval, bump to 0.3.13, add the changelog entry and reinstall the plugin by hand.

```
/workhorse:approve G4
/workhorse:approve G4 --reject "notes"
```

## Deploy record

| Environment | Command | Exit code | UTC |
|---|---|---|---|
| merge | `gh pr merge 17 --squash` (merge commit 2842166, state MERGED, confirmed) | 0 | 2026-09-29T21:01:19Z |
| dev | not run: profile `deploy` is empty (dev is master, updated by the merge) | n/a | n/a |
| staging | not run: `auto: false` and no deploy command | n/a | n/a |
| prod | production: not automatic in this profile. Owner bumps to 0.3.13, adds the changelog entry and reinstalls the plugin by hand (D3) | n/a | n/a |
