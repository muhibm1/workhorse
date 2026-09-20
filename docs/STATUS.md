# Where things stand

Last updated 2026-09-19. The state of WorkHorse (the plugin), Paddock (the desktop app) and
Studbook (the record's question answering, inside Paddock), what is open, and what to do when
picking this back up. Studbook's own detail is in `studbook/docs/status.md`.

## In one paragraph

All three are functionally complete and in daily-usable shape. WorkHorse 0.3.0 is the current
source (two gates and a clock; install it to replace 0.2.14 at user scope); Paddock 0.4.9 is the
current portable build (`desk/dist/Paddock-0.4.9-portable.exe`) and still shows the five-gate
model until 0.5.0; Studbook's pipeline is finished, measured on a held-out split, and runs inside
Paddock with its Python reference held to it by exact parity checks. Both repositories have CI on
every push, branch protection, pre-push hooks, Dependabot and changelogs. What is left is the
three proving runs, Paddock 0.5.0, and a few decisions that belong to the owner.

## What changed on 2026-09-19

WorkHorse 0.3.0 replaces the five-gate pipeline with three human touches: Ask, Design (G2,
`brief.md`) and Ship (G4, `ship.md`), plus Deploy (G5) at tier 3. Phases are now design, build,
verify, review, deploy, done. Ten agents were merged or removed (designer, polish and shipper
replace nine; express-dev is gone), `WH clock` measures every run against a tier budget,
pre-existing red checks are recorded once as known failures, the `artifact-check` hook holds
every document to a size a person reads and refuses a Ship document with a blocker, reviewer
findings with a fix are fixed before the human sees them, and no agent stops a run to ask a
question. The reasons, measured from three real changes' logs, are in
`docs/superpowers/specs/2026-09-19-two-gates-design.md` section 1; the plugin changelog has the
full list.

## Versions

| Piece | Version | Where |
|---|---|---|
| WorkHorse plugin | 0.3.0 | source is this repository; 0.2.14 is what is installed at user scope until reinstalled |
| Paddock | 0.4.9 | `desk/dist/Paddock-0.4.9-portable.exe`, bundling plugin 0.2.14; 0.5.0 (Design / Ship / Deploy gate screens, the clock on the Run screen) is the next release |
| Studbook | reference implementation + eval harness | `~\studbook`, private repo `muhibm1/studbook` |

A release must add a changelog entry (`CHANGELOG.md` for the plugin, `desk/CHANGELOG.md` for
Paddock): CI fails otherwise, because Studbook answers release questions from those files.

## Decisions waiting on the owner

1. **Re-score Studbook's held-out split?** The record grew on 2026-09-19 (the changelogs), so the
   published held-out numbers describe a slightly smaller record. The rule is to score it only as
   a deliberate spend; the recommendation is to wait for the next real change to how answers are
   produced.
2. **Should branch protection bind admins too?** Today an admin's direct push is allowed and
   recorded by GitHub as a bypass. Binding admins puts every change, the assistant's included,
   through a pull request that must pass CI.
3. **A separate Anthropic key for CI** with a spend limit. The live job currently uses the
   production key (`STUDBOOK_TEST_ANTHROPIC_API_KEY` secret).

## Known weaknesses (measured, documented, not bugs)

- **Cross-document questions.** When an answer needs two documents, all of them reach the model
  only 43% of the time (coverage@5, dev). Four fixes were measured and rejected
  (`studbook/docs/cross-doc.md`); the remaining lever is how the record is written.
- **A few answers the prompt cannot fix.** `health-13` refuses with its evidence present in every
  run; `wh-15` names the wrong release even with the right changelog entry ranked first
  (`studbook/docs/refusal-experiments.md`).
- **The two-gate pipeline has not run on a real change yet.** Every earlier live run surfaced
  fixes that tests and reviewers had missed, and 0.3.0 changed the conductor, three new agents,
  the CLI and a hook at once. The next step is the three proving runs from the design document
  (section 6), each from an existing backlog with the clock running:
  1. hello-service, tier 0: budget 15 agent-minutes, one touch (Ship).
  2. Portfolio Node pin, tier 1: budget 30 to 60 agent-minutes, two touches (Design, Ship).
  3. webapp `dvh`/`vh` and cross-reference comments, tier 2: budget 90 agent-minutes, two touches.
  Results go here and into the scorecard as measured, budget missed or not.
- **Paddock 0.4.9 still renders the five-gate model.** Its gate screen reads `intent.md` and
  `review-packet.md`, which 0.3.0 no longer writes; a change started with the 0.3.0 plugin is
  driven from the CLI until Paddock 0.5.0 ships (gate labels Design / Ship / Deploy, the Gate
  screen renders `brief.md` and `ship.md`, the Run screen shows the clock, and opening a gate
  records `gate_opened.<G>` so the clock can measure the human's time).

## Picking it back up

- **Building with Paddock:** run `desk/dist/Paddock-0.4.9-portable.exe`, register a repository,
  onboard it, and start a change. Use 0.4.9 or later to refresh Studbook's record: an older
  build's Refresh deletes documents its parser does not know, which now includes the changelogs.
  Until Paddock 0.5.0, a 0.3.0 change is approved with `/workhorse:approve G2` and `G4` from
  the harness, not from Paddock's gate screen.
- **Releasing 0.3.0:** the plugin is installed by copying, so `claude plugin install
  workhorse@workhorse --scope user` again after the version bump; Paddock bundles the plugin, so
  0.5.0 must be built after that.
- **Developing Paddock** needs Node 22.12+; this machine runs 24.19.0 since 2026-09-18.
- **Before any Studbook schema change:** `python -m store.bootstrap_db --migrations-only`
  (and `--target test` for the test project). A plain run rotates role passwords, which breaks
  the connection Paddock stores.
- **CI's database tests:** Actions > ci > Run workflow, tick "live". They run against the
  `studbook-test` Supabase project, never production.

## Where the evidence lives

| Question | Document |
|---|---|
| What Studbook scores, and every change measured | `studbook/README.md`, `studbook/docs/` |
| Why a follow-up is rewritten | `studbook/docs/follow-ups.md` |
| Cross-document retrieval, and four rejected fixes | `studbook/docs/cross-doc.md` |
| The prompt experiments | `studbook/docs/refusal-experiments.md` |
| CI, the test project, accepted advisories | `studbook/docs/ci.md` |
| What lives in Supabase | `studbook/docs/hosted-config.md` |
| Paddock's parity with Studbook | `studbook/docs/paddock-gate.md` |
| WorkHorse gates, phases, documents and clock (0.3.0) | `docs/superpowers/specs/2026-09-19-two-gates-design.md` |
| WorkHorse design, everything else | `docs/superpowers/specs/2026-09-06-workhorse-sdlc-design.md` |
| Paddock design | `docs/superpowers/specs/2026-09-10-paddock-desktop-design.md` |
