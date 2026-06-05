# Agent Structure

An agent corresponds to one session with the Pi coding agent.

Agent data is stored in an agent subdirectory within a task directory.

The canonical name of an agent is its task name, a colon, and its agent name.

## Agent Directory Name

The agent directory name is formed from an ISO timestamp, an underscore, and the agent role:

```text
<iso_timestamp>_<agent_role>
```

## Agent Names

Agent names are separate from task names.

For an agent belonging to a task, the canonical name uses a colon between the task name and the agent name:

```text
task:agentname
```

The agent name after the colon is the agent's name without task nesting.

Agents have their own nested structure that is parallel to task nesting.

Subagents can also be addressed with dotted syntax:

```text
task:agent.subagent.subsubagent
```

The `..` segment moves up one agent level.

Relative agent names and dotted subagent names are allowed when the current agent context is known.

## Agent Contents

Each agent directory contains:

- `profile`: static agent profile.
- `session.jsonl`: JSONL representation of the agent session.
- `sub-agents`: sub-agents run by this agent and their statuses.
- `done`: presence of this file indicates that the agent has finished its task.

## Profile

The agent profile remains static for the life of the agent.

The profile contains:

- `role`: the agent role.
- `parent`: nullable parent agent.
- `model`: the model used by the agent.
- `effort`: the effort level used by the agent.
- `prompt`: prompts received by the agent.
- `tools`: tools the agent is allowed to use.
