# Evals: status shows gate age

Change id: `2026-09-30-status-shows-gate-age`
Spec: [spec.md](./spec.md)

Every case is a `check(...)` in `hooks/tests/run.js`, run by `npm test`. The runner has no
per-file mode (profile `commands.test_file`), so "Implemented as" names the block and the check
name. Time is controlled by writing `presented.G2` through `wh.js state set`, so no case sleeps.

## Targets

| Category | Target | Rationale |
|----------|--------|-----------|
| Golden | 100% pass | The age appears, with the right number, from the right stamp |
| Edge | 100% pass | Format boundaries, rework, clock skew, nothing waiting |
| Failure | 100% correct handling | A corrupted stamp never crashes status |
| Adversarial | not applicable | The stamp is machine-written under `.git/workhorse/`, never read from repository content, a PR or user input; E9 covers a corrupted value |
| Non-functional | not applicable | The outcome names no numeric measure; R8 is a review check named in plan.md |

## Cases

| ID | Category | Given | When | Then | Maps to requirement | Implemented as |
|----|----------|-------|------|------|---------------------|----------------|
| E1 | golden | a tier 1 change in a fresh repo, brief complete, `present G2` run, then `state set presented.G2` to now minus 180 minutes | `wh.js digest` | `blocking_gate` is `G2`, `gate_waiting_since` equals the stamp written, `gate_waiting_minutes` is 180 or 181 | R1 | run.js, block "gate age", check "digest carries when the gate was presented and how long ago" |
| E2 | golden | same state as E1 | `workhorse status` (the `cli` helper, HOME under the temp dir) | exit 0 and stdout contains `Design is waiting on YOU for 3h` | R2 | run.js, block "gate age", check "status says how long Design has waited" |
| E3 | golden | `L.fmtAge` | called with 180 | returns `3h` | R3 | run.js, block "clock", check "fmtAge renders three hours as 3h" |
| E4 | edge | `L.fmtAge` | called with 0, 59, 60, 61, 1439 | returns `0m`, `59m`, `1h`, `1h 1m`, `23h 59m` | R3 | run.js, block "clock", check "fmtAge minute and hour boundaries" |
| E5 | edge | `L.fmtAge` | called with 1440, 1500, 3125, -5, NaN | returns `1d`, `1d 1h`, `2d 4h`, `0m`, `0m` | R3 | run.js, block "clock", check "fmtAge drops minutes at day scale and floors bad input to 0m" |
| E6 | edge | the E1 change before `present G2` (brief complete, not presented) | `wh.js digest` and `workhorse status` | `gate_waiting_since` and `gate_waiting_minutes` are null; status line contains `agents working (design)` and no ` for ` | R1, R2 | run.js, block "gate age", check "no age while nothing waits on the human" |
| E7 | edge | the E1 change, then `approve G2 --reject "notes"`, then `present G2` again | `wh.js digest` | `gate_waiting_minutes` is 0 or 1 and `gate_waiting_since` is newer than the E1 stamp | R4 | run.js, block "gate age", check "a re-presented gate counts from the new presentation" |
| E8 | edge | `state set presented.G2` to now plus 10 minutes | `wh.js digest` and `workhorse status` | `gate_waiting_minutes` is 0; status line ends `for 0m` | R6 | run.js, block "gate age", check "a stamp in the future reads as 0m, never negative" |
| E9 | failure | `state set presented.G2 not-a-date` | `wh.js digest` and `workhorse status` | both exit 0; `blocking_gate` null, `gate_waiting_minutes` null, `gate_waiting_since` null; status prints `agents working (design)` | R5 | run.js, block "gate age", check "a corrupted stamp leaves the gate not waiting and nothing crashes" |
| E10 | golden | the repository `README.md` | the test reads it and finds the line holding `workhorse status` | that line contains `how long` | R7 | run.js, block "gate age", check "the README status row says the age is shown" |
| E11 | edge | `L.fmtAge` | called with undefined, null and an empty string | returns `0m` for each and does not throw | R3 | run.js, block "clock", check "fmtAge treats missing input as 0m" |

R8 (no extra child process) has no eval case: it is checked by the reviewer reading the
`status()` diff.

## Non-functional

Not applicable: the outcome names no numeric measure.

## Failure taxonomy

| Class | Description | Detection | Example |
|-------|-------------|-----------|---------|
| wrong result | the age differs from now minus the present stamp by more than a minute | E1, E7; a person compares the line with the PR comment time | age counts from the first presentation after a rework |
| missing result | a gate waits but the line shows no age | E2; `workhorse status` read by the owner | `gate_waiting_minutes` null while `blocking_gate` is set |
| crash | `digest` or `status` exits non-zero on a bad stamp | E9; the watcher's tick log (`~/.workhorse/watch.log`) goes quiet | `Date.parse` result used without a NaN check |
| misleading format | the number is right and the text is not (`72h`, `-3m`, `1h 0m`) | E4, E5, E8 | zero remainder printed |
