# WorkHorse

An agentic software delivery lifecycle for forward-deployed engineering, packaged as a the
harness plugin. Give it a problem and an outcome inside any client repository. Agents discover,
specify, plan, build, verify, review, ship, and hand over. You approve at gates that scale
with risk. Every step leaves a committed artifact.

Built on Anthropic's AI-native SDLC playbook, the FDE audit-evals-deploy loop, and a set of
security rules distilled from a real production audit.

## The loop

```
 Discover ─► Intent ─► Spec ─► Plan ─► Build ─► Verify ─► Review ─► Deploy ─► Handover
   G0         G1       G2      G3    (agents,   (agents,    G4        G5     (client)
                                     parallel)   loops)                        │
                                        Maintain ◄─────────────────────────────┘
```

| Tier | Typical change | You approve at |
|------|----------------|----------------|
| 0 | docs, tests, pure refactor | G4 only: one review packet |
| 1 | feature, no schema/auth/payment/PII | G2, G4 |
| 2 | schema, auth, payments, PII, infra, integrations | G1 to G5, security review mandatory |
| 3 | regulated or irreversible | all gates, you run the production deploy |

Every gate shows the same six-section packet: TL;DR, decisions requested, evidence table
(every command, exit code, output path, labelled confirmed or believed), findings, risk
register, diff tour ordered by risk, checklist. Approve with one command; the approval is
committed with who, when, and the artifact hash.

## Install (global, on your machine)

```bash
claude plugin marketplace add ~/WorkHorse
```

```bash
claude plugin install workhorse@workhorse --scope user
```

Or for a one-off session without installing: `claude --plugin-dir ~/WorkHorse`.

Requires Node 18+ on PATH (the hooks and CLI are dependency-free Node scripts).

## Quickstart on a client repo

1. `cd` into the client repo and start the harness.
2. `/workhorse:onboard fintech, UK users, AWS eu-west-2` writes `.workhorse/profile.yml`, a
   codebase map, constraints, and a one-page `CLAUDE.md`. Check the protected paths and
   commands it found; commit.
3. `/workhorse:run "support cannot see why a payout failed -> payout failures show a reason code in the admin UI and are searchable"`.
   The conductor runs Intent and Risk classification, then stops at the first gate your tier
   requires with a packet.
4. `/workhorse:approve G2` (or `--reject "notes"`). Then `/workhorse:run` again. Repeat until
   G4, where you get a PR and the full packet.
5. `/workhorse:ship` after G4. `/workhorse:handover` at the end of the engagement.

Try it on the sample first: `cd examples/hello-service`, then step 2 with "internal tool, no
users, no compliance", then `/workhorse:run "there is no way to check the service is up -> GET /health returns 200 with uptime seconds"`.

## Commands

| Command | Does |
|---------|------|
| `/workhorse:onboard [context]` | Discover phase. Profile, map, constraints, CLAUDE.md. G0. |
| `/workhorse:run ["problem -> outcome"]` | Whole pipeline to the next required gate, or resume. |
| `/workhorse:approve <G> [--reject] [notes]` | Record your decision. The only human step. |
| `/workhorse:status [--metrics]` | Where the active change is and what blocks it. |
| `/workhorse:intent`, `spec`, `plan`, `build`, `verify`, `review`, `ship` | One phase at a time. |
| `/workhorse:handover [--export-workflow]` | Client docs pack; optionally vendor the plugin into the repo. |
| `/workhorse:retro [--incident "..."]` | Learn from a change, or triage an incident into a new intent. |
| `/workhorse:sync [--all\|--setup]` | Mirror changes into a Notion tracker so others can see what needs you. |

## What enforces what

Prompts can be argued with. Hooks cannot. `hooks/hooks.json` wires eight Node scripts:

| Hook | Refuses |
|------|---------|
| protect-paths | edits to `protected_paths`; asks on `sensitive_paths`; any direct edit of `approvals.md` |
| test-lock | edits to test files while the fixer is working |
| worktree-fence | source edits in the main checkout while a change is being built in a worktree |
| bash-guard | force-push, push to the default branch, destructive resets, profile deny list; asks on the ask list; production deploy without G5; any approval attempted from a subagent |
| gate-guard | writing the next phase's artifact, pushing, or merging while a required gate is unapproved; direct edits of `state.json` |
| format-on-write | nothing; runs the profile's formatter |
| verify-before-stop | the builder, fixer, or verifier finishing without a green `verification.md` |
| session-context | nothing; injects profile and change state at session start |

Run the hook tests: `node hooks/tests/run.js`.

## Agents

Thirty-five single-purpose agents in `agents/`: twenty-six WorkHorse agents and nine vendored
from ECC (`ecc-*`). The conductor sequences them, runs Build as waves of up to
`build.max_parallel` (default 10) builders in isolated worktrees, and stops at gates. The
verifier cannot edit or spawn agents. The fixer cannot touch tests. Reviewers cannot fix. No
agent can approve.

| Phase | Agents |
|-------|--------|
| Discover | discovery-analyst, compliance-mapper |
| Intent | intent-writer, risk-classifier |
| Spec | spec-architect, constraint-auditor, eval-designer |
| Plan | implementation-planner |
| Build | builder (xN), readability-reviewer, simplifier |
| Verify | eval-runner, verifier, fixer, ecc-build-error-resolver |
| Review | bug-reviewer, conformance-reviewer, security-reviewer, adoption-reviewer, packet-compiler, plus ECC specialists by stack (typescript, python, react, fastapi, database, rag-pipeline, silent-failure-hunter, pr-test-analyzer) |
| Deploy | release-engineer |
| Handover | handover-writer |
| Maintain | incident-triager, retro-learner |
| Any | tracker-sync (Notion mirror) |
| All | conductor |
| Tier 0 | express-dev (spec, plan, and build in one session) |

### What comes from ECC

WorkHorse vendors a reviewed subset of [ECC](https://github.com/affaan-m/ECC) (MIT), listed
with the upstream commit in `vendor/ecc/VENDORED.md`: nine agents and the common, TypeScript,
Python, React, and web rule packs, which builders and reviewers read through the
`wh-language-standards` skill. ECC's hooks, the other agents and skills, and its observation-
based learning are deliberately not vendored; the reasons are in
`docs/ecc-adoption.md`.

## Policy skills

Loaded by the agents that need them: `wh-security-baseline`, `wh-compliance-{gdpr, hipaa,
pci-dss, soc2, financial}`, `wh-readable-code`, `wh-review-packet`, `wh-evals`, `wh-adr`,
`wh-handover`, `wh-agent-rules`. Add a client-specific policy by dropping a skill into the
client's `.claude/skills/` and naming it in the profile's `notes`.

## Layout inside a client repo

```
.workhorse/profile.yml      the client profile (hooks and agents read it)
.git/workhorse/             control state, never committed: the active change and each
                            change's state.json, shared by every worktree
docs/sdlc/<change-id>/      intent, spec, evals, plan, verification, review-packet,
                            release, approvals, retro, adr/, verify-logs/
docs/handover/              written at handover
CLAUDE.md                   one page, client-facing
```

## CI and headless

`ci/claude-review.yml` runs the security and conformance reviewers on every PR and fails the
build if the API key secret is missing rather than silently passing. `ci/incident-triage.sh`
shows the Maintain loop: an alert on stdin becomes a read-only diagnosis and a new intent that
enters the pipeline through normal gates.

## Running headless

In an interactive session the profile's commands run after your normal permission prompts. In
`claude -p` there is nobody to answer a prompt, so pass the tools the pipeline needs or the
verifier will be refused and will report the gap instead of green:

```bash
claude -p '/workhorse:run' --permission-mode acceptEdits --allowedTools "Agent,Read,Glob,Grep,Edit,Write,Bash(node *),Bash(npm *),Bash(git *)"
```

Match the `Bash(...)` entries to the commands in `.workhorse/profile.yml`. The CI example in
`ci/claude-review.yml` does this for the reviewers.

## Notion tracker (optional)

`/workhorse:sync --setup` creates a Notion database for the client, then set `tracker.provider:
notion` and `tracker.database: <id>` in the profile. From then on the conductor mirrors each
change: one row with status, tier, verification, branch, PR, and a `Waiting On` column.

Filter that database to `Waiting On` starting with "You" and you get the cross-client view of
every gate blocked on your approval, readable from a phone. The mirror is one-way and
non-blocking: nothing in Notion can approve a gate or change a change, and a tracker outage
never stalls the pipeline.

## Design

The full design, including the gate contract, state machine, tier rules, and agent table, is in
`docs/superpowers/specs/2026-09-06-workhorse-sdlc-design.md`.

## Known limits (v1)

- Approvals are trusted to come from the human because the approve skill is user-invocable
  only and the bash-guard refuses it from subagents. The main session model could still be
  talked into running it; treat `approvals.md` history in git as the audit source.
- Tracker sync (Jira, Notion, Linear) is a documented hook point, not implemented.
- Worktree paths are whatever the platform gives `isolation: worktree`; the fence hook is
  lenient when the path is unknown.
