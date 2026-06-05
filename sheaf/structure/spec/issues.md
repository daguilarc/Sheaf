# Issue Structure

Task issues are stored in the task's `issues` subdirectory.

There can be multiple issues files in a task. Each issues file is named after the agent that opened the issues, and each issues file has a matching responses file.

## File Names

The file stem identifies the agent that opened the issues.

When used as an issues file stem, the agent's canonical name must be represented in a filesystem-safe form.

```text
<task_dir>/issues/<agent_name>.md
<task_dir>/issues/<agent_name>_responses.md
```

The `<agent_name>.md` file records issues opened by that agent.

The `<agent_name>_responses.md` file records responses to those issues.

## Issues File Schema

Each issues file is Markdown with a fixed top-level heading and one section per issue.

```markdown
# Issues

## Issue <ISSUE_ID>

- status: open|completed
- owner_role: <agent role>
- created_at: <ISO-8601 UTC timestamp>
- updated_at: <ISO-8601 UTC timestamp>
- title: <short title>
- details: <markdown text>
- resolution_notes: <markdown text or none>
```

Field rules:

- `status` may only be `open` or `completed`.
- `owner_role` is the role of the agent that opened the issue.
- `created_at` and `updated_at` are ISO-8601 UTC timestamps.
- `title` is a short human-readable issue summary.
- `details` is Markdown and may span multiple lines.
- `resolution_notes` is Markdown and may span multiple lines.
- `resolution_notes: none` means the field is unset.

## Responses File Schema

Each responses file is Markdown with a fixed top-level heading and one section per issue response.

```markdown
# Issue responses

## Response <ISSUE_ID> <ISO-8601 UTC timestamp>

- issue_id: <same id as in the matching issues file>
- outcome: Fixed|NotFixed
- explanation: <markdown text>
```

Field rules:

- `issue_id` must match an issue heading in the matching issues file.
- `outcome` may only be `Fixed` or `NotFixed`.
- `Fixed` means the responder believes the issue is fully addressed.
- `NotFixed` means the responder did not address the issue.
- `explanation` is required non-empty Markdown.
- The response heading timestamp should be an ISO-8601 UTC timestamp.

Multiple responses may exist for the same `issue_id` across response rounds.

## Empty Files

If no issues have been opened yet, an issues file may be absent or contain only:

```markdown
# Issues
```

If no responses have been written yet, a responses file may be absent or contain only:

```markdown
# Issue responses
```


