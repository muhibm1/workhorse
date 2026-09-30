# Bug review: 2026-09-30-status-shows-gate-age

Verdict: 0 findings (0 critical, 0 high, 0 medium, 0 low)

| Severity | File:line | Finding | Failure scenario | Fix |
|---|---|---|---|---|

Traced (all confirmed by reading the code):
- `hooks/scripts/lib.js:541` `fmtAge`: 0, 59, 60, 61, 1439, 1440, 1500, 3125 match R3; negative, NaN, Infinity, undefined, null and '' reach `0m` (`Number` then `Math.floor`, then `Number.isFinite` guard). Fractional input floors. No boundary gap between the `< 60`, `< 1440` and day branches.
- `scripts/wh.js:877-880` `buildDigest`: `humanGate` is non-null only when `presentedAfterPacket` (wh.js:699) returned true, which requires `state.presented[gate]` to be truthy and `Date.parse` of it to be a number >= the rejection stamp (NaN compares false). So `state.presented[humanGate]` cannot throw and is a parsable stamp; the extra `Number.isFinite` guard is redundant but harmless. Future stamps clamp to 0 via `Math.max`. Fields are null whenever `humanGate` is null (R1, R5, R6).
- Re-presentation: `present` (wh.js:505) always overwrites `state.presented[g]` with `L.nowIso()` (UTC ISO with `Z`), so a rejected and re-presented gate counts from the new stamp (R4).
- `scripts/workhorse.js:7,125-126`: `lib.js` required by a path relative to the file (same layout `wh.js:41` uses), so it resolves under `npm link`. The ` for <age>` suffix only renders when `blocking_gate` is set, since `who` ignores `waitedFor` otherwise. No new child process per change (R8): still `digest --all` per repo and `lock status` per change.
- Tests in `hooks/tests/run.js:436-442,1004-1053` cover R1 to R7 (E1 to E9). The `< 183` tolerance in the E1 check allows for slow runners without masking a wrong base stamp.

Findings outside scope: none
Not verified:
- Did not run `npm test`. The verifier owns that (`verification.md`, `verify-logs/`); this review read code only.
- Stamps written by hand without a zone (for example `state set presented.G2 2026-09-30T10:00:00`) parse as local time in both `presentedAfterPacket` and the new age code, so they agree with each other. Only `present` writes the stamp in normal use, and it always adds `Z`. Believed, not verified, that no other writer exists; this is existing behaviour, not a regression.
- Files read: the diff of `hooks/scripts/lib.js`, `hooks/tests/run.js`, `scripts/wh.js`, `scripts/workhorse.js`, `README.md`; wh.js 486-512, 695-720, 830-915; workhorse.js 1-48, 110-135; spec.md and evals.md (grep only).
