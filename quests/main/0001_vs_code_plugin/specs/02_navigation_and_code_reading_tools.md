# Navigation and Code Reading Tools

## Overview

The VS Code extension must expose a small, predictable tool surface for reading
code and moving through files by voice. These tools are read/navigation focused:
they do not edit files, create files, delete files, or type code.

All paths accepted by these tools are workspace-relative unless explicitly marked
as absolute by the caller. Returned paths should be workspace-relative when the
file is inside the workspace. Tool responses should include enough editor state
for the agent to understand what changed without requiring an immediate follow-up
tool call.

All implementations must use the VS Code extension API for document, workspace,
cursor, and viewport operations. They must not directly access the filesystem,
because tool results need to reflect VS Code's active workspace, editor buffers,
unsaved changes, virtual documents, and language-service view of the project.

## Shared Types

Line and character positions are 1-based for line numbers and 0-based for
characters. This matches editor display for lines while preserving VS Code's
native character offset convention.

```ts
export interface CodePosition
{
  file: string;
  line: number;
  character?: number;
}

export interface CodeRange
{
  file: string;
  startLine: number;
  endLine: number;
}

export interface CodeLine
{
  line: number;
  text: string;
}

export interface VisibleRangeResult
{
  file: string;
  cursor: CodePosition;
  visibleStartLine: number;
  visibleEndLine: number;
  lines: CodeLine[];
}
```

Tools that accept file paths must reject paths outside the workspace unless a
future permission model explicitly allows external files.

## Code Read API

Reads a file from the workspace. The caller may request the whole file or a
specific line range.

Tool name:

```text
code_read
```

Arguments:

```ts
export interface CodeReadArgs
{
  file: string;
  startLine?: number;
  endLine?: number;
}
```

Behavior:

- If `startLine` and `endLine` are omitted, return the entire file.
- If either range bound is provided, both bounds must be validated after defaults
  are applied.
- `startLine` defaults to `1` when only `endLine` is provided.
- `endLine` defaults to the file's final line when only `startLine` is provided.
- The range is inclusive.
- Empty files return an empty `lines` array with `lineCount: 0`.
- Missing files, directories, binary files, and paths outside the workspace return
  structured tool errors.

Result:

```ts
export interface CodeReadResult
{
  file: string;
  lineCount: number;
  startLine: number;
  endLine: number;
  lines: CodeLine[];
}
```

## List Files API

Lists files and directories within a workspace directory.

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

Behavior:

- `directory` is workspace-relative and defaults are not applied by the tool.
- `recursive` defaults to `false`.
- `includeHidden` defaults to `false`.
- `maxEntries` defaults to an implementation-defined bounded value.
- Results should be sorted with directories first, then files, each group ordered
  lexicographically by path.
- The tool must respect common ignored directories such as `.git` and
  `node_modules` unless `includeHidden` or a future ignore override explicitly
  allows them.

Result:

```ts
export interface ListFilesResult
{
  directory: string;
  recursive: boolean;
  truncated: boolean;
  entries: FileEntry[];
}

export interface FileEntry
{
  path: string;
  kind: "file" | "directory";
}
```

## Rgrep API

Searches workspace files for a regular expression. This is the voice-navigation
tool for requests like "find where this function is used" or "search for TODOs in
the extension."

Tool name:

```text
rgrep
```

Arguments:

```ts
export interface RgrepArgs
{
  pattern: string;
  directory?: string;
  fileGlob?: string;
  caseSensitive?: boolean;
  maxMatches?: number;
  contextLinesBefore?: number;
  contextLinesAfter?: number;
}
```

Behavior:

- `pattern` is a regular expression string. Invalid expressions return a
  structured tool error.
- `directory` limits the search to a workspace-relative directory. If omitted,
  search the workspace.
- `fileGlob` optionally limits matched files using VS Code-compatible glob
  semantics.
- `caseSensitive` defaults to `true`.
- `maxMatches` defaults to an implementation-defined bounded value and prevents
  huge responses.
- Context line counts default to `0` and must be non-negative integers.
- The implementation must use VS Code workspace search APIs, not direct
  filesystem traversal or shell commands.
- Results should respect workspace excludes and ignored directories by default.
- Results should be ordered by file path, then line number, then character.

Result:

```ts
export interface RgrepResult
{
  pattern: string;
  directory?: string;
  fileGlob?: string;
  truncated: boolean;
  matches: RgrepMatch[];
}

export interface RgrepMatch
{
  file: string;
  line: number;
  character: number;
  text: string;
  matchText: string;
  contextBefore?: CodeLine[];
  contextAfter?: CodeLine[];
}
```

## Read Visible Range API

Reads code around the active editor cursor. This is the primary context tool for
voice interactions like "show me the code around here" or "what am I looking at?"

Tool name:

```text
read_visible_range
```

Arguments:

```ts
export interface ReadVisibleRangeArgs
{
  linesAbove: number;
  linesBelow: number;
}
```

Behavior:

- The active text editor supplies the file and cursor position.
- `linesAbove` and `linesBelow` must be non-negative integers.
- The returned range is clamped to file boundaries.
- The cursor line must be included in the returned range.
- If no text editor is active, return a structured tool error.
- The tool reads from the document buffer, not necessarily from disk, so unsaved
  editor changes are reflected in the result.

Result:

```ts
export interface ReadVisibleRangeResult extends VisibleRangeResult
{
  requestedLinesAbove: number;
  requestedLinesBelow: number;
}
```

## Set Cursor Position API

Moves the active editor cursor to a target position. It can move to an absolute
file/line location or move relative to the current cursor.

Tool name:

```text
set_cursor_position
```

Arguments:

```ts
export type CursorMoveTarget =
  | {
      mode: "absolute";
      file: string;
      line: number;
      character?: number;
    }
  | {
      mode: "relative";
      lineDelta: number;
      character?: number;
    };

export interface SetCursorPositionArgs
{
  target: CursorMoveTarget;
  reveal?: CursorRevealOptions;
  returnVisibleRange?: VisibleRangeRequest;
}

export interface CursorRevealOptions
{
  align?: "top" | "center" | "bottom" | "nearest";
}

export interface VisibleRangeRequest
{
  linesAbove: number;
  linesBelow: number;
}
```

Behavior:

- Absolute mode opens or focuses `file`, then moves the cursor to `line`.
- Relative mode uses the current active editor and moves by `lineDelta` from the
  current cursor line.
- `character` defaults to the current character in relative mode and to `0` in
  absolute mode.
- The final line and character are clamped to the target document.
- `reveal.align` controls where the cursor should appear in the viewport:
  `center` should be the default for voice navigation.
- If `returnVisibleRange` is provided, the result includes the same code region
  shape as `read_visible_range` after the move.
- If no editor is active for a relative move, return a structured tool error.

Result:

```ts
export interface SetCursorPositionResult
{
  cursor: CodePosition;
  visibleRange?: VisibleRangeResult;
}
```

## Move Viewport / Move Visible Range API

Scrolls the visible code range without moving the cursor. This lets the user say
"scroll down" or "show me 50 lines above" while preserving the edit insertion
point.

Tool name:

```text
move_visible_range
```

Arguments:

```ts
export type ViewportMoveTarget =
  | {
      mode: "absolute";
      file: string;
      line: number;
      align?: "top" | "center" | "bottom";
    }
  | {
      mode: "relative";
      lineDelta: number;
    };

export interface MoveVisibleRangeArgs
{
  target: ViewportMoveTarget;
  returnVisibleRange?: VisibleRangeRequest;
}
```

Behavior:

- Absolute mode opens or focuses `file` and scrolls so `line` is visible according
  to `align`.
- Relative mode scrolls the current viewport by `lineDelta` lines.
- The cursor position must not change.
- The final viewport should be clamped to document boundaries.
- If `returnVisibleRange` is provided, the result includes code around the cursor
  after the viewport move unless the cursor is no longer visible. If the cursor is
  not visible, the result should instead return the visible viewport lines and the
  unchanged cursor position.
- If no text editor is active for a relative move, return a structured tool error.

Result:

```ts
export interface MoveVisibleRangeResult
{
  cursor: CodePosition;
  visibleRange?: VisibleRangeResult;
}
```

## Error Handling

All tools should return structured errors with stable codes:

```ts
export interface ToolError
{
  code:
    | "no_active_editor"
    | "file_not_found"
    | "path_outside_workspace"
    | "path_is_directory"
    | "binary_file"
    | "invalid_pattern"
    | "invalid_range"
    | "too_many_results"
    | "unsupported_document";
  message: string;
  details?: Record<string, unknown>;
}
```

## Response Behavior

Tool outputs should normally continue the model loop. When the model calls one of
these tools, the extension should send the result back as a Realtime
`function_call_output` item and then request another model response. That follow-up
response lets the model decide whether to call another tool, answer the user, or
stop because the task is complete.

The tool itself should not decide whether more work is needed. For example,
`list_files` should only return directory entries. The model can then choose to
call `code_read`, move the cursor, ask a clarifying question, or produce a final
answer based on the original user request and the tool result.

The model instructions should say that after receiving a tool result it must do
one of the following:

- Call another tool when more context or action is needed.
- Produce a user-facing answer when the user's request has been satisfied.
- Produce a brief acknowledgement such as `okay` only when the request was an
  action with no useful content to report.

Externally pushed context is different from model-called tool output. When the VS
Code extension sends context proactively through `sendStructuredContext()`, the
caller may choose whether to also request a model response. Proactive context can
be stored in the conversation silently until a later user turn asks the model to
use it.
