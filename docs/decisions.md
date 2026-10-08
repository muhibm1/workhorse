# WorkHorse: the decisions that matter

Five architecture decisions, each with the alternative, why it lost, and what it cost. Sources are
the design documents and changelog in this repository. Per-change decisions live in each change's
`docs/sdlc/<change>/adr/` folder.

## 1. Enforce the rules with hooks, not prompts

**Decision.** Nine Node scripts run on the harness's hook points and refuse actions outright:
protected edits, test edits during a fix, pushes and merges past an unapproved gate, agent
approvals, oversized documents, and a Ship document with a blocker.

**Alternative.** State the rules in each agent's prompt. It lost because a prompt can be argued
with and a hook cannot. I also declined the hooks from the ECC agent collection, because they added
latency and their fact-forcing gate stalled headless runs (`docs/ecc-adoption.md`).

**Cost.** Hooks fail open with a warning, so a broken hook degrades to advice; only the gate hook
fails closed. The worktree fence is lenient when the platform gives an unexpected path.

## 2. Two human gates instead of five

**Decision.** A person approves a Design document before code and a Ship document before merge.
Deploy to production is a third gate only for regulated or irreversible changes.

**Alternative.** One gate per phase, five in total, which was the first version. It lost on
measurement: across three real changes a person waited 41, 10 and 17 hours on runs whose agents
worked 7 hours, 3 hours 40 minutes and 1 hour 45 minutes, and every approval note on the smallest
change read "none" (`docs/superpowers/specs/2026-09-19-two-gates-design.md`).

**Cost.** Approving a document accepts every recommendation in it unless the approver says
otherwise, so the documents have to be good enough to read in five minutes. Agents never stop to
ask, which means they make reversible calls on their own and record them.

## 3. Keep control state in the git common directory

**Decision.** The active change and each change's state live in `.git/workhorse/`, shared by every
worktree and never committed. Only the documents are committed.

**Alternative.** Tracked state files in the repository. It lost because a branch checkout rewrote
them and silently disabled every hook that reads state (`docs/superpowers/specs/2026-09-06-workhorse-sdlc-design.md`).

**Cost.** Run state is local to the clone. The committed documents and approvals are the durable
record; the live state is not.

## 4. Mechanical work in deterministic code, judgment in agents

**Decision.** Merging build waves, running checks, holding the run lock and recording blocks are
commands in a Node CLI (`wh.js`). Agents only design, build, review and decide.

**Alternative.** Let the conductor and verifier agents do that work, as they did through 0.3.11. It
lost on a measured run: the conductor spent 137 of 250 attributable minutes folding, re-probing and
deciding, and the verifier spent 57 minutes on a suite that runs in 45 seconds, about $60 at list
price (`CHANGELOG.md`, 0.3.12).

**Cost.** More code to maintain and test. I also reversed one part of this change: moving the
designer to a cheaper model saved money and cost quality, and since the design decides everything
downstream, it went back to the strongest model in 0.3.14.

## 5. Gates live where the person already is: the pull request

**Decision.** From 0.4.0, each gate is posted to the change's pull request and answered with
`/approve` or `/reject`, from a terminal or a phone. Only listed approvers count, a decision made
before the gate was presented does not count, and a background watcher resumes the run within a
minute without calling a model.

**Alternative.** A dedicated application as the place gates are opened. It lost because it added a
surface to install, update and trust, while the pull request is already where an engineering team
reviews work.

**Cost.** Gates depend on GitHub and its CLI, and the watcher needs a machine that is awake. The
optional phone push service is a third party and a new subprocessor.
