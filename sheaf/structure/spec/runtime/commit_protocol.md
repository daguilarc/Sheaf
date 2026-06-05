# Commit Protocol

The commit protocol defines when agent worktrees create Git commits and how those commits are named.

## Commit Reasons

Commits happen for two reasons:

- Processing is complete.
- Administrative work requires a commit.

Administrative commits include:

- Receiving a `commit` message.
- Receiving a `merge` message.
- Launching a sub-agent.
- Preparing for a merge.

## Commit Name

The commit name is formed from:

```text
<agent_name>: <commit_reason>
```

The `agent_name` is the canonical name of the agent.

The `commit_reason` describes why the commit is being created.

Examples include:

- `finished`
- `launching <name>`
- `merging <name>`
- `commit message`
- `merge message`

## Commit Summary

Processing-complete commits use the contents of the agent worktree's `done` file as the commit summary.

Administrative commits require no summary.

## Parent Launching Child

When a parent launches a child, the resulting diff must not be empty.

Launching a child requires, at minimum, writing the sub-agent's name into the parent's agent directory.

Because of that write, parent launch-child commits always have a non-empty diff.

