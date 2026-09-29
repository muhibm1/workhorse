Verdict: 0 findings (0 critical, 0 high, 0 medium, 0 low)

Re-check of fixer commit 5aa83a1 against the earlier medium finding.

| Severity | File:line | Finding | Failure scenario | Fix |
|---|---|---|---|---|

Closed findings:
- medium, agents/wh-discovery-analyst.md:34 (unguided `repo` value gives a silent empty result): closed (confirmed, `git show 5aa83a1`). Lines 35-39 now say `repo` must be the lowercase corpus key (example `workhorse`), that a repo-scoped search with no passages is retried once without `repo`, and that results are then filtered by each passage's repo field. The filter can be done: every passage returned by search_record has a `repo` key (confirmed, `studbook/mcp_server/record.py:586-597`, `_passage_dicts`). The retry counts toward the cap of 3 search_record calls, so the budget cannot be exceeded. Re-onboarding with `WorkHorse` or `muhibm1/WorkHorse` now costs 2 of 3 calls and still returns the codebase-map and constraints passages from the default scope (believed, not verified: no live call was made).
- New issues in the changed lines: none. The retry trigger is "no passages", which is the exact miss that returns `status: ok` (confirmed earlier, `record.py:360-368`). Non-`ok` statuses still go to the existing "continue without it" rule, which the commit left unchanged.

Findings outside scope: The eval gap from the original finding is still open. No E9 was added to evals.md (confirmed, grep for "E9" and "corpus key" in the change folder matches only this report). E4 still checks only the tool names and the call cap, so a later edit could remove the corpus-key or retry wording and no eval would fail. The studbook-side exact, case-sensitive `repo` match (`record.py:91`, `retrieve/hybrid.py:47`) is unchanged and belongs in the studbook repository.
Not verified: whether the the harness tool prefix is `mcp__studbook__*` when the server is registered under another name (unchanged from the first review). Files read for this re-check: this report, `git show 5aa83a1`, studbook `mcp_server/record.py:586-597`, and a grep of the change folder.
