# Runtime Module

The runtime module contains the Sheaf runtime model and orchestration protocols.

The runtime handles agent orchestration, including using the Pi agents SDK, representing agents, managing worktrees, committing agent work, and merging child agent work back into parent agents.

## Agent Runtime Object

The runtime module includes a Node struct or equivalent object representing an agent.

At minimum, the agent runtime object contains:

- `name`: canonical agent name.
- `profile`: static agent profile.

## Runtime Protocols

- `agent_worktrees.md`: worktree layout and runtime execution context.
- `agent_messages.md`: asynchronous parent and child agent messages.
- `message_queue.md`: JSONL message queues and message routing.
- `crash_resistance.md`: replay behavior for reasonable crash resistance.
- `commit_protocol.md`: commit reasons and commit message format.
- `merge_protocol.md`: merge-message rebase behavior.

