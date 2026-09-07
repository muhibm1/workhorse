---
name: intent
description: Intent phase only. Creates a WorkHorse change from "<problem> -> <outcome>", writes intent.md, classifies the risk tier, and presents G1 if the tier requires it.
disable-model-invocation: true
allowed-tools: Agent, Read, Bash(node *), Bash(git *)
---

# /workhorse:intent

Arguments: `$ARGUMENTS` = `"<problem> -> <outcome>"`.

1. `node "${CLAUDE_PLUGIN_ROOT}/scripts/wh.js" new "<short title from the outcome>"`.
2. `node "${CLAUDE_PLUGIN_ROOT}/scripts/wh.js" phase intent`.
3. Dispatch `wh-intent-writer` with the full request. Then dispatch `wh-risk-classifier`.
4. Set the tier from the classifier's report:
   `node "${CLAUDE_PLUGIN_ROOT}/scripts/wh.js" state set tier <n>` and
   `state set tier_reason "<reason>"`.
5. Run `node "${CLAUDE_PLUGIN_ROOT}/scripts/wh.js" required`. If G1 is listed, print the G1
   packet from `intent.md` and stop. Otherwise run `wh.js gate G1 auto` and tell the user the
   next step is `/workhorse:spec` or `/workhorse:run`.
