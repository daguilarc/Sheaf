# Issues

## Issue QP-0001

- status: open
- owner_role: polisher_reviewer
- created_at: 2026-05-23T22:23:35Z
- updated_at: 2026-05-23T22:23:35Z
- title: Outside-workspace editors can produce freshness pushes
- details: `FreshnessService.WorkspaceFileRelative()` treats any non-empty value from `VscodeFreshnessHost.asRelativePath()` as a workspace-relative path unless it contains `..`. The production host implements that method as `vscode.workspace.asRelativePath(uri, false)`, which is not a reliable workspace-membership check for files opened outside the workspace; those files can produce non-empty absolute or display paths. As a result, a user switching to or interacting with an outside-workspace editor after the agent has observed viewport/cursor context can emit `viewport_changed_since_last_check` or `cursor_changed_since_last_check` pushes with an outside-workspace path in `payload.file`. This violates the physical plan's change-event filtering requirement to ignore document URIs not inside the workspace, and it risks leaking absolute local paths to the model. The current fake host masks this because it returns an empty string for outside-root URIs, so test coverage does not catch the production behavior.

  To mark this issue `completed`, the freshness host/service must perform an explicit workspace containment check for `file` URIs before returning or accepting a relative path, outside-workspace active-editor/document/visible-range/selection events must be ignored, and tests should cover an outside-workspace editor/document using behavior that matches production rather than relying only on an empty fake `asRelativePath()` result.
- resolution_notes: none
