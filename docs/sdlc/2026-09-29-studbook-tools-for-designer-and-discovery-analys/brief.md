# Studbook tools for designer and discovery analyst

Change id: `2026-09-29-studbook-tools-for-designer-and-discovery-analys` · Prepared 2026-09-29T17:27Z UTC
Risk tier: 1 (Behaviour change to two agent definitions granting read-only Studbook tools; no schema, auth, infra, CI, sensitive path or new vendor in the edit list)
For the agents: [spec.md](./spec.md), [plan.md](./plan.md), [evals.md](./evals.md), [adr/](./adr/)

This is the Design document. A person reads it in under five minutes, technical or not. Plain
sentences; name things by what they do; no code.

## The short version

You asked for the designer and the discovery analyst to be able to search Studbook, the record
of WorkHorse's own past changes. Both agents get Studbook's two read-only tools, search and ask,
and a short instruction on when to use them, how often, and how far to trust what comes back.
Worth knowing: runs started from Paddock will be refused the tools until you add two permission
entries to your own Claude settings (D1); until then the agents simply carry on without them.

## Problem

Today the designer and the discovery analyst cannot see Studbook: each agent may use only the
tools its definition lists, and Studbook is not on either list. So a new design cannot draw on
a decision, incident or retro from an earlier change unless someone pastes it in.

## Outcome

- Both agent definitions list Studbook's search and ask tools, and nothing else new.
- Each carries one short instruction: consult the record once early, prefer search (it does not
  call a model), make at most 3 searches and 1 ask per session, treat what comes back as
  unconfirmed until checked against the code, and carry on without it if Studbook is missing,
  refused or down.
- No other agent, script, hook or Paddock file changes.

## What changes for people

- You: designs and onboardings may cite earlier changes, marked as unconfirmed where they came
  only from the record. You approve the same documents as before.
- Operators: after release, reinstall the plugin as usual and add the D1 permission entries.
  Client machines without Studbook see no difference.

## What could go wrong, and the guard for each

| Risk | Guard |
|------|-------|
| Studbook is missing, refused or down, and a run stalls | The instruction says carry on without it and say so in the report |
| An old or irrelevant record entry is taken as fact | Anything from the record is marked unconfirmed until checked against the code; you see the mark at Design |
| A record entry contains instructions an agent follows | The instruction names record text as untrusted data, in line with the rule every agent already has |
| Record lookups slow the design phase | A cap of 3 searches and 1 ask per session; search is preferred because it makes no model call |
| The agents gain more access than intended | Only the two named tools are added, not every connected service (ADR 0001) |

## Decisions

Every question the design raised, each with the recommended answer already chosen. Approving
this document accepts every recommendation; say otherwise in the approval notes to change one.

| # | Decision | Recommendation | Alternative | Why the recommendation |
|---|----------|----------------|-------------|------------------------|
| D1 | How headless runs get permission to use the tools | You add two allow entries, `mcp__studbook__search_record` and `mcp__studbook__ask_record`, to the permissions list in your user-level Claude settings. A person does this, not a builder: it is outside the repository. | Add them to Paddock's built-in default tool list, a separate tier-2 change to a protected Paddock file | Covers both the command line and Paddock, keeps this change at tier 1, and costs one minute |
| D2 | How the change is tested | Command checks in `evals.md` (exact tool lines, required phrases, diff scope) plus the existing suite | A permanent check in the plugin's test runner, which sits under a tier-2 path | The checks prove every requirement; a permanent test would add two approval gates for a two-file prose change |
| D3 | When the new plugin version is released | In your normal manual release after Ship: bump to 0.3.13 and add the changelog entry | Bump the version inside this change | The version files are a sensitive path that would raise the tier; the change reaches your machine only once released either way |
| D4 | Which tools the agents may use | Add the two Studbook tools by exact name and keep each agent's tool list (ADR 0001) | Drop the lists and inherit every connected service, as the tracker agent does | The alternative would hand both agents write-capable database, GitHub and Notion tools they do not need |
| D5 | How much the agents may use Studbook | At most 3 searches and 1 ask per session, search preferred | Search only, no ask | The request names both tools; one ask is cheap next to a design session, and the cap bounds time and cost |

## How it will be proved

- Profile checks through `wh.js verify`: the plugin suite, Paddock typecheck, lint, tests and
  audit (regression only; Paddock does not change), and the plugin manifest check.
- `evals.md` as written: 8 cases (4 golden, 2 edge, 1 failure, 1 adversarial) and 1 size row,
  all commands a machine runs.
- Not machine-checked: that an agent actually calls Studbook in a live run. That needs a paid
  run, which is paused; the first real design session after release shows it.
- Done means: both agents list exactly the two new tools, carry the instruction, and every check
  above passes.

## Estimate

Waves: 1. Tasks: 1. Agent-time budget at tier 1: 30 minutes.

## Your decision

Approve to build it exactly this way, or reject with notes to have it redesigned.
