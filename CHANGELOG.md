# Changelog

Releases of the WorkHorse plugin, newest first. Each entry is built from the commits it shipped
(listed by hash), and names the release it follows and what that release did, so any one entry states where
it sits in the sequence on its own. Paddock, the desktop app, has its own changelog in `desk/CHANGELOG.md`.

Installing the plugin copies it (see README), so a change reaches a machine only once its version
is bumped and it is reinstalled.

## 0.3.1 — 2026-09-19

Follows 0.3.0 (two gates and a clock).

- `brief.md` carries its tier on its own line, `Risk tier: N (reason)`, the line both Studbook
  ingesters read; the header no longer folds it into the change-id line.

## 0.3.0 — 2026-09-19

Follows 0.2.14 (the verifier's plain-words "What was measured" section). Two gates and a clock,
from `docs/superpowers/specs/2026-09-19-two-gates-design.md`. (`85cc9cc`)

- Two human gates instead of five. The human touches a change at Ask (nothing to read), Design
  (G2, `brief.md`) and Ship (G4, `ship.md`); tier 3 adds Deploy (G5, `release.md`), and `assisted`
  or `shadow` autonomy adds Deploy at every tier. Tier 0 needs G4 only; tiers 1 and 2 need G2 and
  G4. G1 and G3 keep their ids for state, approvals and Paddock, but no tier requires them and the
  conductor sets them `auto`.
- A clock on every run. `WH clock` reads the conductor log and reports agents working, waiting on
  the human, dead time and gaps against the tier budget (0: 15 minutes, 1: 30, 2: 90, 3: 180;
  `budgets.agent_minutes` in the profile overrides). The shipper pastes it into `ship.md`; the
  retro judges the run against it.
- Known failures. A check that is red on the base branch is recorded once with `WH known-failure
  add` and cited by later phases with `WH known-failure list`; verification may be green with a
  known failure cited, never with one that is not recorded.
- Agents merged. `wh-designer` replaces the intent writer, risk classifier, spec architect and
  implementation planner; `wh-polish` replaces the readability reviewer and simplifier;
  `wh-shipper` replaces the packet compiler and release engineer; the verifier absorbs the eval
  runner; `wh-express-dev` is removed, since tier 0 is now the same pipeline with one gate.
- Document size limits enforced by `artifact-check.js`, which replaces `artifact-size.js`: line
  limits by tier for every change document, a cap on eval cases (15/40/80 by tier, counted by
  id), and reviewer reports written to `reviews/<agent>.md` at 60/80/100 lines.
- The Ship document is never presented with a blocker. Findings marked high or medium with a
  concrete fix go to the fixer before `ship.md` exists, and the hook and `WH approve G4` both
  refuse a Ship document that still carries one.
- The retro runs in the background after `WH phase done`, the one exception to the conductor's
  always-wait rule; it commits its own `retro.md`.
- Phases renamed to design, build, verify, review, deploy, done. The templates `intent.md` and
  `review-packet.md` are replaced by `brief.md` and `ship.md`.
- The decision policy: no agent stops a run to ask a question. A question becomes a decision row
  with a recommendation, the run continues with the recommendation, and the row appears in the
  next packet; approving a packet accepts every recommendation unless the notes say otherwise.
- Why: measured from three real changes' logs, the human waited 41, 10 and 17 hours on runs whose
  agents worked 7 hours, 3 hours 40 minutes and 1 hour 45 minutes, with every webapp approval note
  reading "none".

## 0.2.14 — 2026-09-18

Follows 0.2.13 (a version bump with no content change).

- The verifier writes a plain-words "What was measured" section in `verification.md`: one sentence
  per check with the counts read from its log ("Test suite: 47 tests, 47 passed, 0 failed"),
  compared with the previous change's verification by name. (`b33396a`)

## 0.2.13 — 2026-09-17

Follows 0.2.12 (approvals must answer every packet decision).

- No content change since 0.2.12. A version bump so the installed copy and the copy bundled in
  Paddock 0.4.0 agree. (`4072c0f`)

## 0.2.12 — 2026-09-15

Follows 0.2.11 (fixes from the ECC live run: artifact size enforced, a change cannot close before its retro).

- An approval must answer every decision its packet raises, not just approve the gate as a whole.
  (`eb443b5`)
- Released with Paddock 0.3.0, the Dracula redesign, which bundles it. (`16d7e43`)

## 0.2.11 — 2026-09-15

Follows 0.2.10 (bug-reviewer fixes on the autopilot commit). Fixes from the ECC live run.

- Artifact size is enforced by a hook, and read-only access to sensitive paths no longer raises a
  change's tier. (`080d572`)
- Re-verification always runs the eval runner; the review packet template names the ECC
  specialists. (`3db57bc`)
- A change cannot close before its retro exists, and the close commit carries the retro's instinct
  files. (`63eff25`, `a1c13d8`)

## 0.2.10 — 2026-09-14

Follows 0.2.9 (a reviewed subset of ECC vendored).

- Six findings from the bug reviewer on the autopilot commit, and a rejected gate now waits on
  agents rather than the human. (`a2f26e7`)

## 0.2.9 — 2026-09-14

Follows 0.2.8 (the tier-0 fast lane and tier-matched models).

- A reviewed subset of ECC is vendored and composed alongside WorkHorse's own agents: its rule
  packs, nine specialist agents, AgentShield in the security review, and instinct-format learning
  in the retro. (`33e39ff`)

## 0.2.8 — 2026-09-13

Follows 0.2.7 (the tracker uses the claude.ai Notion connector).

- A tier-0 fast lane (`wh-express-dev`) and models matched to the tier. (`6111d07`)

## 0.2.7 — 2026-09-12

Follows 0.2.6 (the build sized to the change).

- The tracker mirror uses the claude.ai Notion connector instead of the Notion plugin's skills.
  (`450e52d`)

## 0.2.6 — 2026-09-12

Follows 0.2.5 (real conductor-log timestamps, artifacts sized to the change).

- The build is sized to the change: fewer tasks, and one polish pass at low tiers. (`5909ea3`)
- A finished change is closed in git, and Paddock offers Start rather than Resume once it is done.
  (`1eac3aa`)

## 0.2.5 — 2026-09-12

Follows 0.2.4 (control state moved into the git common dir).

- Real timestamps in the conductor log, and artifacts sized to the change. (`9bb9ad1`)
- The approve skill, CI review and Paddock spec point at the new control-state location.
  (`450cbdb`)

## 0.2.4 — 2026-09-12

Follows 0.2.3 (the conductor's dispatch contract: name every agent and wait for it).

- Control state moved into the git common dir, where no checkout can rewrite it. Before this, a
  checkout of the change branch rewrote the tracked state files: the active change went empty, the
  phase went back from build to spec, every state-driven hook stood down, and builder worktrees had
  no gate or test-lock enforcement at all. (`799f17b`)

## 0.2.3 — 2026-09-12

Follows 0.2.2 (approvals pin and hash their packet).

- The conductor must name every agent it dispatches (an exact `subagent_type`) and wait for it
  (`run_in_background: false`). A run had stalled after G2 when a dispatch without either went to a
  generic background agent and the conductor ended its turn. (`2099313`)

## 0.2.2 — 2026-09-12

Follows 0.2.1 (no green verification without defined checks).

- An approval pins and hashes the packet it approves: the change's artifacts are committed first,
  and the recorded commit contains the packet. Before this, an approval recorded whatever HEAD was,
  and the approved packet could be edited afterwards with nothing showing it. (`9943358`)

## 0.2.1 — 2026-09-11

Follows 0.2.0 (the Notion tracker mirror).

- A verification cannot be marked green when the profile defines no checks. (`bdd3a21`)

## 0.2.0 — 2026-09-09

Follows 0.1.0 (the first release).

- A Notion tracker mirror (`wh-tracker-sync`). (`f35419d`)
- Quoted scalars in the profile YAML parser are unescaped. (`514e3ec`)

## 0.1.0 — 2026-09-07

The first release: the agentic SDLC plugin with risk-tiered human gates. (`6f26db7`)
