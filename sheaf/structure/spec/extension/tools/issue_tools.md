# Issue Tools

Issue tools are the only supported way for agents to create, update, or inspect task issue files and response files.

The tools operate on the issue file schema documented in `../../issues.md`.

## Common References

The Pi harness provides the current task directory to each issue tool.

The Pi harness provides the current agent directory to each issue tool.

Agents do not pass task directory or agent directory paths as tool input.

Tools identify an issue by its issue id within the current task. If an issue id is missing or ambiguous, the tool fails without writing.

## Open Issue

Creates a new issue in the issue file for the agent opening the issue.

Input schema:

```json
{
  "title": "string",
  "details": "string"
}
```

Behavior:

- Creates the agent's issue file if it does not exist.
- Uses the current agent from the Pi harness as the opening agent.
- Adds a new `open` issue.
- Sets `owner_role` from the opening agent profile.
- Sets `created_at` and `updated_at` to the tool execution time.
- Sets `resolution_notes` to `none`.
- Returns the created issue id.

## Respond To Issue

Appends a response to the matching responses file for an issue.

Input schema:

```json
{
  "issue_id": "string",
  "outcome": "Fixed|NotFixed",
  "explanation": "string"
}
```

Behavior:

- Creates the matching responses file if it does not exist.
- Appends a response for `issue_id`.
- Uses the tool execution time in the response heading.
- Requires `explanation` to be non-empty.
- Does not change issue status.

## Read Issues

Reads issues for a task.

Input schema:

```json
{
  "open_only": "boolean"
}
```

Behavior:

- Reads all issue files in the task's `issues` directory.
- When `open_only` is true, returns only issues whose status is `open`.
- Includes the issue file and agent name for each returned issue.

## Read Responses

Reads issue responses for a task.

Input schema:

```json
{
  "open_issues_only": "boolean"
}
```

Behavior:

- Reads all responses files in the task's `issues` directory.
- When `open_issues_only` is true, returns only responses whose `issue_id` belongs to an issue that is currently `open`.
- Includes the responses file and matching issue file for each returned response.

## Close Issue

Marks an issue as completed.

Input schema:

```json
{
  "issue_id": "string",
  "resolution_notes": "string"
}
```

Behavior:

- Updates the issue status to `completed`.
- Replaces `resolution_notes` with the provided notes.
- Updates `updated_at` to the tool execution time.

## Edit Issue Details

Replaces the details for an existing issue.

Input schema:

```json
{
  "issue_id": "string",
  "details": "string"
}
```

Behavior:

- Replaces the issue's `details` field with the provided details.
- Updates `updated_at` to the tool execution time.
- Does not change issue status or resolution notes.

