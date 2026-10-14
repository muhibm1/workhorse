# The WorkHorse event log

WorkHorse 0.6 can write everything a run does to one shared, append-only log, so gate approvals,
run metrics and a run's history can be rebuilt on any machine. This folder holds what you need
to run that log on your own machine. It is optional: a repository without a `bus:` block in its
profile behaves exactly as before.

The design, with every decision and measurement, is
[`docs/superpowers/specs/2026-10-14-event-bus-design.md`](../../docs/superpowers/specs/2026-10-14-event-bus-design.md).

## Start the broker

The broker is Redpanda, a single program that speaks the Kafka protocol. It costs nothing and
runs in Docker:

```bash
docker compose -f examples/bus/compose.yml up -d
```

It listens on `127.0.0.1:19092` and keeps its data in a Docker volume, so the log survives a
restart. `docker compose -f examples/bus/compose.yml down -v` deletes it.

## Turn the log on for a repository

Add to the repository's `.workhorse/profile.yml`:

```yaml
bus:
  brokers: "127.0.0.1:19092"    # comma-separated host:port list; any Kafka 0.11+ or Redpanda broker
  topic: workhorse.events        # optional; this is the default
  partitions: 6                  # optional; used only when `bus init` creates the topic
```

Then, once:

```bash
node "<plugin>/scripts/wh.js" bus init
```

For a second machine to share approvals, it must reach the same broker (for example over a
private network such as Tailscale). The broker in `compose.yml` listens on localhost only, on
purpose: it has no passwords.

## Commands

| Command | What it does |
|---|---|
| `wh.js bus status` | Is the broker reachable, how many events, how many are waiting in this machine's outbox, each consumer's lag, dead letters |
| `wh.js bus gate G2` | Ask the log whether a gate is open for the active change, and why |
| `wh.js bus gates` | Every decision the log holds for the change, with who, when, on which machine, and the document's SHA-256 |
| `wh.js bus restore <change>` | Rebuild a change's state on this machine from the log (the session start does this by itself on the change's branch) |
| `wh.js bus flush` | Send the outbox now |
| `wh.js bus metrics [--follow]` | Timings per change: agent time, waiting per gate, dead time, sessions, tool calls and guard blocks per phase |
| `wh.js bus replay <change> [--until <time>] [--into <dir>]` | A run's story, or its state at a moment, rebuilt from the log |
| `wh.js bus backfill --repo <path>[#<ref>]` | Load runs from before 0.6 from their committed records; safe to repeat |
| `wh.js bus rebuild <approvals\|metrics>` | Delete a consumer's local store and rebuild it from the start of the log |
| `wh.js bus tail` | The latest events of this repository |
| `wh.js bus index [--follow]` | Put the documents this repository's runs wrote into Studbook's local record (needs `studbook:` below) |

## Keep Studbook's record fresh (0.6.1)

Add the path of a Studbook checkout (with its `.venv` installed) to the `bus:` block:

```yaml
bus:
  brokers: "127.0.0.1:19092"
  studbook: "../studbook"              # relative to this repository, or absolute
  # studbook_python: "../studbook/.venv/bin/python"   # default: the checkout's .venv
  # studbook_repo: workhorse                          # default: this folder's name, lowercased
  # studbook_db: "~/.studbook/record.sqlite"          # default: Studbook's own default
```

Then leave `node "<plugin>/scripts/wh.js" bus index --follow` running. Each document a run
writes is refreshed in the record two seconds after its last write; a failed refresh is retried
on the next pass.

## When the broker is down

Gates close. Pushing, merging and writing the documents a gate protects are refused with the
reason, and `wh.js approve` records the decision locally and queues it. Everything else carries
on, and its events wait in `.git/workhorse/bus/outbox/`. Start the broker and run
`wh.js bus flush` (or just keep working: every tool call sends the outbox).

## Tests

`npm test` covers the log with an in-memory stand-in. The tests that need a real broker are in
`hooks/tests/bus-broker.js`; CI runs them against this same image:

```bash
WORKHORSE_BUS_TEST_BROKERS=127.0.0.1:19092 node hooks/tests/bus-broker.js
```
