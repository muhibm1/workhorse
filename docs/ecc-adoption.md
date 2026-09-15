# ECC adoption: what WorkHorse took, what it left, and why

Decision record, 2026-09-14. ECC = [affaan-m/ECC](https://github.com/affaan-m/ECC), v2.2.1,
commit `8321021`, MIT. The proposal on the table was to install ECC system-wide and replace
the WorkHorse agents with ECC's.

## Summary

ECC and WorkHorse sit at different layers. ECC is a broad productivity layer for one engineer
working interactively: 68 agents, 292 skills, 94 commands, language rule packs, hygiene hooks,
and observation-based learning. WorkHorse is a delivery governance pipeline: risk tiers, human
gates, approvals pinned to a commit and a sha256, compliance skills, client profiles, handover,
and a headless mode that Paddock drives. ECC has no equivalent of the governance layer, and
WorkHorse had no equivalent of ECC's language depth. So WorkHorse vendors the parts of ECC that
make its agents better and keeps its own orchestration.

Replacing WorkHorse's agents was rejected: ECC's agents do not write gate packets, do not use
`wh.js`, and do not produce the artifacts Paddock watches. Swapping them in would remove the
part of the system that is specific to this use case and keep the part that is generic.

## Phase 0: review before install

Confirmed by reading the code at `8321021`, not by the README:

| Check | Result |
|---|---|
| Hook data egress | None found. The one network call in the hooks goes to `127.0.0.1` (a local plan-canvas server). The URLs in other hooks are comments or constants. The sponsor and registry modules run from the CLI only, never from a hook. |
| Hook load | About 25 hooks. Several fire on every tool call; the async `observe` hook took 2.8 s when timed in isolation. |
| Hook conflicts | `gateguard-fact-force` demands written facts before the first edit and before commands. A headless WorkHorse builder has nobody to answer, so this would stall runs. |
| Install footprint | A whole-plugin install adds 292 skill descriptions to every session's skill listing and 94 slash commands. The listing is capped at a fraction of the context window, so descriptions get truncated for every other plugin too. |
| AgentShield (ECC's config scanner, npm `ecc-agentshield@1.6.0`) | The package tarball was downloaded and read before running: plain `scan` is local; network only with `--supply-chain-online`, `--webhook`, `--opus`, `--injection`. |

AgentShield run against WorkHorse before this change: grade B, 52 critical / 79 high findings.
Every critical was one template gap repeated across 26 agents: no explicit prompt-injection
defence in the agent file. One finding was a real least-privilege issue: `wh-verifier` had
both `Bash` and `Agent`, so a compromised verifier could spawn any agent. Against `~/.claude`
the grade was F, almost entirely from third-party plugin caches (believed, not verified: the
"hardcoded Azure key" hits in a plugin's `package-lock.json` look like false positives).

AgentShield after this change, same flags: **0 critical, 1 high, 10 medium** (from 52 / 79 /
162). The residue is accepted, each for a stated reason:

| Finding | Why it stays |
|---|---|
| high: `wh-tracker-sync` has no `tools:` list | Deliberate. The Notion connector's tool prefix differs per surface (`mcp__claude_ai_Notion__`, `mcp__<uuid>__`, `mcp__plugin_Notion_notion__`), so the agent inherits tools and picks Notion by suffix. Edit, Write, MultiEdit, NotebookEdit and Agent stay disallowed. |
| medium: conductor has `Agent` and `Bash` | Inherent to an orchestrator: it must dispatch agents and run `wh.js`. Its dispatch is constrained to exact namespaced agent names by its own contract, and the hooks, not the conductor, enforce gates. |
| medium x8: agent file over 5,000 characters | A size heuristic, not a vulnerability. The conductor and the vendored ECC reviewers are long because they carry real procedure. |

## What was adopted

1. **Language rule packs** (common, TypeScript, Python, React, web), verbatim, under
   `vendor/ecc/rules/`. The new `wh-language-standards` skill, preloaded by the builder,
   express dev, fixer, readability reviewer, and simplifier, tells them which packs match
   `profile.stack`. Client conventions still win on conflict.
2. **Nine agents**, renamed `ecc-*`, bodies verbatim plus a WorkHorse adapter section:
   language reviewers (TypeScript, Python, React, FastAPI), database, RAG pipeline, silent
   failure hunter, and PR test analyser join Review by stack and tier (at most four per change,
   none at tier 0); the build-error resolver takes build and type failures in the Verify fix
   loop while `wh-fixer` keeps test failures.
3. **AgentShield** inside `wh-security-reviewer`, pinned, local-only flags, whenever a change
   touches agent or harness configuration.
4. **Prompt defence**: an "Untrusted content" rule in `wh-agent-rules` (the operative one) and
   ECC's baseline wording in every agent file, so scanners see it too.
5. **Least privilege for the verifier**: `Agent` removed. The conductor now dispatches the eval
   runner before the verifier.
6. **Instinct format for learning**: `wh-retro-learner` records lessons as atomic,
   confidence-scored, evidence-backed instinct files under `.workhorse/instincts/`, and only
   instincts at 0.7 or higher are promoted into `CLAUDE.md`.

## What was left, and why

| Left out | Why |
|---|---|
| ECC hooks | WorkHorse has its own deterministic hooks for its workflow; ECC's per-call hooks add latency, and the fact-forcing gate stalls headless runs. |
| The other 59 agents | Either WorkHorse has an equivalent (planner, architect, code, security, TDD, simplifier) or the domain is outside the use case (networking, marketing, homelab, mobile). |
| The 292 skills and 94 commands | Context cost on every session for little gain. Pull individual skills when a real change needs them. |
| continuous-learning-v2's observation hooks | They record every prompt and tool call, which in client work means client code, and they evolve instincts without human review. WorkHorse keeps the format and drops the capture: every instinct is a reviewed file that passes G4. |

## How to extend

Pull more from ECC the same way: add the name to the vendoring script, re-run it against a
fresh checkout, read the diff, and add a test. Never install the whole plugin into a client
repo, and never enable third-party hooks there without reading them first.
