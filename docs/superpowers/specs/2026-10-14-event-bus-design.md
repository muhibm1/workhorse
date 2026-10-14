# WorkHorse 0.6: the run on an event log

Muhammad Muhibullah, 2026-10-14. The formal design for "WorkHorse on an Event Bus", the proposal
of 2026-10-13. It settles every question the proposal left open, says where it departs from the
proposal and why, and states the test that proves each claim. WorkHorse is the harness plugin in
which agents design, build, verify, review and ship a change while a person approves twice.

## In plain words

Today a WorkHorse run keeps its working memory on the one machine that ran it. The record of who
approved what is committed to git, but the switch that says "the Design was approved, the
agents may build" sits in a folder git never copies. So when a change moved from the laptop to a
cloud session, the approval was gone and had to be given again.

0.6 writes everything a run does as a short message onto one shared, append-only log: a phase
started, a document was written, a person approved the Design. The log runs on Redpanda, a free
single-program server that speaks the Kafka protocol, in Docker. Small readers, called
consumers, each rebuild one thing from that log: whether a gate is open, how long each step
took, or the full story of a run. Any machine that can reach the log can rebuild the same
answers, so an approval follows the change wherever it goes.

Three rules do not move. A person still approves twice. A gate is closed unless the log says it
is open, so if the log cannot be reached the run pauses instead of guessing. And a repository
that does not turn the log on works exactly as before, with nothing but a checkout.

Terms used below:

- **Event**: one message on the log, such as "gate G2 approved". Events are never edited or
  deleted; a correction is a new event.
- **Topic**: the named log events go to. **Partition**: one of its ordered lanes. Events with the
  same **key** always land in the same lane, in the order they were written.
- **Producer**: whatever writes events. **Consumer**: whatever reads them and keeps a result.
- **Offset**: an event's position in its lane. A consumer remembers the offset it reached, so it
  can stop and carry on later. **Lag** is how far behind the end of the log it is.
- **Projector**: a consumer that keeps the current state a stream of events adds up to, the way a
  bank balance is the sum of the transactions.
- **Dead letter**: a side topic for an event a consumer could not process, so one bad event never
  stops the rest.
- **Gate**: a point where the run stops for a person. G2 is Design, G4 is Ship, G5 is Deploy.

## What the proposal asked for, and what this design ships

| Proposal phase | Ships as | Status |
|---|---|---|
| 1. Event log and approvals projector (tier 2) | WorkHorse 0.6.0 | Built; tested in `npm test` and against a real broker in CI |
| 3. Run metrics consumer (tier 0) | WorkHorse 0.6.0 | Built; agrees with the ledger on all 18 recorded runs |
| 4. Replay (tier 0) | WorkHorse 0.6.0 | Built; a replayed run matches the original |
| 2. Studbook streaming indexer (tier 1) | WorkHorse 0.6.1 and studbook #15 | Built; parity proved with the real model (see Phase 2) |

Phases 1, 3 and 4 ship together as 0.6.0 because metrics and replay are thin readers of the log
phase 1 creates, and were built and tested in the same pass. The indexer touches a second
repository (Studbook) and its search quality, so it goes last and can be dropped without
weakening the rest, as the proposal allows.

### What happens to the planned 0.5.5 to 0.5.7

The 0.5 plan (2026-10-13) named three more releases: 0.5.5, at most five decisions per Design
document; 0.5.6, review starting alongside build; 0.5.7, splitting a big change at Design. None
of them is about where events live, so this design neither replaces nor ships them. They move,
unchanged in intent, into the 0.6 line as 0.6.2, 0.6.3 and 0.6.4, after the indexer.

They come after the log on purpose. Each was meant to cut time spent waiting or working, and
until now that time was counted by hand. With 0.6.0 the metrics consumer reports waiting per
gate and agent time per phase for every run, so each of the three is measured against the runs
before it from the same log, instead of against a table nobody can recompute (see "Measured"
below).

## Decisions

Each fork the proposal left open, the default picked, and why. These are reversible unless
marked otherwise.

| # | Question | Decision | Why |
|---|---|---|---|
| D1 | Which Kafka client? | A small Kafka protocol client written for WorkHorse, with no dependencies (`scripts/bus/kafka.js`). | The plugin's rule is zero npm dependencies; hooks run in a fresh Node process per tool call, where a large client's start-up cost matters. The client speaks the real Kafka binary protocol, so it works unchanged on Redpanda and on Apache Kafka. It implements only what WorkHorse uses (listed under "The client"). |
| D2 | One topic or several? | One topic, `workhorse.events`, six partitions, keyed by change id; a second topic `workhorse.dead-letter`. | One key per change gives a change's events in order for free, which the approval rule needs (an approval refers to a document written earlier). A topic per family would need cross-topic ordering. The cost is that a gate check reads every event in its lane, tool calls included; measured below and acceptable at one developer's volume. |
| D3 | Is the log required? | Opt-in per repository: a `bus:` block in `.workhorse/profile.yml`. Without it, nothing changes. | WorkHorse "needs nothing but a checkout" is a property worth keeping for client repositories. With the block, the log is the authority for gates and the run fails closed. |
| D4 | Where does the projector's table live? | A JSON file in the repository's control-state folder (`.git/workhorse/bus/`), written atomically together with the offsets it reached. | SQLite in Node is still experimental (`node:sqlite`) and the plugin supports Node 18. The proposal's point holds: the log is the truth, the file is a cache, and a new machine rebuilds it in under a second. |
| D5 | What does "pinned to a document version" mean? | An approval records the SHA-256 of the packet and its length in bytes. The gate is open only if the packet's first that-many bytes still hash to the recorded SHA. | The Ship document legitimately grows after approval (the shipper appends its Deploy record), so "identical file" would close a gate that should be open. "What you read has not changed by one byte" is the rule a person means. |
| D6 | How does a second machine know the change exists? | Every save of a change's control state also writes a `state.saved` event. `wh.js bus restore <id>` (and the session start hook, on the change's branch) rebuilds the local state from the log. | Approvals alone are not enough to continue: the phase, tier and verification result also live only on the first machine. Gate approvals are never taken from these snapshots, only from approval events. |
| D7 | How does a hook send without slowing tool calls? | Every event is first written to a local outbox; the post-tool-call hook then sends the outbox with a time cap and leaves the rest for next time. | Queuing is a single file write. The send happens after the tool already ran, so the agent never waits on the network before acting. Events survive a crash or a broker outage in the outbox. |
| D8 | How is "a session can't approve its own gate" kept? | Three layers: the bash guard refuses approvals and direct producers from any subagent; the projector ignores an approval event not marked as a person's or carrying an agent id; and it voids an approval whose event id appears in a subagent's tool output. | The first layer is today's rule. The second is the proposal's. The third catches the case where a subagent ran the approve command in a way the guard did not recognise. None of this is signing; a determined agent with shell access could still forge an event, exactly as it could append to `approvals.md` today. Signing is left for a multi-approver version, as the proposal says. |
| D9 | What exactly fails closed? | The actions a gate protects: pushing, merging, writing the documents a gate opens, and the merge after a Ship approval. Ordinary tool calls carry on and queue their events. | Pausing every tool call because the broker is down would stop work that cannot do harm; pausing the gated steps is what the proposal's rule protects. |
| D10 | Consumer groups | Each consumer commits its position under its own group id, one per machine (`workhorse.approvals.<host>`), using Kafka's simple-consumer commit. It does not join a group for rebalancing. | Each consumer runs as one instance, so there is nothing to rebalance. Committed offsets still make lag visible to standard tools (`rpk group describe`). Group membership is what to add if a consumer ever runs as several copies. |
| D11 | Retention | `retention.ms = -1` (keep forever) on `workhorse.events`. Irreversible only in the sense that deleting the topic deletes the history. | The log is the source of truth. A run is thousands of small events; a year of one developer's runs is megabytes. |
| D12 | How was this built? | Directly, in a cloud session, not through `/workhorse:run`. | The proposal priced four WorkHorse runs. Those need the owner at two gates each, and he was on a flight. The ledger therefore has no rows for 0.6, and this document says so rather than inventing them. |

## Corrections to the proposal

Three statements in the proposal are not quite what the code does. They are corrected here so
the design is checked against the real system.

1. **"A hook comparing it against the current document refuses the gate if they differ, exactly
   as the file-based check does now."** The file-based check does not compare. `wh.js approve`
   records the packet's SHA-256 in `approvals.md`, but `gate-guard.js` only reads the gate's
   status from `state.json`; nothing ever re-hashes the packet. 0.6 adds the comparison (D5),
   on the log path. It is a new protection, not a preserved one.
2. **"The nine hooks."** There are nine hook scripts plus a shared library. 0.6 adds a tenth,
   `bus-emit.js`, the producer.
3. **"Changes to Paddock... The desktop app keeps reading what it reads today."** Paddock was
   retired and removed on 2026-10-13 (workhorse #32). Nothing in 0.6 touches it. The read-only
   "what needs me" view the Paddock decision allowed would read the metrics consumer's output.

## How it works

```
 producers                         the log (Redpanda)                     consumers
 ---------                         ------------------                     ---------
 bus-emit.js hook  ── outbox ──▶  workhorse.events   ──▶  approvals projector (gates, restore)
 (every tool call,                 6 partitions,      ──▶  run metrics       (timings, health)
  session start/stop)              key = change id    ──▶  replay            (one change's story)
 wh.js (state, log rows,                              ──▶  Studbook indexer  (Phase 2)
  phases, present)                 workhorse.dead-letter ◀── any consumer, after retries
 wh.js approve (gate.* only)
                     gate-guard.js / ship merge ── asks the projector "is G2 open?" ──┘
```

### The event envelope

Every event is one JSON object. Consumers ignore fields they do not know, so the format can grow.

| Field | What it holds |
|---|---|
| `event_id` | A UUID; consumers de-duplicate on it. Backfilled events get a stable id derived from their source, so re-running a backfill adds nothing. |
| `change_id` | The WorkHorse change; also the partition key. |
| `repo` | The repository, from its `origin` URL (`github.com/muhibm1/workhorse`), so two machines name it the same way. Falls back to the folder name. |
| `session_id` | The agent session from the hook input, or `cli:<host>` for the command line. |
| `actor` | `{ kind: "agent" | "human" | "cli", agent_id, agent_type }`. Subagent tool calls carry their agent id. |
| `host` | The machine that produced it, so "approved on the laptop, continued in the cloud" is visible. |
| `type` | See the table below. |
| `ts` | Producer time, UTC, ISO 8601. |
| `schema_version` | 1. Bumped when a payload's shape changes incompatibly. |
| `payload` | Type-specific. |

| Type | Produced by | Payload |
|---|---|---|
| `change.created` | `wh.js new` | title, tier, branch |
| `state.saved` | every control-state save | the state, minus nothing; the projector ignores its gate approvals |
| `phase.started` | `wh.js phase` | phase, previous phase |
| `log.row` | every conductor-log row | the row exactly as written to `conductor-log.md` |
| `gate.presented` | `wh.js present` | gate |
| `doc.written` | post-tool-call hook, on a write under `docs/sdlc/<id>/` | path, sha256, bytes |
| `doc.decided` | `wh.js approve` | packet path, sha256, bytes, gate |
| `gate.approved` / `gate.rejected` | `wh.js approve` only (also the GitHub `/approve` path, which calls it) | gate, packet, sha256, bytes, who, source, notes |
| `tool.called` | post-tool-call hook | tool, a 200-character summary, any approval event ids seen in the output |
| `hook.blocked` / `hook.asked` | any guard that denies or asks | hook, tool, reason |
| `session.opened` / `session.closed` | session start, stop and subagent stop hooks | — |

"A hook allows something" from the proposal is not its own event: every allowed tool call is a
`tool.called`, so a separate `hook.allowed` would double the volume and say nothing new. A
reviewer's finding is the `doc.written` of its `reviews/<agent>.md`.

### Configuration

```yaml
# .workhorse/profile.yml
bus:
  brokers: "127.0.0.1:19092"     # comma-separated; WORKHORSE_BUS_BROKERS overrides
  topic: workhorse.events         # default
  partitions: 6                   # used only when wh.js bus init creates the topic
```

`examples/bus/compose.yml` starts Redpanda (image pinned by digest) with `docker compose -f
examples/bus/compose.yml up -d`; `wh.js bus init` creates both topics with infinite retention;
`wh.js bus status` shows the broker, both topics, each consumer's lag and the dead-letter depth;
`workhorse doctor` adds one line for the bus when a profile turns it on.

### The client (D1)

`scripts/bus/kafka.js`, about 500 lines, no dependencies. It speaks these Kafka APIs, all in their
pre-"flexible" versions that Kafka 0.11 onwards and every Redpanda release accept:

| API | Version | Used for |
|---|---|---|
| Metadata | 1 | finding each partition's leader broker |
| CreateTopics | 0 | `wh.js bus init` |
| Produce | 3 | writing record batches (format v2, CRC-32C), `acks = all` |
| Fetch | 4 | reading from an offset |
| ListOffsets | 1 | the start and end of each partition |
| FindCoordinator | 0 | the broker that stores a group's offsets |
| OffsetCommit / OffsetFetch | 2 / 1 | consumer positions, for lag |

The partitioner is Kafka's own (murmur2 of the key, as the Java client computes it), so an event
lands in the same partition whichever client wrote it. Not implemented, and refused loudly if met:
compressed batches, transactions and SASL or TLS. WorkHorse writes none of the first two; the last
is what a hosted broker would need (out of scope, as the proposal says).

### Producing (D7)

1. `emit()` writes the events as one small file in `.git/workhorse/bus/outbox/`, under a
   temporary name renamed into place. Names sort by time, process and a counter, so each
   process's events keep their order, and no writer ever appends to a file a flush is reading.
2. `flush()` takes a lock file, reads the outbox oldest first, sends it in one produce request
   per partition, and deletes each file once the broker acknowledged it. A failed send deletes
   nothing, so the events go first next time and a change's events stay in order.
3. The post-tool-call hook flushes with a 1.5-second cap. `wh.js approve` flushes and waits,
   because the approval must be on the log before the gate can open.
4. A retry can write an event twice. That is accepted: every consumer de-duplicates on
   `event_id` (rule 3).

### The approvals projector (Phase 1)

It reads `workhorse.events` and keeps, per `repo` and change: each gate's last decision (status,
pinned SHA and length, who, when, the event id, the machine), the latest control-state snapshot,
and any approval it voided and why. It stores that, the offsets it reached and the event ids it
has applied in one file, replaced atomically, then commits its group offset.

A gate check (`gate-guard.js`, and the merge after Ship) asks it one question for one change:

1. Catch up the change's partition to its end. If the broker cannot be reached within three
   seconds: **closed**, "the event log is unreachable; start it and retry".
2. No approval event for the gate: **closed**. A rejection after an approval: **closed**.
3. An approval whose packet no longer matches its pin: **closed**, naming the packet.
4. Otherwise **open**.

It never falls back to `state.json` while the profile turns the bus on. That file is still
written, so `wh.js status`, the digest and the watcher keep working, but it is not trusted for a
gate.

### Run metrics (Phase 3)

`wh.js bus metrics` is a consumer of everything. For each change it computes the clock exactly
as `computeClock` does from the conductor log and approvals (agent, waiting, dead and
unexplained minutes, and wall time), plus what only the log knows: waiting per gate, minutes per
phase, sessions opened per phase, tool calls per phase, guard blocks per hook, and how many
approvals were voided. It also reports the bus's two health numbers: each consumer group's lag
and the dead-letter depth. `--follow` keeps it running and reprints when a change moves.

The runs before 0.6 have no events, so `wh.js bus backfill --repo <path>[#<ref>]` turns a
repository's committed records (each change's `conductor-log.md` and `approvals.md`) into events,
with ids derived from their source. That is how the metrics consumer is checked against history.

### Replay (Phase 4)

`wh.js bus replay <change> [--until <time>] [--into <dir>]` reads one change's lane from the
start and prints its story: every phase, gate, document and decision, with the machine that
produced it. With `--into` it re-materializes the change as it stood at `--until`: its control
state, its conductor log byte for byte, its approvals as the projector saw them, and a manifest
of every document's SHA. That is the AgentOps "fork from a checkpoint" idea applied to a run.

### Phase 2: Studbook streaming indexer (0.6.1)

Studbook is the engineering-record search the designer queries. Its local record is rebuilt by
`localrecord/sync.py`, per repository, embedding only chunks whose content changed.

The design: a consumer `wh.js bus index` reads `doc.written` and `doc.decided` events for
repositories listed in a Studbook corpus file, waits two seconds for a document to settle, and
calls a new per-document entry point, `python -m localrecord.sync --repo <name>=<path> --only
<relative path>`, which runs the same parse, chunk and embed steps on that one file. Because the
steps are the same code, the streamed record should equal the batch record row for row; the
parity test checks exactly that (same chunk ids, same content hashes, same vectors) and then
runs Studbook's 40-question development set against both, requiring the same passages in the
same order and scores within 0.0001. It ships only when that passes.

**As built.** The consumer is `scripts/bus/indexer.js`, run as `wh.js bus index [--follow]`.
It is configured by `studbook:` (the checkout) in the `bus:` block, with `studbook_python`,
`studbook_repo` and `studbook_db` as overrides, and keeps its own store,
`.git/workhorse/bus/index.json`, under the group `workhorse.index.<host>`. It indexes only
`docs/sdlc/<change>/*.md` paths of this repository; READMEs, changelogs and commit messages stay
with the full sync. Paths stay pending until Studbook exits 0, so delivery is at least once and
a crash or failure is retried; re-indexing an unchanged file embeds nothing, so a repeat costs
one Python start and a parse.

Studbook's side (`sync_paths`) refreshes the named files and also any other file document whose
stored fields no longer match a fresh parse, because a tier stated in a brief changes every
document of its change. A named file that is gone is deleted. One more change was needed for
parity: search ties in the local record were broken by row order, which depends on the order
rows were written, so they are now broken by passage id.

**Parity, measured 2026-10-14** with bge-base-en-v1.5 on CPU. A record of WorkHorse at 0.5.4 was
built by a full sync, then every file 0.6.0 changed was streamed into it one at a time, plus one
deleted change document; a second record was built by a full sync of 0.6.0. Commit messages were
dropped from both before comparing.

| Check | Result |
|---|---|
| Documents | 39 and 39, identical |
| Passages: ids, text, headings, hashes | 337 and 337, identical |
| Vectors | 332 identical; 5 differ by at most 2e-7 per element (cosine 1.0), because the model saw them in a different batch, which any two differently batched full syncs also show |
| Studbook's 40 dev questions, hybrid search, top ten | 40 of 40 the same passages in the same order |
| Time per streamed path, nothing to embed | median 0.01 s inside Python; each `wh.js bus index` pass adds a Python start and the model load |

The fake-embedder version of the row-for-row check runs in Studbook's CI
(`tests/test_localrecord.py`, `StreamingParityTest`).

## Rules that stay in code

| Rule | Where it is enforced | Test |
|---|---|---|
| 1. An approval is pinned to a document version. | `projector.gateCheck` re-hashes the packet's approved prefix on every check. | Edit the approved brief: the push is refused. Append to the approved Ship document: still open. |
| 2. A session can't approve its own gate. | `bash-guard.js` (approve or direct produce from a subagent), `projector` (actor and agent id; voiding by tool output). | A subagent's approve is refused; a forged agent approval event is ignored; an approval id seen in a subagent's output is voided. |
| 3. Every consumer is idempotent. | De-duplication on `event_id` in each store; offsets stored with the state. | Double delivery, and crash mid-batch. |
| 4. Gates fail closed. | `gateCheck` returns closed on any broker error; events wait in the outbox. | Broker down. |
| 5. A poison event never stops the pipeline. | Every consumer retries three times with backoff, then writes the raw event and the error to `workhorse.dead-letter` and moves on. | A malformed event is dead-lettered and the next event still applies. |

## Measuring it before claiming anything

Every test below runs in CI. The ones marked "broker" run in a CI job that starts Redpanda from the
same pinned image; the rest run in `npm test` against an in-memory log with the same interface.

| Test | Proves | Pass condition | Where |
|---|---|---|---|
| Cross-machine approval | The documented gap is closed | Approve G2 in one checkout; in a second fresh clone with no shared files, restore from the log; the guard allows the gated write and never asks for G2 again | broker |
| Double delivery | Consumers are idempotent | Every event written twice; a fresh projector over the log equals one over a single copy, byte for byte | `npm test` and broker |
| Crash mid-batch | No lost or doubled state | Kill the projector after its store write, before its offset commit; on restart its store equals a clean build | `npm test` |
| Broker down | Gates fail closed | Stop the broker: the push is refused and the approval queues in the outbox; start it: the outbox drains and the push is allowed | broker |
| Metrics agree with history | The live numbers reproduce the recorded ones | Backfill the three runs behind the five-to-two decision; the metrics consumer's agent, waiting, dead and wall minutes equal the committed ledger's to the tenth of a minute | `npm test` |
| Replay matches the original | Replay loses nothing | A replayed change's state, conductor log and document SHAs equal the original's | `npm test` and broker |
| Index parity (Phase 2) | Streaming is not worse than batch | Same rows; the 40-question set returns the same passages in the same order | Studbook CI |

The proposal's "metrics agree with history" asks for the hand-computed figures of 2026-09-19.
Those figures and the committed ledger already differ, because the hand analysis counted long
silences in the log as waiting on the person and the ledger counts them separately as
"unexplained". The test therefore checks against the ledger, which anyone can recompute, and the
release notes print both sets side by side with the reason.

## Measured (2026-10-14)

Against Redpanda 24.2.7 in Docker, in a cloud container (4 cores), with Node 22.

| What | Result |
|---|---|
| Producer hook, per tool call, log on | median 67 ms, 90th percentile 78 ms |
| Producer hook, per tool call, repository without the log | median 40 ms (a bare Node start is 33 ms) |
| Gate check, caught up | 75 to 95 ms, Node start included |
| Gate check on a new machine, lane of 20,070 events | 0.7 s, once; then as above |
| Real-broker suite (`hooks/tests/bus-broker.js`) | 13 of 13, with the broker container really stopped and restarted |
| `npm test` | 501 of 501 (47 new) |
| All 18 ledger runs backfilled from five repositories, then measured from the log | 18 of 18 equal the ledger to the tenth of a minute |

**The hand-computed figures of 2026-09-19.** The proposal asked the metrics consumer to match the
table that justified cutting five gates to two. It matches the committed ledger instead, and the
two disagree:

| Run | Hand table: waiting on the person | From the log: waiting | From the log: unexplained silence | Hand table: wall | From the log: wall |
|---|---|---|---|---|---|
| Portfolio deploy | 41 h | 19 h 30 m | 12 h 01 m | 64 h | 68 h 28 m |
| Portfolio font fix | 10 h 40 m | 1 h 06 m | 14 h 37 m | 18 h | 21 h 59 m |
| webapp zoom | 17 h | 6 h 02 m | 0 m | 18 h 30 m | 6 h 29 m |

The hand count's method was not written down, so the difference cannot be traced line by line.
Two causes are likely (inferred, not confirmed): it counted some long silences as waiting on the
person, which the ledger reports separately as unexplained, and for the webapp run, whose record
was never closed, it measured to a later moment than the last row in the log. The ledger's rule
is written down and anyone can recompute it, so the test holds the log to the ledger.

What the log adds that the hand analysis could not: waiting split per gate. On those three runs,
633 of 1,598 waiting minutes were spent at G1 (Intent) and G3 (Plan), the two gates the cut
removed; G2 (Design) took most of the rest. The five-to-two decision holds up.

## What would change beyond one person

All of this is for one developer on several machines, the real use today. For a team it would
need: approval events signed by the approver (today anyone who can reach the broker can write
one); SASL and TLS on the broker and in the client; a schema registry once a second producer
appears; consumer group membership if a consumer runs as several copies; and per-repository
topics or ACLs so one client's events are not readable by another.

## Risks

- **Docker becomes a dependency for repositories that turn the bus on.** Mitigated by D3 (opt-in)
  and rule 4 (a missing broker pauses at gates, never corrupts). If it proves annoying, that is a
  finding for the retro.
- **Hook overhead.** Every tool call now runs one more short Node process: about 7 ms more than a
  bare Node start in a repository without the log, about 34 ms with it (see Measured).
- **The outbox can lag the truth.** An event that has not left the outbox is not on the log. For
  gates this is safe (closed until it arrives). For metrics it means a few seconds of delay.
- **A gate check reads the whole lane once per machine.** With tool calls on the same topic, a
  busy change's lane holds thousands of events. Measured at 0.7 s for 20,070 events on a new
  machine, then only the new events. If it grows, the fix is a snapshot event per change, not a
  second topic.
