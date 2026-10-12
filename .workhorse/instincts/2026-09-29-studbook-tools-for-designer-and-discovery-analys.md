# Instincts from 2026-09-29-studbook-tools-for-designer-and-discovery-analys

## design-writes-refused-in-change-folder

```yaml
id: design-writes-refused-in-change-folder
trigger: "when a designer or other agent must write under docs/sdlc/<id>/ at the start of a run"
confidence: 0.5
domain: tooling
source: 2026-09-29-studbook-tools-for-designer-and-discovery-analys
scope: project
```

## Action
Before dispatching the designer, check that agent writes to `docs/sdlc/<id>/` are permitted (plugin loaded from a separate checkout, allow rule in place). Do not retry the dispatch; each retry cost about 5 to 10 minutes.

## Evidence
- conductor-log.md lines 4, 5, 7: three "blocked" rows in design for the sensitive-file refusal; line 8 records the fix (plugin loaded from ~/WorkHorse-plugin).
- Design took 21 of 45 agent minutes.

## verify-report-poisons-lint

```yaml
id: verify-report-poisons-lint
trigger: "when a check writes generated output (playwright-report, test-results) that another check scans"
confidence: 0.5
domain: tooling
source: 2026-09-29-studbook-tools-for-designer-and-discovery-analys
scope: project
```

## Action
Ignore generated report folders in eslint, or run lint before e2e, so a known-failing e2e cannot turn lint red on the next run.

## Evidence
- conductor-log.md lines 15-19 and 31: lint red at 2477175 and 7e463fc only because desk/playwright-report existed; line 32 operator hot-fix.

## allowlist-eval-commands-up-front

```yaml
id: allowlist-eval-commands-up-front
trigger: "when an eval case runs a command not in the profile checks (for example claude plugin validate .)"
confidence: 0.5
domain: workflow
source: 2026-09-29-studbook-tools-for-designer-and-discovery-analys
scope: project
```

## Action
At design, list every command an eval needs and confirm it is allowlisted for unattended runs; otherwise verify blocks on a permission ask.

## Evidence
- conductor-log.md line 23: verify blocked on E8; line 24 allowlist added.

## review-fix-needs-matching-eval

```yaml
id: review-fix-needs-matching-eval
trigger: "when a reviewer finding leads to new required wording in a prose or agent file"
confidence: 0.5
domain: testing
source: 2026-09-29-studbook-tools-for-designer-and-discovery-analys
scope: project
```

## Action
The fixer adds an eval case (a phrase check) for the new wording in the same fix, so a later edit cannot remove it silently.

## Evidence
- ship.md "Known gap": no E9 covers the repo-key and retry wording added in bef5ed8.
- conductor-log.md lines 28-33: two follow-up fixes (7e463fc, f63c0f7) were needed to keep E4, E5, N1 compliant after the first fix.
