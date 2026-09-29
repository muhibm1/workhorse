# 0001: List the Studbook tools by exact name in the two agents' tool allowlists

Date: 2026-09-29
Status: proposed
Change: 2026-09-29-studbook-tools-for-designer-and-discovery-analys

## Context

R1 and R2 give `wh-designer` and `wh-discovery-analyst` the Studbook tools. Both agents already
restrict themselves with a `tools:` allowlist (`agents/wh-designer.md` line 4,
`agents/wh-discovery-analyst.md` line 4). `wh-tracker-sync` takes the other route: it drops the
allowlist and inherits every MCP tool, because the Notion connector's prefix differs per
surface. The Studbook server is registered at user scope as `studbook` (confirmed), which gives
the prefix `mcp__studbook__` (believed, not verified against the harness docs).

## Decision

We append `mcp__studbook__search_record` and `mcp__studbook__ask_record` to each agent's
existing `tools:` line and keep the allowlist. An agent on a machine without the server, or with
it registered under another name, simply does not see the tools and continues without them (R4).

## Alternatives

| Option | Why not |
|--------|---------|
| Remove the allowlist and inherit all MCP tools, as `wh-tracker-sync` does | Hands both agents every MCP server on the machine, including write-capable Supabase, GitHub and Notion tools, for a need that is two read-only tools. |
| List a wildcard for the server | the harness's support for wildcards in subagent `tools:` is not confirmed; an unsupported pattern would silently grant nothing. |

## Consequences

The agents gain exactly two read-only tools and nothing else. The cost: the name is tied to the
server being registered as `studbook`. A client machine that registers it under another name, or
installs it as a plugin (prefix `mcp__plugin_<plugin>_<server>__`), gets no Studbook access until
these lines are updated. Revisit if Studbook is ever shipped as part of the WorkHorse plugin.
