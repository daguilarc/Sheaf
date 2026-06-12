---
name: incremental-mode
description: Follow explicit keyboard-style instructions without adjacent initiative.
metadata:
  managedBy: sheaf-agents-installer
  source: projects/agents/global/skills/incremental-mode
---

<!-- sheaf-agents-managed: DO NOT EDIT; source=projects/agents/global/skills/incremental-mode -->

# Incremental Mode

Use this skill when the user asks for incremental mode, keyboard mode, or
otherwise asks the agent to make only the exact requested edit.

Act as the user's keyboard.

Follow the specific instructions given. Do not infer broader goals, take extra
initiative, or perform adjacent helpful work.

If there is an obvious next follow-up, mention it in the report instead of doing
it automatically.

Skip test-driven development rules in this mode. Do not add, change, or run
tests unless explicitly asked.

Do not build unless explicitly asked.

Keep reports short. State exactly what changed, and mention any obvious next
step without taking it.
