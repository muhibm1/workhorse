# Evals: Studbook tools for designer and discovery analyst

Change id: `2026-09-29-studbook-tools-for-designer-and-discovery-analys`
Spec: [spec.md](./spec.md)

The change is prose and frontmatter in two agent files, so every case is a command run from the
repository root with an expected result. "The bullet" means the line containing
`Engineering record (Studbook)` and the 7 lines after it (`grep -A7`), which R7 bounds.
Each required phrase must sit on one line so a line search finds it.

## Targets

| Category | Target | Rationale |
|----------|--------|-----------|
| Golden | 100% pass | Both agents list the tools and carry the instruction |
| Edge | 100% pass | Tools absent or failing; scope of the diff |
| Failure | 100% correct handling | Plugin still validates and its suite passes |
| Adversarial | 100% rejected | Record text treated as data, never instructions |
| Non-functional | see rows | Prompt size each session pays for |

## Cases

| ID | Category | Given | When | Then | Maps to requirement | Implemented as |
|----|----------|-------|------|------|---------------------|----------------|
| E1 | golden | the changed `agents/wh-designer.md` | its `tools:` line is compared with spec Interfaces | exactly equal; 1 matching line | R1 | `grep -cxF "<designer tools line from spec Interfaces>" agents/wh-designer.md` prints 1 |
| E2 | golden | the changed `agents/wh-discovery-analyst.md` | its `tools:` line is compared with spec Interfaces | exactly equal; 1 matching line | R2 | `grep -cxF "<analyst tools line from spec Interfaces>" agents/wh-discovery-analyst.md` prints 1 |
| E3 | golden | the designer's Inputs bullet | searched for `mcp__studbook__search_record`, `mcp__studbook__ask_record`, `at most 3 search_record calls and 1 ask_record call`, `own_change_id` | all 4 phrases found within the bullet; the lead appears exactly once in the file | R3 | `grep -A7 "Engineering record (Studbook)" agents/wh-designer.md \| grep -cF "<phrase>"` is at least 1 for each phrase; `grep -c "Engineering record (Studbook)" agents/wh-designer.md` prints 1 |
| E4 | golden | the analyst's Inputs bullet | searched for the two tool names and the call cap phrase | all 3 found within the bullet; lead appears once | R3 | same commands against `agents/wh-discovery-analyst.md` |
| E5 | edge | both bullets | searched for `continue without it` | found in both (2 of 2 files) | R4 | `grep -A7 "Engineering record (Studbook)" <file> \| grep -cF "continue without it"` is at least 1 per file |
| E6 | adversarial | both bullets | searched for `untrusted data` and `believed, not verified` | both phrases found in both bullets (4 of 4) | R5 | `grep -A7 "Engineering record (Studbook)" <file> \| grep -cF "<phrase>"` is at least 1 per file and phrase |
| E7 | edge | the change branch | files under `agents/` differing from master are listed | exactly 2: the two agent files | R6 | `git diff --name-only master...HEAD -- agents/` prints those 2 paths and nothing else |
| E8 | failure | the change branch | the plugin suite and manifest check run | both exit 0 | R6 | `npm test` exit 0 (includes "every agent file name matches its frontmatter name"); `claude plugin validate .` exit 0 |

## Non-functional

| ID | Measure | Target | How measured |
|----|---------|--------|--------------|
| N1 | Lines added per agent file | at most 8 each; 0 lines removed other than the replaced `tools:` line | `git diff --numstat master...HEAD -- agents/wh-designer.md agents/wh-discovery-analyst.md`: added at most 9, deleted at most 1 per file |

## Failure taxonomy

| Class | Description | Detection | Example |
|-------|-------------|-----------|---------|
| missing result | Agent never sees the tools (wrong prefix, server absent, permission refused) | Agent report says the record was not consulted; Studbook server log has no call | Server registered under another name on a client machine |
| wrong result | Agent repeats a stale or irrelevant record passage as fact | Claim in a spec not labelled `believed, not verified`; caught at G2 | Old decision later superseded by an ADR |
| slow | Record calls add minutes to a design session | `wh.js clock` design-phase agent minutes over budget | `ask_record` model call plus retrieval on a cold start |
| leaked | Client request text sent to Anthropic by `ask_record` beyond what the run already sends | Studbook server log line per `ask_record` call | Not new: the run already sends the request to the same processor |
| unauthorised | Agent follows instructions embedded in a record passage | Review of the agent's actions against its role; G2 reading | A retro quoting a prompt injection |
