# Merge Protocol

The merge protocol is message driven.

When an agent receives a merge message, it rebases its current branch onto the commit hash provided by that message.

The result is that the receiving agent's changes are replayed on top of the received commit's changes.

## Merge Message

A merge message contains a commit hash.

```json
{
  "id": "<message-id>",
  "type": "merge",
  "payload": {
    "commit": "<commit-hash>"
  }
}
```

## Rebase Behavior

When a merge message is processed:

1. Commit any uncommitted changes in the receiving agent's worktree.
2. Rebase the receiving agent's current branch onto the received commit.
3. Continue processing messages after the rebase completes.

If the rebase produces conflicts, the runtime runs the rebase workflow.

## Rebase Workflow

The rebase workflow runs an agent with tools that allow it to:

- Read rebase errors.
- Fix rebase conflicts.

The agent is started with a prompt instructing it to fix the rebase errors.

After the agent fixes the conflicts, it exits and the runtime completes the rebase.

This process may take multiple iterations.

