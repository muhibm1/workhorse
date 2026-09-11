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

## Where user data lives

Paddock writes only its own registry (`registry.json`: the list of repos you've added),
`settings.json`, and the encrypted `settings.key.bin` — plus, through the bundled `wh.js`, to
`docs/sdlc/` inside a registered repository, exactly as running WorkHorse from a terminal would.

- **Normal (installed) run:** Electron's per-app user data directory — `%APPDATA%\Paddock` on
  Windows.
- **Portable build:** the same files live next to the `.exe` instead, whenever a file literally
  named `portable` sits beside it (electron-builder's portable-app convention) — so a USB copy of
  `Paddock-<version>-portable.exe` plus a `portable` marker carries its registry and settings with
  it from machine to machine.

No telemetry, no network calls from the renderer, no auto-update in v1 (see the design spec,
section 9, for the full out-of-scope list).
