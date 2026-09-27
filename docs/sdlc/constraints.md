# Constraints: WorkHorse

Written by wh-discovery-analyst on 2026-09-27 at commit 0ec0a97. Every claim is labelled
**confirmed** or **believed**. The evidence is in `docs/sdlc/codebase-map.md`.

## How the business uses this

- **Who.** One forward-deployed engineer (the owner) builds and uses WorkHorse. It is the owner's
  own tooling, and this repository is its own client (confirmed, from the user's description and
  the single git author in the history).
- **The loop.** The owner opens a client repo, runs `/workhorse:onboard` once, then
  `/workhorse:run "problem -> outcome"` per change. Agents design, build, verify and review. The
  owner approves the Design document (G2) and the Ship document (G4), plus Deploy (G5) at tier 3
  (confirmed, README).
- **Where humans decide.** At the gates, from the harness or from Paddock's Gate screen. Also at
  release: reinstalling the plugin and building a Paddock exe are manual steps (confirmed, STATUS
  and changelogs).
- **Paddock** is the owner's desk for watching every repo, starting and resuming runs, opening
  gates, getting a phone notification when a gate waits, and asking Studbook about the record.
  Registered today: `webapp`, `Portfolio`, `studbook` (confirmed).
- **What matters to the owner.** Speed: over-budget runs count as defects. Every run is timed
  against a tier budget, and the five proving runs are recorded in `docs/STATUS.md` (confirmed).

## Technical constraints

1. **The plugin has no dependencies.** Hooks and `wh.js` run on every tool call in every client
   repo. They must stay dependency-free CommonJS on Node 18+ (confirmed, `package.json`, README).
2. **The profile's YAML is parsed by a small custom parser** (`hooks/scripts/lib.js parseYaml`),
   not a YAML library. Block lists, nested maps, inline `[...]` and `{...}`, and one-line quoted
   strings are supported. Multi-line strings and anchors are not (confirmed by reading it). A `#`
   after whitespace starts a comment unless it is inside quotes.
3. **Installing copies the plugin.** `claude plugin install` copies the whole folder, `desk/`
   included, into `~/.claude/plugins/cache/<version>/` and never prunes. A change reaches this
   machine only after a version bump and a reinstall (confirmed, README and STATUS).
4. **`desk/node_modules` is a junction** to `~/Paddock-deps/node_modules`, so the
   plugin cache stays small (confirmed by `ls -la`). `npm ci` replaces the junction, and the
   installer would then copy about 1 GB per version. The profile's `install` command is therefore
   believed rather than run, and `npm ci` is on the ask list.
5. **Worktrees have no `desk/node_modules`.** The junction is untracked, so a builder in a fresh
   worktree cannot run Paddock's typecheck, lint or tests without an install (believed; not tried).
   See decision D3.
6. **Paddock build output goes outside the repo**, to `~/Paddock-builds`
   (confirmed, `electron-builder.yml`). A running Paddock locks its own exe, which is why
   `predist-check.js` exists.
7. **CI has no secrets by design.** The Studbook parity gates skip in CI and run locally; CI
   checks the passed-test counts (140 or more for the plugin, 240 or more for Paddock) so that a
   suite skipping its way to green still fails (confirmed, `ci.yml`).
8. **Changelog format is tested.** `## X.Y.Z — YYYY-MM-DD` with a spaced em-dash, first in the
   file, followed by a `Follows X.Y.Z (` line. Studbook answers release questions from these files
   (confirmed, `hooks/tests/run.js`, `desk/tests/changelog.test.ts`). This is the one place the
   agents' "no em-dashes" rule gives way.
9. **Single-file tests take a path relative to `desk/`.** `npm --prefix desk test -- tests/x.test.ts`
   works; `desk/tests/x.test.ts` finds nothing (confirmed).

## Business constraints

- **One owner, one machine.** Nobody else deploys or approves. GitHub branch protection on
  `master` requires the `plugin` and `desk` checks, strict, with admins not bound (confirmed,
  `gh api`). The owner pushes to `master` directly as an admin bypass (believed, from the log).
- **Private repo, US jurisdiction, no end users** (user's statement; private visibility confirmed).
- **Usage limits are real.** Big parallel fan-outs hit the Claude session limit on this machine,
  so the profile sets `build.max_parallel: 6` (believed, from the owner's recorded observation).

## Must not change without the owner

- The hooks and `wh.js`, which every client repo depends on. They are sensitive paths and have a
  tier 2 floor.
- The approval path: `skills/approve/`, `wh.js approve`, and the bash-guard rule that stops a
  subagent from approving.
- Paddock's secret handling (`settings.ts`), CSP and navigation guards (`index.ts`), IPC surface
  (`ipc.ts`, `preload/`), and the Studbook connection code (verified TLS against the pinned CA).
- CI workflows and the pre-push hook (denied to agents).
- `desk/resources/studbook/supabase-ca.pem` (denied; rotating it is a human task).

## Known debt and findings

| # | Finding | Evidence | Status |
|---|---|---|---|
| K1 | The root `.gitignore` has no `.env*` pattern. No such file is tracked today. | `git ls-files`, `.gitignore` | confirmed |
| K2 | `ci/claude-review.yml` (a template clients copy) uses floating tags `actions/checkout@v6` and `anthropics/claude-code-action@v1`, unlike this repo's SHA-pinned CI | file | confirmed |
| K3 | Paddock has no error tracking; failures go to `console.error` in main, which nobody reads in a packaged app | grep | believed |
| K4 | `docs/STATUS.md` says Paddock ignores `settings.pluginPath` even though the file holds it. On this machine `pluginPath` is unset in `%APPDATA%\Paddock\settings.json`. | keys read, values not | confirmed that it is unset |
| K5 | `docs/STATUS.md` lists 11 open speed defects (Paddock venv tool approvals, Resume starting a second conductor, approving before a gate is presented, and others) | STATUS | confirmed as documented |
| K6 | Studbook's Refresh sends each synced repo's SDLC documents and commit messages to the owner's Supabase project. If a client repo is registered and synced, that client's documents leave its repo. | `studbook/sync.ts`, `parser.ts` | confirmed in code; which repos are in the store is not verified |
| K7 | STATUS says the live Studbook CI job uses a `studbook-test` Supabase project and the production Anthropic key. `studbook/docs/hosted-config.md` (2026-09-18) says there is no separate test project. | both documents | contradiction; not resolved here |
| K8 | Branch protection does not bind admins, so direct pushes to `master` skip the required checks (recorded as a bypass) | `gh api` | confirmed |
| K9 | No `.well-known/security.txt` and no `docs/hosted-config.md` in this repo | file list | confirmed |

## Open questions for the client

1. Should Studbook be allowed to ingest client repositories (`webapp`, `Portfolio`) into the
   owner's Supabase project? If yes, is that recorded with each client?
2. Which repos are in the Studbook store today? (Needs the reader connection; not verified here.)
3. Does a `studbook-test` Supabase project exist? (K7)
4. Should ntfy gate notifications carry change titles, which may name client work? Is the ntfy
   topic private or self-hosted?
5. Should the git author email (an employer domain) stay in the commit history and in
   `approvals.md`, or should a personal or noreply address be used?
6. Bind admins in branch protection? (Already an open owner decision in STATUS.)

## G0 packet: confirm the profile

### The short version

Discovery audited WorkHorse, Paddock and in-repo Studbook and wrote `.workhorse/profile.yml`. The
test, typecheck, lint, audit and manifest checks all ran green from the repo root. You are being
asked to confirm the protected paths, the autonomy level, the commands and the compliance position
below, so that the hooks can start enforcing them.

### What the profile says

| Area | Value | Status |
|---|---|---|
| Autonomy | `bounded` (template default) | recommendation |
| Default branch | `master`; agents cannot push to it (bash-guard, checked live) | confirmed |
| Denied edits | `.github/workflows/**`, `.githooks/**`, `*.pem`, `*.key`, `*.p12`, `*.pfx`, `.env*` | probed: the CA cert, `ci.yml`, `pre-push` and `desk/.env.local` were denied |
| Ask before edit | `hooks/**`, `scripts/wh.js`, `skills/approve/**`, `.claude-plugin/**`, `vendor/**`, `ci/**`, `dependabot.yml`, Paddock `settings.ts`, `index.ts`, `ipc.ts`, `studbook/**`, `preload/**`, `electron-builder.yml`, `package.json`, `package-lock.json` | probed: `lib.js` and `answer.ts` asked; `App.tsx` and agent files were allowed |
| Tier 2 floor | hooks, `wh.js`, approve skill, Paddock secret, IPC, CSP and Studbook code, `.github`, `.githooks` | recommendation |
| Denied commands | force push, `npm publish`, `gh repo delete`, visibility change, `DROP DATABASE`, `bootstrap_db` | recommendation |
| Ask commands | plugin uninstall and marketplace, `electron-builder`, `dist:win`, `npm ci`, `gh api -X` | probed: `npm ci` and `dist:win` asked |
| Prod deploy | `claude plugin install workhorse`, not automatic; denied without G5 | probed: denied with no active change |
| Commands | as in the table below | see Proof |
| Compliance | no regimes confirmed (GDPR, SOC 2, ISO 27001 flagged possibly applicable), no special categories, Studbook store in us-east-1, `audit_log_required: true` (approvals.md) | filled by wh-compliance-mapper; see Compliance controls |
| Tracker | none | confirmed |

### Proof

| Check | Command | Exit | Status |
|---|---|---|---|
| test | `npm test && npm --prefix desk test` | 0 (224 plugin checks; 278 passed and 1 skipped in Paddock) | confirmed |
| typecheck | `npm --prefix desk run typecheck` | 0 | confirmed |
| lint | `npm --prefix desk run lint` | 0 | confirmed |
| security_audit | `npm --prefix desk audit` | 0, no vulnerabilities | confirmed |
| test_file | `npm --prefix desk test -- tests/clock.test.ts` | 0 | confirmed |
| manifest | `claude plugin validate .` | 0 | confirmed |
| profile parses | `node scripts/wh.js status` | 0 | confirmed |
| install, build, e2e | see profile | not run | believed, not verified |

### Decisions

| D | Decision | Recommendation | Alternative | Why |
|---|---|---|---|---|
| D1 | Autonomy level | `bounded` | `assisted` (adds G5 at every tier) | One owner, private repo, and production is a manual reinstall anyway |
| D2 | Parallel builders | 6 | 10 (template) | Fan-outs of 10 hit the usage limit on this machine |
| D3 | Paddock checks in worktrees | Builders run `npm --prefix desk install` in their worktree when a task touches `desk/` (this installs into the worktree, not the junction) | Keep plugin-only tasks in worktrees and run Paddock tasks in the main checkout | Otherwise the verifier cannot run Paddock checks on a worktree branch |
| D4 | Hooks and `wh.js` | sensitive (ask) plus a tier 2 floor | protected (deny) | Changing them is this repo's main work; denying would block every plugin change |
| D5 | `.env*` gap in `.gitignore` (K1) | Add `.env*` in the next change | Leave it; the hooks already deny writing `.env*` | The pattern is the baseline rule; the fix is one line |
| D6 | Studbook ingest of client repos (K6) | Ingest only repos whose owner has agreed, and write that down | Ingest everything registered | Client SDLC documents leave the client's repo |
| D7 | Compliance regimes | Hand to wh-compliance-mapper; expected result: none apply | Declare SOC 2 readiness now | No end-user data, but three processors (Anthropic, Supabase, GitHub) and an optional fourth (ntfy) |

### Deploy and undo

| Environment | Command | Automatic | Undo |
|---|---|---|---|
| dev | merge to `master` | yes, after G4 | `git revert <sha>` on a branch plus a PR |
| staging | none | not applicable: there is no staging | not applicable |
| prod (plugin) | `claude plugin install workhorse@workhorse --scope user`, run by the owner | no | reinstall the previous version from its tag or commit (believed; no tags exist today, confirmed) |
| prod (Paddock) | `npm --prefix desk run dist:win`, run by the owner | no | run the previous exe, which stays in `Paddock-builds` |

### Your decision

Confirm the profile by committing `.workhorse/`, `docs/sdlc/` and `CLAUDE.md`. G0 has no approval
record: the commit is the confirmation. To change anything, edit `.workhorse/profile.yml` first,
especially the protected paths and D1 to D7.

## Compliance controls

Written by wh-compliance-mapper on 2026-09-27. This is a flag, not a determination: the owner (or,
for any repo other than this one, that client's legal, privacy or compliance owner) decides which
regimes actually bind and signs off on the gaps below. Every "met" cites a path; every "gap" says
what would close it. Every claim is labelled **confirmed** or **believed**.

### Regime selection

No regime is selected as confirmed applicable today (`compliance.regimes: []`). Reasoning:

| Regime | Status | Why |
|---|---|---|
| `gdpr` | possibly applicable, confirm with client | Studbook's Refresh can carry a synced client repo's commit author emails and SDLC prose into Supabase us-east-1 and into Anthropic prompts (confirmed in code per K6; which repos are synced is not verified here). If any synced repo has an EU/UK data subject, GDPR attaches to that data regardless of WorkHorse's own US jurisdiction. This profile's own data (the owner's name and email) is the owner processing their own data with their own tool; that is a weak GDPR trigger at best (believed, not a legal determination). |
| `soc2` | possibly applicable, confirm with client | Not adopted (no auditor, no customer contract). The pipeline already produces SOC2-shaped change-management evidence (`brief.md`/`spec.md`/`plan.md`/`verification.md`/`ship.md`/`approvals.md` per change; append-only `approvals.md`, confirmed `scripts/wh.js` line 325 and `hooks/tests/run.js`). Flagging so the owner can decide once, deliberately, rather than half-adopting it by accident. |
| `iso27001` | possibly applicable, confirm with client | Same reasoning as `soc2`: flagged only in case the owner later offers a WorkHorse-run pipeline as assurance evidence to an outside client with an ISO 27001 requirement. |
| `hipaa` | not applicable | No health, treatment or payment information anywhere in the data inventory (`docs/sdlc/codebase-map.md` Data inventory table, confirmed: no such field or flow exists). |
| `pci-dss` | not applicable | No cardholder data path; no payment processing anywhere in the stack (confirmed, same table). |
| `financial` | not applicable | No ledger, balance, pricing or eligibility decision in the codebase; nothing here moves money (confirmed). |
| `ccpa` | not applicable | No California consumer data; no end users at all by design (confirmed, `codebase-map.md` Data inventory: "No end-user personal data by design"). |

### Special-category and residency findings

- **Special categories:** none found in this repo's own data (believed: no field and no inferable
  grouping surfaced by reading `codebase-map.md`'s Data inventory table). Watch point, not a
  finding: if a client repo is synced into Studbook, that repo's own SDLC prose could reveal a
  special category by inference (for example a brief describing a health-data feature) even though
  WorkHorse's own repo has none. That risk belongs to the synced repo's own profile, not this one.
- **Data residency:** Studbook corpus (SDLC docs, commit messages, embeddings) sits in Supabase
  Postgres `us-east-1` (confirmed, `studbook/docs/hosted-config.md` per `codebase-map.md`).
  Anthropic API and GitHub are US-region processors (believed, no explicit region pin found in the
  repo). No residency requirement is documented because there is no end-user personal data and the
  owner states US jurisdiction with no end users (`constraints.md` Business constraints) — that
  statement is the owner's, not an independently verified legal determination.

### Controls triggered today, by regime

None of the three flagged regimes are confirmed, so nothing below is a compliance "gap" against a
binding obligation. It is a readiness list: what is already true, what would need to be true if the
owner confirms one of the flagged regimes, and which phase checks it.

**If `gdpr` is confirmed** (checked by the constraint auditor at Design, the security reviewer
before Ship):

| Control | Status | Evidence / gap | Phase |
|---|---|---|---|
| Subprocessor disclosure (Art. 28) | met | Anthropic, Supabase, GitHub and (if configured) ntfy and a tracker are named with their data flows in `docs/sdlc/codebase-map.md` Data inventory and the architecture diagram | Design (constraint auditor) |
| International transfer mechanism (Ch. V) | unknown | Supabase us-east-1 and Anthropic/GitHub US hosting have no documented transfer mechanism (adequacy decision or SCCs) because no EU/UK data subject has been confirmed yet | Design (constraint auditor), then Ship (security reviewer) if a synced repo is confirmed to carry EU/UK data |
| Retention and deletion (Art. 5, 17) | gap | No documented retention period or deletion job for Studbook's Supabase store; `git ls-files`/`hosted-config.md` show no retention policy | Ship (security reviewer) |
| Data subject rights (Art. 15-22) | gap | No export or erasure path exists for Studbook-ingested content; the store has RLS and reader/ingest role separation (confirmed, `hosted-config.md`) but no per-repo or per-author erasure job | Ship (security reviewer) |
| Purpose limitation (Art. 5) | met | Studbook's stated purpose (RAG over SDLC history) is documented in `docs/sdlc/codebase-map.md` and `studbook-project.md`-style notes; ingestion is opt-in per repo registration, not automatic for every file on disk | Design (constraint auditor) |

**If `soc2`/`iso27001` is confirmed** (checked by the security reviewer before Ship, the shipper at
Deploy for tier 3):

| Control | Status | Evidence / gap | Phase |
|---|---|---|---|
| Change management evidence (CC8) | met | Every change produces `brief.md`, `spec.md`, `plan.md`, `verification.md`, `ship.md`, `approvals.md` under `docs/sdlc/<id>/` (confirmed, README and `scripts/wh.js`) | Ship (security reviewer) |
| Approval record with identity (CC6) | met | `approvals.md` is appended by `wh.js approve`, recording the approver's git `user.email`, time, and artifact hash (confirmed, `scripts/wh.js` line 325, `hooks/tests/run.js`) | Ship (security reviewer) |
| Branch protection binds admins (CC6) | gap | Branch protection on `master` requires the `plugin` and `desk` checks but does not bind admins, so a direct push bypasses required checks (confirmed via `gh api`, K8 in this document) | Ship (security reviewer); Deploy (shipper) at tier 3 |
| Dependency vulnerability management (CC7) | met | `npm --prefix desk audit` runs and is asserted in CI with a non-zero test-count guard (confirmed, `ci.yml`, K-table "CI count guards") | Ship (security reviewer) |
| Application error tracking (CC7 / A1) | gap | Paddock has no error tracking; failures go to `console.error` in main, unread in a packaged app (believed, K3 in this document) | Ship (security reviewer) |
| `security.txt` disclosure contact (CC-adjacent good practice) | gap | No `.well-known/security.txt` in the repo (confirmed, K9) | Ship (security reviewer) |
| Hosted config recorded in the repo (CC-adjacent good practice) | gap | No `docs/hosted-config.md` in this repo for GitHub branch-protection settings, Supabase project settings referenced only via the separate Studbook repo (confirmed, K9) | Design (constraint auditor) |

### Tier floor proposals

No regime is confirmed today, so no new `tier_floor_paths` entries are proposed. If `gdpr` is
confirmed for a synced repo, `desk/src/main/studbook/**` (already tier 2) would be the candidate
for a tier 3 floor, because it is the ingest path that decides what leaves a client's repo; that
change should wait for the confirmation, not precede it.

### Top three gaps (for the report)

1. No retention or deletion job exists for Studbook's Supabase store (matters if `gdpr` is
   confirmed; also a general data-hygiene gap regardless of regime).
2. Branch protection does not bind admins, so the one documented change-management control (CC8/
   CC6) can be silently bypassed (K8).
3. No `.well-known/security.txt` and no `docs/hosted-config.md`, both cheap defaults this profile's
   own baseline rules call for from week one.

### Questions for the client (the owner)

1. Which repos are synced into Studbook today, and does any of them have an EU/UK data subject in
   its commit history or SDLC prose? (Needed to resolve whether `gdpr` moves from "possibly
   applicable" to "applicable.")
2. Is WorkHorse's artifact chain ever going to be presented to an outside party as SOC 2 or ISO
   27001 evidence? If yes, `soc2`/`iso27001` should be adopted deliberately, including the gaps
   above, rather than left as an incidental byproduct.
3. Should Studbook's Supabase store have a stated retention period and a deletion job, independent
   of whether any regime is ultimately confirmed?
