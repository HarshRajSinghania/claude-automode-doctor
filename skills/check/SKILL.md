---
name: check
description: Check auto mode decisions.
disable-model-invocation: true
allowed-tools: Bash(node "${CLAUDE_PLUGIN_ROOT}/bin/claude-automode-doctor.mjs" *) Bash(node ${CLAUDE_PLUGIN_ROOT}/bin/claude-automode-doctor.mjs *) PowerShell(node "${CLAUDE_PLUGIN_ROOT}/bin/claude-automode-doctor.mjs" *) PowerShell(node ${CLAUDE_PLUGIN_ROOT}/bin/claude-automode-doctor.mjs *)
---

!`node "${CLAUDE_PLUGIN_ROOT}/bin/claude-automode-doctor.mjs" report --project "${CLAUDE_PROJECT_DIR}" --markdown`

In at most 10 lines: what the classifier refused (the command and the rule it named), which refusals were no verdict (the service, not the settings), and the one next step. If nothing was refused, say so in one line. Edit nothing until the user agrees.
