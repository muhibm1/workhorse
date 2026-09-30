# Spec: status shows gate age

Change id: `2026-09-30-status-shows-gate-age`
Intent: request "workhorse status doesn't say how long a gate has been waiting -> status shows each waiting gate's age, like 'Design waiting 3h', with a test"
Status: draft
Policy skills applied: wh-agent-rules, wh-security-baseline, wh-readable-code, wh-adr, wh-evals

## Summary

`workhorse status` lists every change and says which gate waits on the person, but not for how
long. This change derives each waiting gate's age from the stamp `wh.js present` already writes,
exposes it in the digest, and prints it on the status line. The one decision that matters: the
age is read from `state.presented[gate]`, the same stamp that already decides whether the gate is
waiting (ADR 0001).

All claims below are `confirmed` by reading the files named unless marked otherwise.

## Requirements

| ID | Requirement | Acceptance check | Source |
|----|-------------|------------------|--------|
| R1 | The digest (`wh.js digest`, `digest --all`) SHALL carry `gate_waiting_since` (the ISO stamp of the latest `present` of `blocking_gate`) and `gate_waiting_minutes` (whole minutes from that stamp to now, floored, never below 0) when `blocking_gate` is set, and `null` for both otherwise | A change presented at Design with `presented.G2` set 180 minutes ago reports `gate_waiting_since` equal to that stamp and `gate_waiting_minutes` of 180 or 181 | request: Outcome |
| R2 | `workhorse status` SHALL print the waiting gate's word and age on one line, `Design is waiting on YOU for 3h`; a change with no waiting gate SHALL print its existing line unchanged | The status output for that change matches `Design is waiting on YOU for 3h`; an unpresented change matches `agents working (design)` and contains no ` for ` | request: Outcome |
| R3 | `hooks/scripts/lib.js` SHALL export `fmtAge(minutes)` rendering under 60 as `Nm`; under 1440 as `Nh`, with ` Mm` only when minutes remain; 1440 and over as `Nd`, with ` Nh` only when hours remain, minutes dropped; negative, NaN or missing input renders `0m` | The table in ADR 0002 and evals E3 to E5: 0 -> `0m`, 59 -> `59m`, 60 -> `1h`, 61 -> `1h 1m`, 180 -> `3h`, 1439 -> `23h 59m`, 1440 -> `1d`, 1500 -> `1d 1h`, 3125 -> `2d 4h`, -5 -> `0m` | request: "like 'Design waiting 3h'" |
| R4 | A gate rejected and presented again SHALL measure its age from the latest presentation | After reject then `present G2`, `gate_waiting_minutes` is 0 or 1, not the earlier backdated value | wh.js `presentedAfterPacket` |
| R5 | A `presented` stamp that does not parse SHALL leave the change not waiting (existing behaviour) and both new fields `null`; `wh.js digest` and `workhorse status` SHALL exit 0 | With `presented.G2` set to `not-a-date`, digest exits 0 with `blocking_gate` null and `gate_waiting_minutes` null; status exits 0 | failure mode |
| R6 | A stamp later than now (clock skew between machines that share a repo) SHALL render as 0 minutes, never negative | With `presented.G2` ten minutes ahead, `gate_waiting_minutes` is 0 and the line ends `for 0m` | edge |
| R7 | The README row for `workhorse status` SHALL say the age is shown | `grep -n "how long" README.md` returns the `workhorse status` row | wh-readable-code: README updated with user-visible behaviour |
| R8 | `workhorse status` SHALL spawn no additional child process to compute the age | The status loop in `scripts/workhorse.js` still calls only `digest --all` per repository and `lock status` per change; checked by the reviewer reading the diff | wh-security-baseline: no new process per tick |

Non-functional: R8 is the only one; the outcome names no numeric measure.

## Design

### Architecture

Three small edits in the existing path a person's `workhorse status` already takes.

1. `hooks/scripts/lib.js` (sensitive path, `hooks/**`): `fmtAge(minutes)` added beside
   `fmtMinutes`, exported from `module.exports` (lines 541 to 548 and 648 to 658 today). Pure
   function, no I/O.
2. `scripts/wh.js` (sensitive path, ask first): `buildDigest()` (line 849 onward) already
   computes `humanGate` from `state.gates`, the packet, ship blockers and `presentedAfterPacket`.
   After that it reads `state.presented[humanGate]`, parses it, and adds two fields to the
   returned object: `gate_waiting_since` (the stamp string) and `gate_waiting_minutes`
   (`max(0, floor((now - stamp) / 60000))`). Both `null` when `humanGate` is null or the stamp
   does not parse. No other command changes; `status`, `clock` and `present` are untouched (D3).
3. `scripts/workhorse.js` `status()` (lines 112 to 138): the line
   `${GATE_WORDS[d.blocking_gate]} is waiting on YOU` gains ` for ${fmtAge(d.gate_waiting_minutes)}`
   when `gate_waiting_minutes` is a number. `workhorse.js` requires `lib.js` for `fmtAge` the
   same way `wh.js` does (`require(path.join(__dirname, '..', 'hooks', 'scripts', 'lib.js'))`);
   today `workhorse.js` does not require it (confirmed, lines 1 to 15), so this is one new
   `require` of a file already in the plugin. No dependency is added.
4. `README.md` line 72: the `workhorse status` row says "and for how long".

The watcher (`workhorse watch`), Paddock and the GitHub post do not change; they read the digest
and ignore fields they do not know.

### Data

No table, file format or state key changes. The digest is derived on read. `state.presented` is
already written by `present` (confirmed, wh.js `present` case). Not applicable otherwise.

### Interfaces

Digest object, two new keys:

```
gate_waiting_since:   string | null   ISO 8601, the latest present stamp of blocking_gate
gate_waiting_minutes: number | null   whole minutes, >= 0
```

`fmtAge(minutes: number) -> string`, examples in R3.

`workhorse status` line, when a gate waits: `<Gate> is waiting on YOU for <age>`; the rest of the
block (title, PR URL, clock line) is unchanged. Exit codes unchanged.

### Security and privacy

No auth, database, network, secret or personal data is touched. The stamp is machine-written
under `.git/workhorse/`, never committed, never taken from repository content or a pull request.
Baseline checklist: no new function grants, policies, buckets, env vars or dependencies apply;
child processes in `workhorse.js` still take argument arrays (R8 keeps the count unchanged). The
sensitive paths `hooks/scripts/lib.js` and `scripts/wh.js` are edited; the tier floor makes this
a tier 2 change with an auditor and reviewers.

### Failure modes

| Dependency | Failure | Handling |
|------------|---------|----------|
| `state.presented[gate]` | missing | `humanGate` is already null (`presentedAfterPacket` returns false); fields null; line unchanged |
| `state.presented[gate]` | unparsable string | `presentedAfterPacket` already returns false (NaN comparison); fields null; exit 0 (R5) |
| machine clock | stamp in the future | floored to 0 (R6) |
| `digest --all` | fails for one repository | existing behaviour: `whJson` returns null and the repository is skipped; unchanged |

Nothing is retried; nothing new is logged. The digest is read, not written.

### Observability

Not applicable: the output line is the observation. A wrong age is visible to the person reading
status and reproducible from `wh.js digest`.

## Alternatives considered

| Option | Why not |
|--------|---------|
| Age from the conductor log's `presented` row | second parser for a fact already in state (ADR 0001) |
| Age from `clock.waiting_minutes` | total across gates, wrong after the first approval (ADR 0001) |
| Reuse `fmtMinutes` (`3 h 00 m`) | `72 h 00 m` for a weekend; existing tests and Ship documents pin its form (ADR 0002) |
| Also print the age in `wh.js status` | agents read that command, and the request is about the person's command; deferred (D3) |

## Decisions

- [0001: Measure a waiting gate's age from the `present` stamp](./adr/0001-measure-gate-age-from-the-present-stamp.md)
- [0002: Render a gate's age as `12m`, `3h 12m` or `2d 4h`](./adr/0002-render-age-as-minutes-hours-or-days.md)
- D1 to D6 are in `brief.md`.

## Open questions

None open. Each question became a decision row in the brief with a recommendation.

## Constraint audit

Filled by the constraint auditor. Severity: high blocks G2.

Audit scope: `brief.md`, `spec.md`, `plan.md` and `.workhorse/profile.yml` only, as instructed. Claims the spec makes about existing code (`presentedAfterPacket` NaN handling, `state set` accepting `presented.G2`, `workhorse.js` lines 1 to 15, `buildDigest` line 849) were not re-read by the auditor and are `believed, not verified` here; E6 and E9 pin the existing behaviour, so a wrong claim fails a test rather than shipping.

Audit result: pass

| Severity | Finding | Requirement affected | Resolution |
|----------|---------|----------------------|------------|
| medium | `hooks/tests/run.js` is edited by both tasks and matches the profile's `sensitive_paths` entry `hooks/**` (ask first) and `tier_floor_paths[2]`. Brief D6 names only two ask-first paths (`scripts/wh.js`, `hooks/scripts/lib.js`), so approving D6 does not on its face cover the test runner, and an unattended builder can stall on it (plan risk row 1). Proposed as D7 for `brief.md`. | Plan T1, T2 (R1 to R6) | open |
| low | R8's source cites "wh-security-baseline: no new process per tick"; the baseline contains no such rule. R8 is sound as a design constraint but its citation is wrong; trace it to the brief's Outcome ("from the machine-readable digest the command already reads") or to a design choice instead. | R8 | open |
| low | R8's acceptance check is a reviewer reading the diff, not a test. Plan T2 "Done when" adds a mechanical check (`git diff master...HEAD -- scripts/workhorse.js` shows no new `spawnSync` or `whJson`); the verifier should run that command rather than rely on a read. | R8 | open |
| low | The failure-mode row "`digest --all` fails for one repository" has no eval case. It is existing, unchanged behaviour, so this is a note, not a gap the change introduces. | Failure modes | open |
| low | `workhorse.js` gains a `require` of `hooks/scripts/lib.js`. If `lib.js` does any work at module load (reading the profile, touching `.git/workhorse/`), `workhorse status` now does it too, outside a repository. Builder confirms `lib.js` load is side-effect free, or states what it does. Believed, not verified. | R2, R8 | open |
| low | E2 runs `workhorse status`, which lists every remembered repository (plan risk row 3). The builder confirms the test harness isolates the remembered-repositories list from the owner's real one, so fixtures are not registered in the user's home. Believed isolated by the existing "workhorse remembers the repositories it is used in" check, not verified. | R2 (E2, E6) | open |
| low | Plan's expected baseline "224 passed" comes from the profile note dated 2026-09-27; releases 0.3.14 and 0.4.0 have landed since and likely added checks. The verifier compares against the count measured on `master`, not 224. | Plan Verification plan | open |
| low | `hooks/tests/run.js` also matches the profile `test_globs` (`**/tests/**`); in a fix loop the fixer may not edit it. Tests must be right in the build step, per the plan's test-first order. | Plan T1, T2 | open |

Checks with no finding: security baseline (no table, policy, function, bucket, secret, env var, CI change, admin surface or dependency; child processes unchanged); compliance (`regimes: []`, no personal data added; hipaa, pci-dss, financial not applicable per profile); privacy (no default changed, no subprocessor); deny-listed commands (none planned); traceability (R1 to R6 map to the brief's Outcome and risk table, R7 to "What changes for people"; every brief outcome has a requirement; T1 and T2 cover R1 to R7); testability (R1 to R7 each have a machine-run check).
