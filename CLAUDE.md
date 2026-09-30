# WorkHorse (internal): working in this repository

Keep this file under one page. It is read at the start of every the harness session.

## Commands (run from the repo root)

- Install: `npm --prefix desk ci` (replaces the `desk/node_modules` junction; ask first)
- Typecheck: `npm --prefix desk run typecheck`
- Lint: `npm --prefix desk run lint`
- Plugin: `npm test`, `claude plugin validate .`, `workhorse doctor`
- Paddock test: `npm --prefix desk test`; one file: `npm --prefix desk test -- tests/<name>.test.ts`
- Build: `npm --prefix desk run build`; audit: `npm --prefix desk audit`; manifest: `claude plugin validate .`

## Architecture in five lines

1. The plugin: `skills/` start work, `agents/` do it, `hooks/scripts/` enforce the profile on every tool call.
2. `scripts/wh.js` is the only way to change state: `.git/workhorse/` for control, `docs/sdlc/<id>/` for documents.
3. `scripts/workhorse.js` is the user's command (`npm link`); it runs `wh-launch.js` (headless `claude -p`) and `wh.js`.
4. `scripts/wh-github.js` posts gates to the change's pull request and reads `/approve` and `/reject` back through `gh`.
5. Releases are manual: bump the version, add a changelog entry, then `claude plugin update workhorse@workhorse`. Paddock (`desk/`) is retired but keeps its CI.

## Conventions

- Branches: `wh/<change-id>`; commits: conventional (`feat:`, `fix:`, `docs:`, `chore:`)
- Tests live in `hooks/tests/run.js`, `desk/tests/*.test.ts` and `desk/e2e/`; never edit tests to make them pass
- Plugin code stays zero-dependency CommonJS; Paddock pins exact versions; Actions are pinned by SHA
- Child processes take argument arrays, never shell strings; secrets stay in Paddock's main process
- Changelog headings keep the `## X.Y.Z — YYYY-MM-DD` form and a `Follows` line; the tests check both

## Protected

Denied: `.github/workflows/**`, `.githooks/**`, `*.pem`, `*.key`, `*.p12`, `*.pfx`, `.env*`.
Ask first: `hooks/**`, `scripts/wh.js`, `skills/approve/**`, `.claude-plugin/**`, `vendor/**`, `ci/**`,
and Paddock's `settings.ts`, `index.ts`, `ipc.ts`, `studbook/**`, `preload/**`, `package.json`.

## Mistakes to avoid

Appended by retro after each change. Newest first.

- Do not run `npm ci` in `desk/` casually: it replaces the junction and the next plugin install copies about 1 GB.

## Workflow

This repo uses WorkHorse. Start any change with `/workhorse:run "<problem> -> <outcome>"`. Artifacts
live in `docs/sdlc/<change-id>/`. Approvals are recorded with `/workhorse:approve`.
