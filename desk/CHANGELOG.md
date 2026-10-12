# Paddock changelog

Releases of Paddock, the WorkHorse desktop app, newest first. Each entry is built from the commits
it shipped (listed by hash) and names the release it follows and what that release did. Plugin
releases are in the repository's root `CHANGELOG.md`; each Paddock build bundles the plugin version
it names.

## 0.5.1 — 2026-09-26

Follows 0.5.0 (the two-gates screens).

- Bundles WorkHorse 0.3.10 instead of 0.3.1. 0.5.0's bundled copy predated the fixes that let a
  headless run edit a sensitive path its approved Design names (0.3.4) and the other 0.3.x fixes,
  so a Paddock that fell back to its bundled plugin refused those edits and the run stopped in
  Build (studbook, 2026-09-26). No app code changed.

## 0.5.0 — 2026-09-19

Follows 0.4.9 (Refresh reads changelogs).

- The two-gates model (plugin 0.3.0): gates are named Design, Ship and Deploy wherever one is
  shown, with the id beside the name ("Ship (G4)"), and the Run screen's ring has ten stations:
  Onboard, Design, the Design gate, Build, Verify, Review, the Ship gate, Deploy, the Deploy gate,
  Retro. A change from an older plugin still renders; its intent, spec or plan phase reads as
  Design.
- The Gate screen reads `brief.md` at Design and `ship.md` at Ship (the runbook, `release.md`,
  at Deploy), and finds the decisions table under "Decisions" as well as "Decisions requested".
- Every decision starts on its recommendation, so the primary action reads "Approve as
  recommended" until an override is picked, then "Approve"; the other action is "Reject with
  notes".
- The Run screen shows the clock from the digest against the tier budget: agent minutes with a
  thin bar that turns coral when over, waiting on you, dead time, and your own time once
  measured. Opening a pending gate records `gate_opened.<G>` in the change's state so `WH clock`
  can measure that time.
- Bundles plugin 0.3.0.

## 0.4.9 — 2026-09-19

Follows 0.4.8 (transformers.js 4.3.0).

- Refresh the record reads CHANGELOG.md files as documents, as studbook's ingester does. An older
  build's Refresh deletes any document its parser does not produce, so it would remove the
  changelogs from the store; use this build or later to refresh.

## 0.4.8 — 2026-09-18

Follows 0.4.7 (the pgvector iterative scan, ESLint, Electron 44.4).

- transformers.js 4.3.0 (onnxruntime-node 1.30), held to the Studbook parity gates: retrieval
  reproduces the published numbers to four places. (`79b9d0b`)
- Agent SDK 0.3.273. (`d6e3a90`)

## 0.4.7 — 2026-09-18

Follows 0.4.6 (sharp 0.35.4, bundling plugin 0.2.14).

- Every Studbook connection sets pgvector's `hnsw.iterative_scan = strict_order`: on the HNSW index
  path, a scoped search returned 0 of 20 passages without it. (`a08ad3a`)
- ESLint, and the fixes its first run found: re-thrown errors keep their cause, and the Settings
  effect depends on what it reads. (`7a7105a`)
- Electron 44.4.0, pg 8.23.0; developing needs Node 22.12+. (`f0b393d`)

## 0.4.6 — 2026-09-18

Follows 0.4.5 (the rewrite guard's stemmer fix).

- sharp 0.35.4, closing two high advisories in image decoding; bundles plugin 0.2.14. (`af23aec`,
  `8613146`)

## 0.4.5 — 2026-09-18

Follows 0.4.4 (follow-ups searched as rewritten standalone questions).

- The follow-up rewrite's guard no longer rejects "pinning" for "pin" or "stopping" for "stop".
  (`cc048f9`)
- The answer prompts are pinned to Studbook's by hash. (`6b0e494`)

## 0.4.4 — 2026-09-18

Follows 0.4.3 (the rerank pool halved).

- A follow-up is searched for as a rewritten, standalone question, shown on the answer as
  "Searched for …". (`ace4c5b`)
- A cited answer that opens "Not in the record" is no longer badged as a refusal and stripped of its
  citations. (`f3439ce`)

## 0.4.3 — 2026-09-18

Follows 0.4.2 (Studbook threads and streaming).

- The rerank pool halved from 20 candidates to 10: the same answers, roughly twice as fast.
  (`f0e42f0`)

## 0.4.2 — 2026-09-17

Follows 0.4.1 (Refresh the record).

- The Studbook tab keeps a thread, and streams the answer as it is written. (`c141c52`, `0fde02b`)

## 0.4.1 — 2026-09-17

Follows 0.4.0 (the Studbook tab).

- Refresh the record: Studbook re-ingests the registered repositories from inside the app.
  (`589ad47`)

## 0.4.0 — 2026-09-17

Follows 0.3.0 (the Dracula redesign).

- The Studbook tab: questions over the engineering record, answered with a cited passage for every
  claim, running in the app's main process. Bundles plugin 0.2.13. (`0aa8edf`)

## 0.3.0 — 2026-09-15

Follows 0.2.0 (the first complete app).

- The Dracula redesign, with orbs rendered at library quality. Bundles plugin 0.2.12, whose gate
  approvals must answer every packet decision. (`a3c0c38`, `591c9b5`)

## 0.2.0 — 2026-09-14

Follows 0.1.0 (the scaffold).

- The first complete app: the Fleet, Run, Gate and Settings screens over an IPC bridge, the watcher
  and run drivers, the thinking orb, e2e smoke tests and portable packaging (`8e2ee6f`, `dd3c892`),
  and the fixes from its first real runs -- a reachable Run screen, onboarding that collects client
  context, an ASCII field that draws, and a run that says why it stopped (`e037417`, `3ba84b6`,
  `d4d71e6`, `7854629`).

## 0.1.0 — 2026-09-10

The scaffold: shared types and the theme. (`59bd33f`) The version stayed 0.1.0 through the first
working builds until 0.2.0, so those builds are not separable from 0.2.0 by version.
