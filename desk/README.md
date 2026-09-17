# Paddock

Paddock is the WorkHorse desktop app. It watches every repository running WorkHorse, drives runs
through your installed `claude`, animates a palette-painted thinking orb from the live agent
stream, and is where you open gates. It bundles the WorkHorse plugin, so a fresh machine needs
only the app, Node 18+, and a `claude` login.

See `docs/superpowers/specs/2026-09-10-paddock-desktop-design.md` in the repository root for the
full design.

## Prerequisites

- **Node.js 18+** on `PATH`. Paddock spawns `node` itself (to run the bundled plugin's `wh.js`),
  and hooks in the plugin are spawned as `node` too.
- **`claude` on `PATH`**, logged in (`claude login`), for the default CLI backend. The Settings
  screen can switch to the Agent SDK backend instead, which needs an API key (below) and no
  `claude` login.

Paddock checks both on launch and shows a Setup screen with install instructions and a "Check
again" button if either is missing; nothing else in the app is reachable until they pass, except
Settings.

## Development

Run these from `desk/` (this directory):

```
npm install
npm run dev          # electron-vite dev: hot-reloading renderer, live main/preload reload
npm test             # vitest: normalise, registry, settings, syscheck, watcher, drivers, orbState,
                      # asciiMask, polar, store, ipc
npm run typecheck    # tsc --noEmit against tsconfig.node.json and tsconfig.web.json
npm run e2e          # Playwright, launches the built app (run `npm run build` first)
npm run build        # syncs the plugin, then electron-vite build -> out/
npm run dist:win     # build, then electron-builder --win portable -> dist/Paddock-<version>-portable.exe
```

## The bundled plugin

Paddock ships the WorkHorse plugin (agents, skills, hooks, scripts, templates) inside the app so
it works without a checkout of this repository. `scripts/sync-plugin.js` copies those directories
from the repository root into `resources/plugin/` (gitignored — it is generated, not committed)
and stamps `resources/plugin/VERSION` from the plugin's own manifest. `npm run build` runs it
automatically before `electron-vite build`; run it by hand (`node scripts/sync-plugin.js`) if you
want a fresh copy without a full build, e.g. after editing a skill at the repository root while
`npm run dev` is already running.

At runtime the resolved plugin path is: a Settings override if you set one, else
`process.resourcesPath/plugin` in a packaged build (via electron-builder's `extraResources`, see
`electron-builder.yml`) or `<project root>/resources/plugin` in a dev/unpackaged run. The
Settings screen's "Plugin" panel always shows which one is in effect and its version.

## CLI vs SDK backend, and the API key

Settings lets you pick the backend a run drives through:

- **CLI** (default) spawns your installed `claude` binary and reuses whatever `claude login`
  session it already has. No API key needed or stored.
- **Agent SDK** calls `@anthropic-ai/claude-agent-sdk` directly with an API key you enter once in
  Settings. The key is encrypted with Electron's `safeStorage` (backed by the OS keychain/DPAPI)
  into `settings.key.bin`, decrypted only in the main process at the moment a run starts, and
  never returned to the renderer, logged, or written into `settings.json`. Clear it from the same
  Settings panel.

Both backends normalise the run's `stream-json`/SDK messages through the same pure function
(`src/main/drivers/normalise.ts`), so the orb, log rail and station ring behave identically either
way.

## Studbook

The Studbook tab asks WorkHorse's own engineering record a question — gate packets, ADRs, specs,
evidence tables, retros, commit messages — and answers with a passage cited for every claim, or
says "not in the record" and shows what it did find. It is the query path of the
[studbook](https://github.com/muhibm1/studbook) project running inside Paddock's main process:
the two retrieval models through their ONNX ports (`@huggingface/transformers`, loaded on first
use, ~500 MB resident, a 1.5 GB one-time download cached under user data), the same SQL over the
same pgvector store, and Claude Haiku for the answer. No Python, no service, no port.

It needs two secrets, both kept the way the API key is: the store's Postgres connection string
(Settings > Studbook, encrypted into `studbook.conninfo.bin`, never returned to the renderer) and
the Anthropic API key from the Backend panel. Every database connection is verified against
Supabase's root certificate, which ships in `resources/studbook/` — an unverifiable server is
refused, never trusted.

The port is held to the Python pipeline by a parity gate rather than by hope:
`tests/studbook.gate.test.ts` runs Studbook's dev split through this code and asserts the
published retrieval numbers to four places (`STUDBOOK_DATABASE_URL` and `STUDBOOK_DEV_JSONL` turn
it on; it says loudly when it is skipped). What that gate caught before the port was written is
recorded in the studbook repo's `docs/paddock-gate.md`.

## Where user data lives

Paddock writes only its own registry (`registry.json`: the list of repos you've added),
`settings.json`, the encrypted `settings.key.bin` and `studbook.conninfo.bin`, and Studbook's
model cache (`studbook-models/`) — plus, through the bundled `wh.js`, to `docs/sdlc/` inside a
registered repository, exactly as running WorkHorse from a terminal would.

- **Normal (installed) run:** Electron's per-app user data directory — `%APPDATA%\Paddock` on
  Windows.
- **Portable build:** the same files live next to the `.exe` instead, whenever a file literally
  named `portable` sits beside it (electron-builder's portable-app convention) — so a USB copy of
  `Paddock-<version>-portable.exe` plus a `portable` marker carries its registry and settings with
  it from machine to machine.

No telemetry, no network calls from the renderer, no auto-update in v1 (see the design spec,
section 9, for the full out-of-scope list).

## Packaging

`npm run dist:win` builds `dist/Paddock-<version>-portable.exe` on the default toolchain,
Node 21 included. No PATH or `NODE_OPTIONS` changes are needed.

`electron-builder` 26.15.3's `app-builder-lib` calls `require("@noble/hashes/blake2.js")`, but
`@noble/hashes` 2.x is ESM-only, which throws `ERR_REQUIRE_ESM` below Node 22.12. `package.json`
carries a scoped override pinning that one package to 1.8.0, which is CommonJS and exports the
same `./blake2.js` providing the `blake2b` the builder uses:

```json
"overrides": { "app-builder-lib": { "@noble/hashes": "1.8.0" } }
```

Pinning electron-builder itself to 26.8.1 also avoids the crash, and was tried first. It was
reverted because 26.8.1 ships `builder-util-runtime` 9.5.1 and seven high-severity advisories
that 26.15.3 fixes. With the override, `npm audit` reports 0 vulnerabilities across all
dependencies, and the build signs and packages cleanly. Confirmed 2026-09-11 on Node 21.7.3.

Remove the override once `app-builder-lib` imports `@noble/hashes` as ESM, or once the Node
floor for building is 22.12 or later.
