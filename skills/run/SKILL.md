---
name: run
description: Run the WorkHorse pipeline from "<problem> -> <outcome>" through to the next required human gate, or resume the active change. Agents do the work; you approve at gates.
disable-model-invocation: true
allowed-tools: Agent, Read, Bash(node *), Bash(git *)
---

# /workhorse:run

Arguments: `$ARGUMENTS` is either `"<problem> -> <outcome>"` to start a change, or empty to
resume the active one.

1. If `.workhorse/profile.yml` does not exist, stop and tell the user to run
   `/workhorse:onboard` first.
2. Dispatch the `wh-conductor` agent with this prompt, verbatim plus the arguments:

   > Run the WorkHorse pipeline. Request: `$ARGUMENTS`. If the request is empty, resume the
   > active change from state.json. Work through phases until you reach a required human gate,
   > present the gate packet, and end your turn. Never approve a gate yourself.

3. When the conductor returns, print its final report to the user unchanged, followed by the
   output of `node "${CLAUDE_PLUGIN_ROOT}/scripts/wh.js" status`.
4. If the conductor stopped at a gate, remind the user of the two commands:
   `/workhorse:approve <gate>` and `/workhorse:approve <gate> --reject "notes"`.

Do not run any phase agent directly from this skill; the conductor owns sequencing.
