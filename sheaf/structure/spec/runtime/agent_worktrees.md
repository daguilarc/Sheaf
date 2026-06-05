# Agent Worktrees

Each agent runs in its own worktree.

The worktree is named after the agent's canonical name, represented in a filesystem-safe form.

## Worktree Location

Agent worktrees are stored outside the main repository, in a sibling directory.

That sibling directory contains a `worktrees` subdirectory with one worktree per agent.

```text
<main_repo_parent>/
  <main_repo>/
  <sibling_directory>/
    worktrees/
      <agent_name>/
```

## Runtime

Inside each worktree, the runtime runs the agent through the Pi agents SDK.

The runtime is responsible for preparing the agent context and invoking the SDK.

## Worktree Root Files

The worktree root contains:

- `profile.json`: copy of the agent profile.
- `done`: created when the agent completes its task.

These files must be git ignored.

## Agent Run Sequence

An agent run consists of:

1. Prepare the agent context.
2. Invoke the Pi agents SDK with that context.
3. Record completion when the SDK run completes.

## Agent Context

When the agent starts, the runtime provides context that includes:

- The agent's identity.
- The location of the agent directory.
- The tools available to the agent.

The agent harness determines its task directory from the parent directory of its agent directory.

