# Paddock changelog

Releases of Paddock, the WorkHorse desktop app, newest first. Each entry is built from the commits
it shipped (listed by hash) and names the release it follows and what that release did. Plugin
releases are in the
repository's root `CHANGELOG.md`; each Paddock build bundles the plugin version it names.

## 0.4.8 — 2026-09-18

Follows 0.4.7 (the pgvector iterative scan, ESLint, Electron 44.4).

- transformers.js 4.3.0 (onnxruntime-node 1.30), held to the Studbook parity gates: retrieval
  reproduces the published numbers to four places. (`72e925e`)
- Agent SDK 0.3.273. (`29621d1`)

## 0.4.7 — 2026-09-18

Follows 0.4.6 (sharp 0.35.4, bundling plugin 0.2.14).

- Every Studbook connection sets pgvector's `hnsw.iterative_scan = strict_order`: on the HNSW index
  path, a scoped search returned 0 of 20 passages without it. (`7ba2b8b`)
- ESLint, and the fixes its first run found: re-thrown errors keep their cause, and the Settings
  effect depends on what it reads. (`2831816`)
- Electron 44.4.0, pg 8.23.0; developing needs Node 22.12+. (`b3a5582`)

## 0.4.6 — 2026-09-18

Follows 0.4.5 (the rewrite guard's stemmer fix).

- sharp 0.35.4, closing two high advisories in image decoding; bundles plugin 0.2.14. (`e4b2264`,
  `2e0656d`)

## 0.4.5 — 2026-09-18

Follows 0.4.4 (follow-ups searched as rewritten standalone questions).

- The follow-up rewrite's guard no longer rejects "pinning" for "pin" or "stopping" for "stop".
  (`6c7ef82`)
- The answer prompts are pinned to Studbook's by hash. (`53c2078`)

## 0.4.4 — 2026-09-18

Follows 0.4.3 (the rerank pool halved).

- A follow-up is searched for as a rewritten, standalone question, shown on the answer as
  "Searched for …". (`e4fe31c`)
- A cited answer that opens "Not in the record" is no longer badged as a refusal and stripped of its
  citations. (`b34ded6`)

## 0.4.3 — 2026-09-18

Follows 0.4.2 (Studbook threads and streaming).

- The rerank pool halved from 20 candidates to 10: the same answers, roughly twice as fast.
  (`603e273`)

## 0.4.2 — 2026-09-17

Follows 0.4.1 (Refresh the record).

- The Studbook tab keeps a thread, and streams the answer as it is written. (`63694a9`, `26b6285`)

## 0.4.1 — 2026-09-17

Follows 0.4.0 (the Studbook tab).

- Refresh the record: Studbook re-ingests the registered repositories from inside the app.
  (`13ed3e9`)

## 0.4.0 — 2026-09-17

Follows 0.3.0 (the Dracula redesign).

- The Studbook tab: questions over the engineering record, answered with a cited passage for every
  claim, running in the app's main process. Bundles plugin 0.2.13. (`40a4c3e`)

## 0.3.0 — 2026-09-15

Follows 0.2.0 (the first complete app).

- The Dracula redesign, with orbs rendered at library quality. Bundles plugin 0.2.12, whose gate
  approvals must answer every packet decision. (`16d7e43`, `eb443b5`)

## 0.2.0 — 2026-09-14

Follows 0.1.0 (the scaffold).

- The first complete app: the Fleet, Run, Gate and Settings screens over an IPC bridge, the watcher
  and run drivers, the thinking orb, e2e smoke tests and portable packaging (`eac8bf4`, `e1c63d9`),
  and the fixes from its first real runs -- a reachable Run screen, onboarding that collects client
  context, an ASCII field that draws, and a run that says why it stopped (`27cac71`, `da523a0`,
  `53032b1`, `64a1a79`).

## 0.1.0 — 2026-09-10

The scaffold: shared types and the theme. (`5c5b350`) The version stayed 0.1.0 through the first
working builds until 0.2.0, so those builds are not separable from 0.2.0 by version.
