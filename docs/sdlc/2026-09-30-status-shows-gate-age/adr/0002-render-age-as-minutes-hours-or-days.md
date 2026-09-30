# 0002: Render a gate's age as `12m`, `3h 12m` or `2d 4h`

Date: 2026-09-30
Status: proposed
Change: 2026-09-30-status-shows-gate-age

## Context

R3 fixes the wording of the age. `hooks/scripts/lib.js` already has `fmtMinutes`, which renders
`3 h 00 m` and is used by the clock line (`formatClock`) and the Ship document (confirmed). The
request asks for `Design waiting 3h`. A gate left over a weekend waits days; `fmtMinutes` would
print `72 h 00 m`.

## Decision

Add `fmtAge(minutes)` beside `fmtMinutes` in `hooks/scripts/lib.js`: under an hour `Nm`; under a
day `Nh` with ` Mm` appended only when the minutes are not zero; a day or more `Nd` with ` Nh`
appended only when the hours are not zero, minutes dropped. Negative or unparsable input renders
`0m`. `fmtMinutes` is unchanged so the clock line and the Ship document keep their form.

## Alternatives

| Option | Why not |
|--------|---------|
| Reuse `fmtMinutes` | `72 h 00 m` hides the day count, and the zero minutes are noise on a line a person reads once a morning |
| Change `fmtMinutes` itself | Its output is asserted in existing tests and quoted in every Ship document; changing it re-labels history |
| Format in `scripts/workhorse.js` only | Leaves `wh.js` unable to print the same age later without duplicating the rule; one formatter in `lib.js` is the repo's pattern |

## Consequences

Easier: one rule, unit-tested at its boundaries, usable by both CLIs. Harder: two time formats
exist in the codebase (`3 h 00 m` for sums, `3h` for an age); the distinction is that an age is one
number a person glances at, a sum sits in a line of several. Revisit if a third format appears.
