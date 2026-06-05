# Task Structure

A task is a subdirectory of a project's `tasks` directory, or a descendant directory beneath it.

## Task Directory Name

The task directory name is formed from an ISO timestamp, an underscore, and the task slug:

```text
<iso_timestamp>_<task_slug>
```

## Task Names

Task names do not include the full directory structure.

A nested task name uses dots to separate task and subtask names:

```text
parenttask.subtask.subsubtask
```

Relative task names are allowed when the current task context is known.

The `..` segment moves up one task level.

## Task Contents

Each task directory contains:

- `status`: the current task status.
- `description.md`: the task description.
- `type`: the task type.
- `agents/`: agent-specific task activity and outputs.
- `issues/`: per-agent issue files and matching response files.
- Task configuration.

## Configuration

Each task has configuration associated with it.

Task configuration should be represented consistently with the broader Sheaf configuration model, using JSON where practical.

