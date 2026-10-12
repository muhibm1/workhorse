# Continuation: WorkHorse session 87c83b66 (gate age, then 0.4.1 and 0.4.2)

Written 2026-10-07 for a fresh the harness session on a new machine. Paste or point the new
session at this file and say "pick up from here". Everything under "Verified" was checked with
a command on 2026-10-07; everything under "From agent reports" is what the conductor and retro
agents reported and was not re-read.

## What this chat did

Ran one WorkHorse change end to end with `/workhorse:run`, `/workhorse:approve G4`, and
`/workhorse:run` again:

- Change `2026-09-30-status-shows-gate-age`, tier 2. `workhorse status` now prints how long a
  waiting gate has waited, for example `Design is waiting on YOU for 3h`. Format is `12m`,
  `3h 12m`, `2d 4h`, counted from the gate's presented stamp. The digest gained
  `gate_waiting_since` and `gate_waiting_minutes`.
- Merged as [muhibm1/workhorse#23](https://github.com/muhibm1/workhorse/pull/23), merge commit
  `9869a91`. Verification was green: 323 tests, 11 new. Six reviewers, 0 high or medium
  findings, 4 lows accepted at G4.
- All eight G4 decisions (D1 to D8) were answered "recommendation accepted". Notably D5: no
  version bump in that change, release left manual.
- Artifacts: `docs/sdlc/2026-09-30-status-shows-gate-age/` (spec, evals, plan, brief, ship,
  verification, reviews, retro, adr). Retro committed as `3490070`.

### Two lessons the retro recorded (confidence 0.5, nothing applied)

1. The auto-mode permission classifier refused the conductor's dispatch of `wh-shipper` in
   deploy mode, so the human merged the PR by hand. Proposal: in the deploy phase run
   `gh pr view --json state` before dispatching a merge and skip the dispatch if already merged.
2. The same classifier refused the AgentShield scan of `hooks/`, so it is listed as "Not
   verified" in that change's `ship.md`.

## Where the repo stands now (verified 2026-10-07)

The repository moved on after this chat, in sessions I did not see. State on this machine:

| Item | State |
| --- | --- |
| Checked-out branch | `wh/0.4.2-watcher-resumes-stalled-runs`, in sync with its origin branch |
| Ahead of `origin/master` | one commit, `a3df9f1 feat: WorkHorse 0.4.2, the watcher resumes stalled runs` |
| Open PR | [muhibm1/workhorse#25](https://github.com/muhibm1/workhorse/pull/25), 0.4.2 |
| Merged since this chat | #24 (0.4.1, counted review fix loop and failure-path evals) |
| `.claude-plugin/plugin.json` version | 0.4.2 (CHANGELOG has a `## 0.4.2 — 2026-10-07` entry) |
| Installed plugin versions in `~/.claude/plugins/cache/workhorse/workhorse/` | up to 0.4.1; 0.4.2 is not installed yet |
| Active WorkHorse change | none (`wh.js status` says "No active change") |

### Uncommitted work in the tree

Modified, not staged:

- `desk/package.json` and `desk/package-lock.json`: adds an override `"global-agent": "4.1.3"`
  under `overrides`, and the lockfile churn that goes with it. Looks like a dependency audit
  fix for Paddock. `desk/package.json` is an ask-first path in CLAUDE.md.

Untracked:

- `docs/decisions.md` (71 lines): five architecture decisions with alternatives and costs.
- `docs/solution-brief.md` (117 lines): solution brief for engineering leaders, dated
  2026-09-30, numbers cited to repo files.
- `docs/superpowers/specs/2026-09-30-solution-briefs-design.md` (71 lines): draft spec for the
  WorkHorse and Studbook solution briefs, part of the AgentOps portfolio programme at
  `~/AgentOps/`.
- `docs/issues-2026-10-01-agentops-increment-1.md` (261 lines): what broke running WorkHorse on
  the first AgentOps change, recorded from observation, fixes are proposals only.
- `desk/studbook-verify.tmp.png`: stray screenshot, predates everything here, safe to delete.

None of these untracked docs are committed anywhere, so they exist only on the old machine
until pushed. Copy or commit them before wiping it.

## Suggested first steps on the new machine

1. Clone `muhibm1/workhorse`, check out `wh/0.4.2-watcher-resumes-stalled-runs`, run
   `npm link` from the repo root so `workhorse` resolves, and `npm test` plus
   `claude plugin validate .` to confirm green.
2. Carry over the uncommitted files above. Decide whether the `global-agent` override and the
   four docs belong in PR #25 or a separate `docs:` commit.
3. Finish 0.4.2: review and merge PR #25, then `claude plugin update workhorse@workhorse` so the
   installed plugin matches. Until then the installed plugin is 0.4.1 and the watcher fix is
   not live.
4. Consider turning the two retro lessons into a change, since both have now bitten AgentOps
   runs too (the 0.4.2 changelog mentions a refused shipper merge leaving runs blocked):
   `/workhorse:run "deploy phase dispatches a merge for an already merged PR -> conductor checks PR state first and skips the shipper when merged"`.
5. The `.pem` file `desk/resources/studbook/supabase-ca.pem` is tracked in git despite the
   global rule denying `*.pem`. It is a CA certificate, not a private key, but decide whether
   it should stay tracked. Studbook is out of use since 2026-09-29.

## Standing constraints to remember

- Cost pause from 2026-09-27: no headless `workhorse` runs without the owner's explicit
  go-ahead. Typing the command yourself counts.
- `/workhorse:run` and `/workhorse:approve` are user-invoked only; Claude cannot call them via
  the Skill tool.
- Do not run `npm ci` in `desk/` casually; it replaces the node_modules junction.
- The user's git email on this machine resolved to `90530587+muhibm1@users.noreply.github.com` in the G4
  approval record. Check `git config user.email` on the new machine before approving a gate,
  since approvals record it.

## Memory files worth re-reading

Auto-memory for this project lives at
`~\.claude\projects\home-dev-WorkHorse\memory\` on the old machine. Copy that
directory too. Key entries: `workhorse-plugin.md`, `workhorse-design-decisions.md`,
`cost-pause.md`, `speed-first.md`, `subagent-dispatch-defaults.md`, `workflow-sizing.md`.
