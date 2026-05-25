# Extension UI and Tool Fixes

## Overview

The VS Code extension should receive a small set of quality-of-life fixes for the
realtime chat UI and the `sheaf VS Code` tool surface. The changes are scoped to:

- session button color state
- realtime chat follow mode
- `list_files` result limiting behavior
- a new `rgrep_files` tool for `rgrep --files` style file discovery
- a new `ogrep` tool with configurable binary path

These changes extend the existing extension behavior without changing the
realtime session lifecycle or the existing `modifyFile` contract.

## Session Button Colors

The chat pane controls should visually communicate whether a realtime session is
running.

Behavior:

- When the session is inactive (`idle`), the start/stop button should use an
  inactive or neutral color treatment.
- When the session is active (`active`), the start/stop button should use a
  distinct active/running color treatment.
- During transient states (`starting` and `stopping`), the button remains
  disabled and should use a disabled/transient treatment that does not imply a
  stable running or stopped state.
- The commit/respond button remains enabled only while the session is active.
  Its color should continue to communicate a secondary action.
- Color choices should use VS Code theme variables where possible so the control
  remains legible in light, dark, and high-contrast themes.

Acceptance criteria:

- The start/stop button is visibly different when `sessionState` is `idle` versus
  `active`.
- The disabled transient states cannot be confused with a clickable active or
  idle state.
- Existing keyboard shortcuts and command behavior are unchanged.

## Chat Follow Mode

The realtime chat window should support follow mode. Follow mode means new chat
content automatically scrolls to the bottom as bubbles are appended or updated.

State:

```ts
export interface ChatFollowState
{
  following: boolean;
}
```

Behavior:

- Follow mode should be active by default when the chat view is first opened.
- If the user scrolls all the way to the bottom, follow mode becomes active.
- If the user scrolls up from the bottom, follow mode becomes inactive.
- When follow mode is active and a new snapshot renders, the bubble list should
  scroll to the bottom after DOM updates are applied.
- When follow mode is inactive, rendering a new snapshot must preserve the user's
  current scroll position as much as practical.
- The bottom threshold should allow a small tolerance so sub-pixel layout,
  fractional zoom, and font rendering do not prevent follow mode from activating.
  A threshold around 4 px is acceptable.
- The implementation should not request focus, move editor focus, or interrupt
  keyboard interaction outside the webview.

Indicator:

- Show a small, unobtrusive icon in the chat pane indicating whether follow mode
  is active.
- The indicator should not be a large primary action and should not compete with
  the session controls.
- The icon should have an accessible label or title such as `Follow mode on` or
  `Follow mode off`.
- It is acceptable for the indicator to be read-only in this slice. Toggling
  follow mode by clicking the indicator is optional and can be deferred.

Acceptance criteria:

- Opening the chat view and receiving messages scrolls to the newest content by
  default.
- Scrolling up disables auto-follow.
- Scrolling back to the bottom re-enables auto-follow.
- The chat pane displays a compact visual indicator for the current follow-mode
  state.

## List Files Limit

The existing `list_files` tool should have a hard maximum listing limit of 1,000
entries.

Tool name:

```text
list_files
```

Arguments:

```ts
export interface ListFilesArgs
{
  directory: string;
  recursive?: boolean;
  includeHidden?: boolean;
  maxEntries?: number;
}
```

Behavior changes:

- `maxEntries` may be omitted, but the effective maximum must never exceed
  1,000.
- If `maxEntries` is provided and is greater than 1,000, return a structured
  error instead of clamping silently.
- If listing discovers more than the effective maximum, return a structured
  error instead of returning a truncated result.
- When the discovered file count is greater than 1,000, the error message must be
  exactly:

```text
Please reduce max depth.
```

- The tool should avoid walking the entire workspace once it can prove the limit
  has been exceeded.
- Existing path validation, hidden-file behavior, ignored directory behavior, and
  ordering expectations remain in force for successful responses.

Result on success:

```ts
export interface ListFilesResult
{
  directory: string;
  recursive: boolean;
  truncated: false;
  entries: FileEntry[];
}
```

Error behavior:

```ts
export interface ToolError
{
  code: string;
  message: string;
  details?: Record<string, unknown>;
}
```

The preferred error code for exceeding the limit is `too_many_results`.

Acceptance criteria:

- `list_files` returns at most 1,000 entries.
- More than 1,000 discovered entries returns `code: "too_many_results"` and
  `message: "Please reduce max depth."`.
- Tests cover exact-bound behavior: exactly 1,000 entries succeeds, 1,001 entries
  fails.

## Rgrep Files Tool

The existing `rgrep` tool searches file contents. It does not currently expose a
mode equivalent to `rgrep --files`, so this quest should add a new tool rather
than overloading content search.

Tool name:

```text
rgrep_files
```

Purpose:

Return workspace-relative file paths that match the same file discovery scope the
content-search `rgrep` tool would search, without searching inside file contents.
This is the voice-tool equivalent of asking "what files would rgrep search?" or
using an `rgrep --files` style operation.

Arguments:

```ts
export interface RgrepFilesArgs
{
  directory?: string;
  fileGlob?: string;
  includeHidden?: boolean;
  maxFiles?: number;
}
```

Behavior:

- `directory` limits discovery to a workspace-relative directory. If omitted,
  discover files across the workspace.
- `fileGlob` optionally limits matched files using VS Code-compatible glob
  semantics. If omitted, use the existing all-file discovery pattern.
- `includeHidden` defaults to `false` and should preserve the extension's current
  hidden-file and common-ignore behavior.
- `maxFiles` defaults to an implementation-defined bounded value.
- `maxFiles` must be a positive integer.
- The tool must use the same VS Code workspace file discovery approach as the
  current `rgrep` implementation, not shelling out to an external command.
- Results should be sorted lexicographically by workspace-relative path.
- If more files are discovered than `maxFiles`, omit additional entries and set
  `truncated: true`.

Result:

```ts
export interface RgrepFilesResult
{
  directory?: string;
  fileGlob?: string;
  truncated: boolean;
  files: string[];
}
```

Error behavior:

- Invalid directories return the existing path-related tool errors.
- Invalid `maxFiles` returns `code: "invalid_range"`.
- The tool should use the shared `ToolError` shape.

Acceptance criteria:

- `rgrep_files` is registered in the `sheaf VS Code` tool call set.
- The built-in system prompt mentions `rgrep_files` as the file-listing companion
  to content-search `rgrep`.
- Tests cover workspace-wide discovery, directory-limited discovery, glob
  filtering, and truncation.

## Ogrep Tool

Add an `ogrep` tool to the `sheaf VS Code` tool call set. This tool delegates to
the external `ogrep` binary and returns structured results to the realtime model.

Configuration:

```json
{
  "sheaf.realtime.ogrepPath": "/Users/joyo/.local/bin/ogrep"
}
```

The default configured path should be:

```text
/Users/joyo/.local/bin/ogrep
```

Planner instruction:

If the configured `ogrep` path is missing, not executable, incompatible with the
current platform, or otherwise affected by path/environment issues, the planner
must raise a human intervention request. The planner must not attempt complex
path manipulation, PATH probing, symlink creation, shell-profile edits, package
installation, or other environment repair.

Tool name:

```text
ogrep
```

Arguments:

```ts
export interface OgrepArgs
{
  pattern: string;
  file?: string;
  directory?: string;
  fileGlob?: string;
  caseSensitive?: boolean;
  maxMatches?: number;
}
```

Behavior:

- `pattern` is required and is passed to `ogrep`.
- `file` optionally limits the search to one workspace-relative file.
- `directory` optionally limits the search to one workspace-relative directory.
- `file` and `directory` are mutually exclusive. Providing both returns
  `code: "invalid_range"`.
- `fileGlob` optionally limits searched files when `directory` or workspace-wide
  search is used.
- `caseSensitive` defaults to `true`. If `ogrep` uses different flag semantics,
  the physical plan should map this option explicitly.
- `maxMatches` defaults to an implementation-defined bounded value and must be a
  positive integer.
- All accepted paths must resolve inside the VS Code workspace.
- The implementation may invoke the configured `ogrep` executable, but it must
  not execute arbitrary shell strings built from user input. Use argument arrays
  and avoid shell interpolation.
- The tool should bound output size and runtime so a broad query cannot freeze
  the extension host.

Result:

```ts
export interface OgrepResult
{
  pattern: string;
  file?: string;
  directory?: string;
  fileGlob?: string;
  truncated: boolean;
  matches: OgrepMatch[];
}

export interface OgrepMatch
{
  file: string;
  line?: number;
  character?: number;
  text: string;
}
```

Error behavior:

- Missing or invalid `pattern` returns `code: "invalid_pattern"`.
- Invalid path arguments return existing path-related tool errors.
- Invalid `maxMatches`, conflicting `file` and `directory`, or unsupported
  argument combinations return `code: "invalid_range"`.
- Missing, non-executable, or unusable `ogrep` configuration should be treated as
  a planning blocker per the human-intervention instruction above.

Acceptance criteria:

- `sheaf.realtime.ogrepPath` is contributed in `package.json` and read through
  the extension configuration layer.
- `ogrep` is registered in the `sheaf VS Code` tool call set.
- The `ogrep` schema includes the `file` option.
- Tests cover file-scoped search, directory-scoped search, conflicting path
  arguments, configured path use, and structured error behavior.

## Documentation and Prompt Updates

Update the extension-facing docs and built-in prompt so the agent understands the
expanded tool surface.

Required updates:

- `docs/architecture/VSCODE_EXTENSION.md` lists `rgrep_files` and `ogrep`.
- `docs/product/PRD.md` and `docs/product/ROADMAP.md` reflect the new tools if
  they still enumerate the stable tool names.
- The built-in prompt mentions:
  - `list_files` fails with `Please reduce max depth.` when the request is too
    broad.
  - `rgrep` searches file contents.
  - `rgrep_files` lists searchable file paths.
  - `ogrep` can search with an optional `file` argument.

## Test Expectations

The physical plan should include focused VS Code extension tests for:

- session button color classes across `idle`, `starting`, `active`, and
  `stopping`
- chat follow mode entering and exiting based on scroll position
- follow mode indicator rendering and accessible label/title
- `list_files` exact 1,000-entry success and 1,001-entry failure
- `rgrep_files` schema, registration, discovery, filtering, and truncation
- `ogrep` schema, registration, configuration lookup, path argument validation,
  and command invocation without shell interpolation

Manual smoke coverage should include opening the chat pane, starting and stopping
a session, confirming button color changes, and verifying that incoming chat
content follows only while follow mode is active.
