# Task Tools

Task tools are the supported way for agents to create and inspect task directories.

The tools operate on the task structure documented in `../../task.md`.

The Pi harness provides the current project directory and current task directory to task tools.

Agents do not pass project directory or task directory paths as tool input.

## Create Task

Creates a new task directory.

Input schema:

```json
{
  "parent": "current_task|top_level",
  "slug": "string",
  "description": "string",
  "type": "string",
  "configuration": "object"
}
```

Behavior:

- Creates a task directory named `<iso_timestamp>_<task_slug>`.
- If `parent` is `current_task`, creates the task as a descendant of the current task.
- If `parent` is `top_level`, creates the task as a top-level task under the current project's `tasks` directory.
- Creates the task's required files and subdirectories.
- Writes `description.md` from `description`.
- Writes `type` from `type`.
- Writes task configuration from `configuration`.
- Initializes task status.
- Returns the created task directory path.

## Parent Rules

Every created task has one of two placements:

- Top-level task: `parent` is `top_level`.
- Child task: `parent` is `current_task`.

The parent relationship is represented by filesystem containment.

