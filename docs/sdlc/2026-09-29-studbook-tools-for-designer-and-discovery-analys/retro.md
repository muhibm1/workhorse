# Retro: Studbook tools for designer and discovery analyst

Change id: `2026-09-29-studbook-tools-for-designer-and-discovery-analys`
Trigger: G4 approval

## What happened

Two agent definition files (designer, discovery analyst) gained the exact Studbook tool names and a capped-use bullet. The change shipped as PR 17 (merged as 2842166) at tier 1 with one medium finding fixed and all evals at 100%. It ran over budget mainly because design was blocked three times by the harness refusing writes under `docs/sdlc/<id>/`, and verify blocked twice more on environment issues.

## Clock

- Agent time: 45 minutes against a tier 1 budget of 30 minutes: OVER (confirmed, figure supplied by the conductor). The ship packet showed 42 m at G4; the difference is post-G4 deploy work (believed, not verified).
- Longest phase: design, 21 minutes. Cause, from `conductor-log.md`: three "blocked" rows (lines 4, 5, 7) for the sensitive-file refusal on the change folder, resolved by the operator at line 8 (plugin loaded from a separate checkout). The reason is in the log, so this is a lesson, not a log gap.
- Other lost time: verify hit two blocks (playwright-report poisoning lint, lines 15-19; `claude plugin validate` permission ask, line 23) and review needed three fixer commits and one lint-red loop (lines 28-35).
- Wait and dead time as pasted in ship.md: waiting 1 m, dead 8 m.

## What the pipeline caught

| Phase | Finding | Would a human have caught it? |
|-------|---------|-------------------------------|
| review | wh-bug-reviewer medium: unguided `repo` value gives a silent empty result (`agents/wh-discovery-analyst.md:34`), fixed in 5aa83a1 | Unlikely; it depends on Studbook's case-sensitive matching |
| verify | Lint red from a stale e2e report folder | Yes, but only after confusion |
| verify | E8 needed an allowlisted validate command | Yes |
| review | Conformance: no permanent test, two user-level allow rules needed, deferred version bump | Yes, all were already decisions D1-D3 |

## What the pipeline missed

| Missed | Where it should have been caught | Fix |
|--------|----------------------------------|-----|
| Writes to the change folder refused, three times | Conductor preflight before Design | Instinct `design-writes-refused-in-change-folder` |
| e2e output breaking lint | Profile or eslint config | Instinct `verify-report-poisons-lint`; ignore generated folders |
| Eval command not allowlisted | Design, when evals.md is written | Instinct `allowlist-eval-commands-up-front` |
| No eval for the repo-key and retry wording added after review; two extra fix commits to keep E4, E5, N1 green | Fixer step | Instinct `review-fix-needs-matching-eval` (ship.md "Known gap") |
| Live agent behaviour against Studbook untested | Evals check prose only | Accepted; noted under Not verified in ship.md |

## Instincts written

Four files' worth of instincts, all confidence 0.5 (seen once), in `.workhorse/instincts/2026-09-29-studbook-tools-for-designer-and-discovery-analys.md`. None reach 0.7, so nothing is promoted to CLAUDE.md.

## Proposed memory updates

| Target | Change | Reason |
|--------|--------|--------|
| CLAUDE.md "Mistakes to avoid" | None yet; all instincts at 0.5 | Wait for a second occurrence |
| `.workhorse/profile.yml` | Add `desk/playwright-report` and `desk/test-results` to the eslint ignore (desk eslint config, ask-first path if under protected list) | Stops e2e output turning lint red (lines 15-19, 31) |
| `.workhorse/profile.yml` | Allow `claude plugin validate *` (already added by operator at line 24; confirm it is committed) | E8 blocked verify |
| Plugin skill (wh-design or conductor) | Add a preflight: confirm agent writes to `docs/sdlc/<id>/` succeed before dispatching the designer. Plugin edit for a human to make | Cost 3 blocks and most of the 21 design minutes |
| Plugin skill (wh-evals) | When a fix adds required wording, add its phrase-check case in the same commit | Known gap E9 |

## New evals

Proposed for `evals.md` (not applied, change already shipped):

- E9 (edge): Given `agents/wh-discovery-analyst.md`, when grepping the Studbook bullet window, then the lowercase repo key and the "retry once without it" wording both appear.
