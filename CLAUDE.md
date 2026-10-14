# WorkHorse (internal): working in this repository

Keep this file under one page. It is read at the start of every the harness session.

## Commands (run from the repo root)

- Install: none (the plugin has no dependencies)
- Test: `npm test`; manifest: `claude plugin validate .`; machine check: `workhorse doctor`

## Architecture in five lines

1. The plugin: `skills/` start work, `agents/` do it, `hooks/scripts/` enforce the profile on every tool call.
2. `scripts/wh.js` is the only way to change state: `.git/workhorse/` for control, `docs/sdlc/<id>/` for documents. With a `bus:` profile block (0.6) every change is also an event on a Kafka-protocol log (`scripts/bus/`), and gates are read from the log.
3. `scripts/workhorse.js` is the user's command (`npm link`); it runs `wh-launch.js` (headless `claude -p`) and `wh.js`.
4. `scripts/wh-github.js` posts gates to the change's pull request and reads `/approve` and `/reject` back through `gh`.
5. Releases are manual: bump the version, add a changelog entry, then `claude plugin update workhorse@workhorse`. Paddock, the old desktop app, was removed on 2026-10-13 (see `docs/STATUS.md`).

## Conventions

- Branches: `wh/<change-id>`; commits: conventional (`feat:`, `fix:`, `docs:`, `chore:`)
- Tests live in `hooks/tests/run.js`; never edit tests to make them pass
- Plugin code stays zero-dependency CommonJS; Actions are pinned by SHA
- Child processes take argument arrays, never shell strings
- Changelog headings keep the `## X.Y.Z — YYYY-MM-DD` form and a `Follows` line; the tests check both

## Protected

Denied: `.github/workflows/**`, `.githooks/**`, `*.pem`, `*.key`, `*.p12`, `*.pfx`, `.env*`.
Ask first: `hooks/**`, `scripts/wh.js`, `skills/approve/**`, `.claude-plugin/**`, `vendor/**`, `ci/**`.

## Mistakes to avoid

Appended by retro after each change. Newest first.

- Paddock broke because it kept its own copies of what WorkHorse owns (a bundled plugin, a launcher, a repository list, an approve button). Any future front end only reads WorkHorse's state, never starts an agent, and acts only through `/approve` or `/reject` on the pull request.

## Workflow

This repo uses WorkHorse. Start any change with `/workhorse:run "<problem> -> <outcome>"`. Artifacts
live in `docs/sdlc/<change-id>/`. Approvals are recorded with `/workhorse:approve`.
