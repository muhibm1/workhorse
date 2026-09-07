# Review packet: {{title}}

Change id: `{{change_id}}`
Gate: {{gate}}
Tier: {{tier}}
Branch: `{{branch}}` at `{{commit}}`
PR: {{pr_url}}
Prepared: {{timestamp}} UTC

## 1. TL;DR

Three sentences. What was built. Why. What you are being asked to decide.

## 2. Decisions requested

| # | Decision | Recommendation | Alternative | If you choose the alternative |
|---|----------|----------------|-------------|-------------------------------|
| D1 | | | | |

## 3. Evidence

Every row is `confirmed` (the agent ran it and read the output) or `believed, not verified`.

| Check | Command | Exit code | Output | Status |
|-------|---------|-----------|--------|--------|
| | | | | |

Eval summary: golden {{g}}/{{gt}}, edge {{e}}/{{et}}, failure {{f}}/{{ft}}, adversarial {{a}}/{{at}}.

## 4. Review findings

Merged from the bug, conformance, security, and adoption reviewers. Blocking findings must be
resolved or explicitly accepted below.

| Severity | Reviewer | File:line | Finding | Resolution |
|----------|----------|-----------|---------|------------|
| | | | | |

Spec conformance: {{n}} of {{m}} requirements traced to code and test. Drift: {{drift}}.
Adoption score: {{score}}/5. Blockers: {{blockers}}.

## 5. Risk register

| Risk | Likelihood | Impact | Mitigation | Owner |
|------|------------|--------|------------|-------|
| | | | | |

## 6. Diff tour

Ordered by risk. Protected and sensitive paths first. Each entry: path, what changed, why it
is at this position in the tour.

1. 

## 7. Checklist

- [ ] Intent still matches what the client asked for
- [ ] Every requirement has a test
- [ ] No finding above medium remains unresolved
- [ ] Rollback is documented
- [ ] Client engineer could maintain this from the docs alone

{{security_checklist}}

## Approve

Run `/workhorse:approve {{gate}}` to approve, or `/workhorse:approve {{gate}} --reject "notes"` to send it back.
