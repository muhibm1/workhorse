# 0001: Measure a waiting gate's age from the `present` stamp

Date: 2026-09-30
Status: proposed
Change: 2026-09-30-status-shows-gate-age

## Context

R1 needs one moment from which a gate's waiting time is counted. `scripts/wh.js present <G>`
already writes `state.presented[G]` (an ISO stamp) the instant the conductor hands the packet to
the human, and `presentedAfterPacket()` in the same file already treats that stamp as the truth
about whether the gate is waiting at all (confirmed, `scripts/wh.js` `present` case and
`presentedAfterPacket`). The conductor log holds a `G2 Design presented` row at the same moment,
and the clock (`hooks/scripts/lib.js computeClock`) already sums waiting minutes, but across the
whole change, not per gate.

## Decision

`buildDigest()` in `scripts/wh.js` computes `gate_waiting_since` and `gate_waiting_minutes` from
`state.presented[blocking_gate]` whenever `blocking_gate` is set. The same stamp that decides
"is this gate waiting" decides "since when". Nothing new is written to state; the age is derived
on every read.

## Alternatives

| Option | Why not |
|--------|---------|
| Parse the `presented` row out of `conductor-log.md` | A second parser for a fact already in state; the log row is prose and the stamp is the source it was written from |
| Reuse `clock.waiting_minutes` from `computeClock` | It is the change's total waiting time across every gate; after one approval it overstates the current gate's age |
| Stamp a new `waiting_since` field at `present` | Duplicates `presented[G]` and needs a migration path for the change already in flight |

## Consequences

Easier: the age is always consistent with `waiting_on`, because both come from one stamp; a gate
rejected and presented again counts from the new presentation with no extra logic. Harder: an
old change whose state predates `present` (before 0.3.3) has no stamp, but such a change is also
never shown as waiting, so the age is null with the gate. Revisit if a gate ever becomes waiting
by a path other than `present`.
