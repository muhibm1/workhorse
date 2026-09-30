# Plan: status shows gate age

Change id: `2026-09-30-status-shows-gate-age`
Spec: [spec.md](./spec.md)
Branch: `wh/2026-09-30-status-shows-gate-age`
Worktree: the change branch checkout (one task per wave, no task worktrees needed)

## Approach

Two tasks in two waves. Wave 1 adds the pure formatter `fmtAge` to `hooks/scripts/lib.js` with
its boundary tests, because wave 2 imports it. Wave 2 adds the two digest fields in
`scripts/wh.js`, prints the age in `scripts/workhorse.js`, updates the README row, and writes the
end-to-end tests that drive a real change through `present`, backdate the stamp with
`wh.js state set`, and read `digest` and `workhorse status`. Both tasks edit
`hooks/tests/run.js`, so they cannot share a wave. Commits follow the profile's conventional
style. Sensitive paths: `hooks/scripts/lib.js` (T1), `scripts/wh.js` (T2) and `hooks/tests/run.js`
(both tasks) are `ask first` in the profile; the brief lists them (D6, D7).

## Files

| Action | Path | Purpose |
|--------|------|---------|
| modify | `hooks/scripts/lib.js` | add and export `fmtAge` (sensitive: `hooks/**`) |
| modify | `hooks/tests/run.js` | E3 to E5 in the "clock" block (T1); new "gate age" block with E1, E2, E6 to E9 (T2) (sensitive: `hooks/**`, D7; new blocks only, no existing check changed) |
| modify | `scripts/wh.js` | `buildDigest` adds `gate_waiting_since`, `gate_waiting_minutes` (sensitive: ask first) |
| modify | `scripts/workhorse.js` | `status()` prints ` for <age>`; new `require` of `hooks/scripts/lib.js` |
| modify | `README.md` | `workhorse status` row says the age is shown |

## Tasks

### Task 1: `fmtAge` renders an age as minutes, hours or days (sensitive paths: `hooks/scripts/lib.js`, `hooks/tests/run.js`)

- Requirement(s): R3
- Files: `hooks/scripts/lib.js`, `hooks/tests/run.js`
- Parallel: no (wave 1)
- Steps:
  1. Write failing tests in the "clock" block of `hooks/tests/run.js`, after the check
     "the CLI prints the clock as JSON": E3 `fmtAge renders three hours as 3h`; E4
     `fmtAge minute and hour boundaries` (0, 59, 60, 61, 1439); E5
     `fmtAge drops minutes at day scale and floors bad input to 0m` (1440, 1500, 3125, -5, NaN).
     Expected strings are in spec R3. Also E11 `fmtAge treats missing input as 0m` (undefined,
     null and `''` each return `0m`, no throw).
  2. Run `npm test`; confirm the three checks fail because `L.fmtAge` is not a function.
  3. Implement `fmtAge(minutes)` directly below `fmtMinutes` in `hooks/scripts/lib.js`, per ADR
     0002, and add it to `module.exports` on the line that exports `fmtMinutes`. One doc comment
     line: what it is for and that `fmtMinutes` stays for sums.
  4. Run `npm test`; confirm green: the pass count measured on `master` before step 1 plus the
     new checks (the profile's "224" note predates 0.3.14 and 0.4.0; do not use it as the baseline).
  5. Commit: `feat(lib): fmtAge renders a gate's waiting time as 3h or 2d 4h`
- Done when: `node -e "console.log(require('./hooks/scripts/lib.js').fmtAge(3125))"` prints
  `2d 4h`; `npm test` exits 0; no other export of `lib.js` changed.

### Task 2: the digest and `workhorse status` carry each waiting gate's age (sensitive paths: `scripts/wh.js`, `hooks/tests/run.js`)

- Requirement(s): R1, R2, R4, R5, R6, R7
- Files: `scripts/wh.js`, `scripts/workhorse.js`, `README.md`, `hooks/tests/run.js`
- Parallel: no (wave 2, after T1)
- Steps:
  1. Write failing tests: a new block `console.log('gate age')` appended inside the final block
     of `hooks/tests/run.js` (the one that defines `cli`), after the check "workhorse remembers
     the repositories it is used in". Build `agerepo` under `tmp` the way `ar` is built (git init
     with `-b main`, user config, README, `wh init`, commit, `wh new "gate age" --tier 1`), write
     `brief.md` with a `## Your decision` section, then in order:
     E6 `no age while nothing waits on the human` (digest fields null; `cli(agerepo, 'status')`
     stdout contains `agents working (design)` and not ` for `);
     run `wh present G2`, then `wh state set presented.G2 <now minus 180 minutes, ISO>`;
     E1 `digest carries when the gate was presented and how long ago`;
     E2 `status says how long Design has waited` (stdout matches `Design is waiting on YOU for 3h`);
     `wh approve G2 --reject "age test"` then `wh present G2`;
     E7 `a re-presented gate counts from the new presentation`;
     `wh state set presented.G2 <now plus 10 minutes>`; E8 `a stamp in the future reads as 0m, never negative`;
     `wh state set presented.G2 not-a-date`; E9 `a corrupted stamp leaves the gate not waiting and nothing crashes`;
     E10 `the README status row says the age is shown` (read `README.md`, find the line containing
     `workhorse status`, assert it contains `how long`; fails until step 5).
  2. Run `npm test`; confirm E1, E2, E7, E8 fail because the fields are undefined and the line
     has no ` for `; E6 and E9 may already pass (they pin existing behaviour) and that is fine.
  3. Implement in `scripts/wh.js` `buildDigest`: after `humanGate` is known, read
     `state.presented[humanGate]`, parse it, and add `gate_waiting_since` and
     `gate_waiting_minutes` to the returned object next to `blocking_gate`, null when the gate
     is null or the stamp does not parse. Comment: why the age comes from the present stamp
     (ADR 0001, one line). Before writing it, read how `blocking_gate` is derived and check
     whether it can be non-null with no `presented.<gate>` stamp (for example a gate set by
     `state set` or an older state file); if it can, both new fields are null in that case and
     `status` prints the line without ` for `, and the builder says so in the commit body.
  4. Implement in `scripts/workhorse.js`: require `lib.js` as `L` next to the other constants;
     in `status()` append ` for ${L.fmtAge(d.gate_waiting_minutes)}` to the `who` string when
     `typeof d.gate_waiting_minutes === 'number'`. First read the top level of
     `hooks/scripts/lib.js` and confirm loading it does no work (no profile read, no
     `.git/workhorse/` access, no process spawn); `workhorse status` runs outside any repository.
     If it does work at load, state what in the commit body and require lazily inside `status()`.
  5. Update `README.md` line 72 so the `workhorse status` row ends "what waits on you, and for how long".
  6. Run `npm test`; confirm green. Run `claude plugin validate .`; confirm exit 0.
  7. Commit: `feat(status): each waiting gate shows how long it has waited`
- Done when: `npm test` exits 0 with E1, E2, E6 to E9 listed as `ok`; `grep -n "how long" README.md`
  returns the `workhorse status` row; `git diff master...HEAD -- scripts/workhorse.js` shows no
  new `spawnSync` or `whJson` call (R8); the owner's remembered-repository list (the file the
  "workhorse remembers the repositories it is used in" check writes to) does not contain
  `agerepo` or any other `tmp` fixture after the run.

## Waves

| Wave | Tasks | Files |
|------|-------|-------|
| 1 | T1 | `hooks/scripts/lib.js`, `hooks/tests/run.js` |
| 2 | T2 | `scripts/wh.js`, `scripts/workhorse.js`, `README.md`, `hooks/tests/run.js` |

`build.max_parallel` is 6; each wave has one task.

## Verification plan

- Profile checks: `npm test` (the only test command; expected pass count is the count measured
  on `master` plus 11 new checks, not the "224" in the profile note, which predates two releases)
  and `claude plugin validate .` (lint). Install, typecheck, build, e2e, security_audit are
  empty in the profile and are skipped as such.
- Evals: E1 to E11 as `ok` lines in the `npm test` output, under the blocks "clock" and "gate age".
- R7: `grep -n "how long" README.md`. R8: the verifier runs
  `git diff master...HEAD -- scripts/workhorse.js` and confirms the diff adds no `spawnSync`,
  `whJson` or other child-process call; it is a command, not a read of the diff by eye.
- Evidence the human sees in the Ship document: the `npm test` pass count, the eleven check names,
  and one pasted `workhorse status` line from the test fixture reading `Design is waiting on YOU for 3h`.

## Rollback

- dev (the checkout and master): `git revert` the two commits; nothing persisted changes, the
  digest is derived on read and `state.json` gains no key.
- staging: not applicable (none).
- prod (the user-scope plugin install): reinstall the previous plugin version with
  `claude plugin install workhorse`; no data or state migration either way.

## Risks

| Risk | Likelihood | Impact | Mitigation |
|------|------------|--------|------------|
| The ask-first hook on `scripts/wh.js` or `hooks/scripts/lib.js` stalls an unattended builder | medium | the wave waits for a person | the brief lists both paths (D6); approving Design is the go-ahead; the conductor runs the build attended if the hook still asks |
| E2 asserts `3h` but the minute rolls over during the test | low | flaky test | the stamp is set to exactly now minus 180 minutes and the assertion accepts 180 or 181 minutes; `fmtAge(181)` is `3h 1m`, so E2 matches `for 3h` as a prefix, not the whole token |
| `workhorse status` lists every remembered repository, so E2's output includes other fixtures | low | assertion misses the line | assert on the line text, which names the gate word, not on position |
| A test writes a stamp `state set` refuses | low | test cannot run | confirmed: `state set` refuses only `gates.*` and guards `verification.status`; `presented.G2` is accepted as a string |
| `hooks/scripts/lib.js` does work at module load, so `workhorse status` now does it outside a repository | low | status slows or fails off-repo | T2 step 4: builder reads the top level of `lib.js` before adding the `require`; requires lazily if it does work (believed side-effect free, not verified by the designer) |
| The gate-age tests register `tmp` fixtures in the owner's real remembered-repository list | low | the owner's `workhorse status` lists dead folders | T2 builds `agerepo` the way the existing "remembers the repositories" check builds `ar`, under the same isolated home; "Done when" checks the real list afterwards |
| `blocking_gate` is non-null with no `presented` stamp, so the age is silently absent | low | a waiting gate shows no age | T2 step 3: builder reads how `blocking_gate` is derived and records the answer; if reachable, both fields are null and the line prints without ` for `, as E9 pins |
| The test baseline of 224 is stale, so a pass-count comparison misleads | medium | verifier reports a wrong delta | measure the count on `master` first; the plan no longer cites 224 as the expected baseline |
| `hooks/tests/run.js` matches `test_globs`, so a fix loop cannot edit it | low | a wrong test cannot be corrected by the fixer | tests are written and made green in the build step, test-first, per each task's steps |
