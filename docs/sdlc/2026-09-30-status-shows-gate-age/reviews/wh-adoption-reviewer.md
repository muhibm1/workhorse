Verdict: 2 findings (0 critical, 0 high, 0 medium, 2 low)
Adoption score: 4

| Severity | File:line | Finding | Failure scenario | Fix |
|---|---|---|---|---|
| low | scripts/wh.js:877 | Comment cites "ADR 0001" by number only; the ADR lives under docs/sdlc/<id>/adr/, not a repo-wide path | Engineer greps for ADR 0001 and finds several unrelated numbered ADRs across changes | Write the path in the comment: docs/sdlc/2026-09-30-status-shows-gate-age/adr/0001-measure-gate-age-from-the-present-stamp.md |
| low | scripts/wh.js:910 | New digest fields gate_waiting_since and gate_waiting_minutes are not listed in any doc or in desk/src/shared/types.ts (believed, not verified: no doc lists the digest fields) | Engineer consuming the digest JSON does not learn the fields exist or that both are null when no gate waits | Add one line to the digest description in the docs, if one exists, naming both fields and the null case |

Walk-through (confirmed by reading the diff):
- Find: README status row names the age; workhorse.js status() holds the display; buildDigest holds the calculation.
- Understand: fmtAge has a doc comment; names match spec vocabulary (gate, presented, waiting).
- Change safely: hooks/tests/run.js covers boundaries, bad input, future stamp, corrupt stamp, re-present and the README row. A wrong change would fail a test.
- Run: no new commands or env vars; `npm test` is the documented command.
- Operate: display-only change, adds no logging. Not applicable.
- Why: ADR 0001 (age counts from the present stamp) and ADR 0002 (format) exist and are referenced.

Findings outside scope: none
Not verified: I did not run `npm test` or `workhorse status`; I read the diff only. CHANGELOG.md has no entry for this change, which I believe is by design because CLAUDE.md says releases are manual and add the entry at version bump.
