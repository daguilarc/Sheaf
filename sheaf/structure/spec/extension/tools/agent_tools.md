# Agent Tools

Agent tools are scoped to the current agent.

The Pi harness provides the current agent directory and current agent worktree to agent tools.

Agents do not pass agent directory or worktree paths as tool input.

## Complete Agent

Marks the current agent as complete.

Input schema:

```json
{
  "description": "string"
}
```

Behavior:

- Creates `done` in the current agent directory.
- Creates `done` at the root of the current agent worktree.
- Writes `description` to both `done` files.
- The worktree root `done` file remains git ignored.

## Start Subagent

Starts a new subagent for the current agent.

Input schema:

```json
{
  "profile": "string",
  "context": "string|null"
}
```

Behavior:

- Looks up `profile` in the named subagent profiles available to the current agent.
- Creates a directory for the new subagent in the current task's `agents` directory.
- Initializes the subagent directory to its initial state.
- Records the new subagent in the current agent's `sub-agents` file.
- Creates a new directory in the worktrees directory for the subagent.
- Adds the subagent worktree to Git so the worktree is tracked.
- Has the runtime create a new subagent object from the selected profile.
- Starts the subagent with its base prompt and the provided `context`.
- Returns after the subagent has started.

The tool does not wait for the subagent to finish.

When the subagent completes, it merges back into the parent agent through the merge protocol.

## Message Subagent

Sends an asynchronous message to a subagent.

Input schema:

```json
{
  "subagent": "string",
  "message": "string"
}
```

Behavior:

- Enqueues a `parent` message for the subagent.
- Returns after the message is enqueued.
- Does not wait for the subagent to process the message.
- Does not wait for the subagent to respond.

When the subagent produces an assistant message, the runtime queues that response back to the parent as a `child` message.

## Fast Forward Subagent

Fast-forwards a subagent onto the current agent.

Input schema:

```json
{
  "subagent": "string"
}
```

Behavior:

- Attempts to fast-forward the subagent branch to the current agent's branch.
- Fails if the subagent cannot be fast-forwarded cleanly.
- Does not send a message to the subagent.
- Sends a merge method to all remaining active subagents so they can be fully caught up. 

## Disband Subagent

Disbands a subagent.

Input schema:

```json
{
  "subagent": "string"
}
```

Behavior:

- Sends a disband message to the subagent subagent.
- Marks the subagent as disbanded in the current agent's `sub-agents` file.
- If the subagent has not been fast-forwarded, all of its work will be lost.

