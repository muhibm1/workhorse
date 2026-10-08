# Solution briefs for WorkHorse and Studbook

Status: draft for owner review, 2026-09-30. Part of the portfolio programme whose main project is
AgentOps (`~/AgentOps/docs/superpowers/specs/2026-09-29-agentops-design.md`).

## 1. Why this exists

A deployed engineer's most visible output is not code. It is the document a customer's CTO reads
to decide whether to trust the system: what problem it solves, how it is built, what was decided
and why, what it costs, how it fails, and what the customer's team has to own afterwards.
WorkHorse and Studbook are my strongest projects and neither has that document. Their READMEs are
written for someone who has already decided to install them.

## 2. Deliverables, per project

1. `docs/solution-brief.md`: two pages, written for a CTO or engineering lead, in the structure in
   section 3.
2. `docs/decisions.md`: the five architecture decisions that matter most, each with the
   alternative, why it lost, and what it cost. Drawn from the existing design documents and ADRs,
   never invented.
3. A LinkedIn post adapted from the brief, with one diagram and one table of measured results.
4. A three-minute demo script for you to record.

## 3. Brief structure

1. The problem, as the buyer would state it, in two sentences.
2. What the system does, in one paragraph and one diagram.
3. Results, as measured, with the date and source of every number.
4. How it works: the three or four ideas that make it trustworthy.
5. Decisions and their costs (a short table linking `decisions.md`).
6. Limits: what it does not do, where it has failed, and what the reader's team would need to own.
7. How to try it in ten minutes.

## 4. Sources of record

Every number comes from a file in the project's own repository at a cited commit:

- WorkHorse: `docs/superpowers/specs/2026-09-19-two-gates-design.md` section 1 (measured waiting
  and working hours across three changes), `docs/STATUS.md` (versions, what changed, open items),
  `CHANGELOG.md`, the change folders under each client repository's `docs/sdlc/`, and the run
  statistics already approved for the portfolio site ("5 of 5" runs, 40 findings).
- Studbook: the held-out results table and ablations in `README.md`, `docs/m4-evaluation-and-scale.md`,
  `docs/gold-set-audit.md`, `docs/retrieval-ceiling.md`, and `eval/compare.py` output.

Nothing about run 1 of WorkHorse names the client or calls it my own project, per the standing
portfolio rule.

## 5. Voice

Professional, confident, first person, specific. The brief sounds like an engineer who has run the
system and is accountable for it. Enthusiasm shows in the problems chosen and the care in the
measurements, not in adjectives.

## 6. Open questions for the owner

1. Paddock. The portfolio site rule from 2026-09-28 is to present Paddock as a current desktop
   app, never as retired. WorkHorse's STATUS.md, updated 2026-09-29, says Paddock is retired as of
   0.3.14 and your AgentOps plan cites "a real retirement decision (Paddock) backed by run data" as
   a strength. Which framing do the briefs use? I recommend the retirement as a decision made from
   run data, since it is the more impressive story and the repository already says it.
2. Studbook is listed as out of use. I recommend framing it as the reference implementation and
   evaluation harness, with its results as recorded, rather than implying daily use.
3. WorkHorse 0.4.0 (terminal CLI, gates answered on the pull request) is confirmed end to end on a
   throwaway pull request but not yet on a real change. The brief describes it as released and
   says plainly that its first real change is pending, unless that has happened by the time it is
   written.

## 7. Timing

One day per project. The WorkHorse brief first, because it is the strongest story and the AgentOps
README compares against it.
