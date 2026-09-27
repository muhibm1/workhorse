# Where things stand

Last updated 2026-09-19. The state of WorkHorse (the plugin), Paddock (the desktop app) and
Studbook (the record's question answering, inside Paddock), what is open, and what to do when
picking this back up. Studbook's own detail is in `studbook/docs/status.md`.

## In one paragraph

All three are functionally complete and in daily-usable shape. WorkHorse 0.3.0 is the current
source (two gates and a clock; install it to replace 0.2.14 at user scope); Paddock 0.4.9 is the
current portable build (`~/Paddock-builds/Paddock-0.5.0-portable.exe`, bundling plugin 0.3.1) and shows the two-gate
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
| Paddock | 0.5.0 | `~/Paddock-builds/Paddock-0.5.0-portable.exe`, bundling plugin 0.3.1 (0.3.3 is installed at user scope); 0.5.0 (Design / Ship / Deploy gate screens, the clock on the Run screen) is the next release |
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
- **The three proving runs, measured on 2026-09-20** (clocks from `wh.js clock`; agent minutes
  exclude waiting on the human and the usage-limit cut-offs, which the clock reports as dead
  time):

  | Run | Tier | Agent minutes | Budget | Touches | Outcome |
  |---|---|---|---|---|---|
  | hello-service, README endpoints section | 0 | 40 | 15 | 1 | done; 11 tests, 3 medium findings fixed before Ship |
  | Portfolio, Node 22.12 pin | 2 | 109 | 90 | 2 | done: PR #11 squash-merged to main (7ea3583), Pages deploy and smoke test green, retro committed; the branch push and merge were the owner's by the profile's own rules (`ask` on push, `prod auto: false`); 4 tasks, 36 new tests, 10 findings fixed, one high caught by the shipper |
  | webapp, moderationApi type fix | 2 | 80 | 90 | 2 | done: PR #2 squash-merged into `v3-integration` (bc78c61), retro committed; 8 reviewers, 9 findings fixed, one pre-existing high accepted with reason |
  | Portfolio, phone-redaction scanner (run 4, on 0.3.7 to 0.3.9) | 2 | 103 | 90 | 2 | done: PR #15 squash-merged (9d24286), Pages deploy and smoke test green, retro committed; both defects reproduced before design, 34 evals incl. a real junction run, 6 findings fixed, 0 rejections, 5 minutes waiting; 79 of the minutes were spent before the usage-limit cut-off, and two more defects were found and fixed the same day (0.3.8 gate stamped auto before the tier was known; 0.3.9 worktree fence) |
  | Portfolio, deep links served with 200 on Pages (run 5, on 0.3.10) | 2 | **63** | 90 | 2 | done: PR #17 squash-merged (d7eb52c), Pages deploy green with the new deep-link smoke test, retro committed; 33 evals, 4 findings fixed, 0 rejections; the first run within budget on the fixed pipeline. Two operator mistakes, not pipeline defects: a duplicate Design approval (the owner had already approved in Paddock; the assistant approved again from the CLI and started a second conductor, stopped within two minutes), and the conductor then refusing to dispatch on a remembered hook denial until the owner logged the hand-checked verdicts |

  Every touch was one of the two designed ones; no run asked a question mid-way; no Ship
  document was presented with an open finding. Each run over budget exposed a defect that is
  now fixed and tested (0.3.2 to 0.3.6): eval cases written after the plan, review fixes barred
  from test files, slash-named task branches, a gate counted as waiting before it was presented,
  sensitive paths denied to a design the human had approved, the stale-worktree copy of the
  plan, the verifier's turn cap, and files the harness itself refuses to write headless
  (`.npmrc`). What remains over budget is real size: the Portfolio change grew to a CI guard
  script with its own review findings. The tier 0 budget of 15 minutes is not reachable with a
  verify and a review pass; 25 is the honest floor and is recorded in the design document.
- **Paddock cannot record an approval for a repository it does not list.** On 2026-09-20 three
  approvals were "made" in a Paddock whose registry held only the example folder; nothing was
  recorded and the runs sat for hours. The Fleet screen now lists the three run repositories;
  registering a repository is the first step of any run driven from Paddock.
- **the harness refuses some writes headless, whatever the plugin says.** `.npmrc`, `.env*`,
  keys and credential files need an interactive yes; a profile `ask_commands` entry such as
  `git push` is the same. The designer (0.3.5) turns the first into a decision the human
  performs; the second is the profile owner's call (Portfolio's rule kept the PR from opening).

## Fix before the next run (studbook MCP server, 2026-09-26 to 27)

The run shipped correct code but took 10 h 20 m wall and 4 h 10 m of agent time against a
90-minute budget. The owner's rule since then: speed is a defect, not a trade-off. Each item
below cost measurable time on that run.

1. **Paddock launches refuse the project's venv tools; the same launch from a terminal does not.**
   Confirmed: identical `--allowedTools` and plugin run `.venv/Scripts/ruff.exe` from a terminal
   but get "requires approval" when Paddock spawns them. Cause not found (settings file, argument
   joining, hooks and Git Bash variables ruled out). Cost about 3 h of blocked build.
2. **Paddock ignores `settings.pluginPath` and uses its bundled plugin**, although the file it
   reads (`%APPDATA%\Paddock\settings.json`) holds the path. 0.5.1 bundles 0.3.10 as a stopgap.
3. **Paddock's Resume starts a second conductor while one is running.** It happened twice: two
   conductors raced on a task worktree. A run needs a lock (pid in the git common directory),
   and Resume must refuse while it is held.
4. **Paddock lets the owner approve a gate before it is presented** (G2 was approved before the
   audit rewrote the brief, so it had to be approved twice). Disable Approve until `presented`.
5. **Paddock's allowlist editor accepts only a fixed catalog**, so `Bash(env *)` and
   `Bash(.venv/Scripts/*)` had to be written into the settings file by hand.
6. **Agents hit their turn caps mid-task** (builder at 60, fixer at 50): each cut-off left
   uncommitted work and cost a continuation agent. Commit every green step (as builders do since
   0.3.10) in the fixer too, and raise the caps where the task size warrants.
7. **A blocked conductor sits silently.** The run waited 2 h for a human who did not know it was
   blocked. Blocked should notify the way a presented gate does.
8. **`verify-before-stop` fires in any session whose working folder is the repository**, not only
   the conductor's, and nags a supervising session to write the verification report.
9. **The studbook live CI job hid its output and timed out** at 30 minutes (fixed in
   muhibm1/studbook#7: 60 minutes and streamed output).
10. **Paddock builds drop their dependencies through the `node_modules` junction** (npm reports
    them extraneous; the first 0.5.1 exe held 10 of 149 packages). The build script must swap
    the real folder in, as done by hand for 0.5.1, or install into the tree it builds from.
11. **studbook's pre-push hook fails in a git worktree** (it writes to `.git/`, a file there).

## Picking it back up

- **Disk.** `claude plugin install` copies the whole plugin folder into
  `~/.claude/plugins/cache/<version>/`, Paddock's `desk/` included, and never prunes old
  versions. On 2026-09-20 seventeen cached versions held 40 GB and the disk was full. Two rules
  keep it at 3 MB per version: `desk/node_modules` is a junction to
  `~/Paddock-deps/node_modules` (the installer skips links that point outside the
  plugin; recreate the junction after any `npm ci` that replaces it), and electron-builder
  writes to `~/Paddock-builds`, outside the repository. Delete old cache versions
  by hand when they pile up; there is no documented prune command.
- **Building with Paddock:** run `~/Paddock-builds/Paddock-0.5.0-portable.exe`, register a repository,
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
