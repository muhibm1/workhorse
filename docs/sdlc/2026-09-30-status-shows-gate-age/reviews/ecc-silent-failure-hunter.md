Verdict: 2 findings (0 critical, 0 high, 0 medium, 2 low)

| Severity | File:line | Finding | Failure scenario | Fix |
|---|---|---|---|---|
| low | scripts/wh.js (buildDigest, humanGate) and hooks/tests/run.js "corrupted stamp" check | An unparseable presented.G2 stamp makes the digest drop the gate (blocking_gate null); the new test asserts this as correct (believed, not verified beyond the diff) | state.presented.G2 = "not-a-date" -> `workhorse status` prints "agents working (design)" with "stopped: workhorse resume"; the human is never told a gate waits and no warning appears | scripts/wh.js: when a presented stamp exists but does not parse, keep the gate blocking and set gate_waiting_minutes null (status then prints no age), or add a `stamp_corrupt` field that status prints |
| low | hooks/scripts/lib.js:540 fmtAge | Negative, NaN and non-numeric input all render "0m" with no signal | Clock skew (stamp 10 min in the future) or bad input -> status says "waiting on YOU for 0m" for a gate that may have waited long; looks fresh | none proposed (deliberate, covered by tests); optionally show "?" for non-finite input |

Findings outside scope: none
Not verified: I did not run the test suite or execute status against a real repo; findings come from reading the diff only.
