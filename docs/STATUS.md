# Where things stand

Last updated 2026-09-19. The state of WorkHorse (the plugin), Paddock (the desktop app) and
Studbook (the record's question answering, inside Paddock), what is open, and what to do when
picking this back up. Studbook's own detail is in `studbook/docs/status.md`.

## In one paragraph

All three are functionally complete and in daily-usable shape. WorkHorse 0.2.14 is installed at
user scope; Paddock 0.4.9 is the current portable build (`desk/dist/Paddock-0.4.9-portable.exe`);
Studbook's pipeline is finished, measured on a held-out split, and runs inside Paddock with its
Python reference held to it by exact parity checks. Both repositories have CI on every push,
branch protection, pre-push hooks, Dependabot and changelogs. What is left is optional improvement
and a few decisions that belong to the owner.

## Versions

| Piece | Version | Where |
|---|---|---|
| WorkHorse plugin | 0.2.14 | installed at user scope; source is this repository |
| Paddock | 0.4.9 | `desk/dist/Paddock-0.4.9-portable.exe`, bundling plugin 0.2.14 |
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
- **Live-run behaviour of the plugin itself has not been re-measured since 0.2.11.** Every
  earlier live run surfaced fixes that tests and reviewers had missed. The next real change built
  through Paddock is the measurement.

## Loose ends noticed, not yet fixed

- The root README says "eight Node scripts" in its hooks table; there are nine (artifact-size was
  added in 0.2.11). Its "Known limits" also still calls tracker sync unimplemented, though the
  Notion mirror shipped in 0.2.0.

## Picking it back up

- **Building with Paddock:** run `desk/dist/Paddock-0.4.9-portable.exe`, register a repository,
  onboard it, and start a change. Use 0.4.9 or later to refresh Studbook's record: an older
  build's Refresh deletes documents its parser does not know, which now includes the changelogs.
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
| WorkHorse design | `docs/superpowers/specs/2026-09-06-workhorse-sdlc-design.md` |
| Paddock design | `docs/superpowers/specs/2026-09-10-paddock-desktop-design.md` |
