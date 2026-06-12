# Capability: Editor Tools

Project: `projects/realtime-agent`
ID prefix: `et` — requirement IDs are append-only; never renumber or reuse.

## Purpose

The extension registers one tool call set, `sheaf VS Code`, exposing seven
VS Code-native tools to the model: read (`code_read`, `list_files`,
`rgrep`, `read_visible_range`), navigate (`set_cursor_position`,
`move_visible_range`), and one write (`modifyFile`). Tools operate on VS
Code text-document buffers (unsaved edits included) and editor state — never
shell commands or raw filesystem writes — under a strict workspace path
policy, and return structured `ToolError` objects on failure.

## Requirements

### Requirement: et-1 — Set, policy, shared gating: tool call set registration
THE extension SHALL register the tool call set named `sheaf VS Code` containing exactly, in order: `code_read`, `list_files`, `rgrep`, `read_visible_range`, `set_cursor_position`, `move_visible_range`, `modifyFile`.

#### Scenario: Tool call set registered
- **WHEN** the extension initialises
- **THEN** the tool call set named `sheaf VS Code` is registered containing exactly, in order: `code_read`, `list_files`, `rgrep`, `read_visible_range`, `set_cursor_position`, `move_visible_range`, `modifyFile`

### Requirement: et-2 — Set, policy, shared gating: ToolError on failure
ON validation or domain failure, a tool SHALL return a `ToolError` `{code, message, details?}` (codes in Contracts) as its result rather than throwing; thrown errors would surface as generic `callback_failed` payloads ([tool-dispatch](../realtime-agent-tool-dispatch/spec.md) td-10).

#### Scenario: Validation or domain failure
- **WHEN** a tool encounters a validation or domain failure
- **THEN** it returns a `ToolError` `{code, message, details?}` as its result rather than throwing

### Requirement: et-3 — Set, policy, shared gating: path policy
THE path policy SHALL resolve tool paths as follows: empty → `file_not_found` (`Path is empty.`); no workspace folder → `path_outside_workspace` (`No workspace folder is open.`); relative paths resolve against the first workspace root; absolute paths are accepted only when they resolve (symlinks followed via realpath) inside some workspace root, else `path_outside_workspace` (`Path resolves outside the workspace.`). Successful resolution yields a workspace-relative POSIX path used in all results.

#### Scenario: Empty path
- **WHEN** a tool is called with an empty path argument
- **THEN** it returns `file_not_found` with message `Path is empty.`

#### Scenario: No workspace folder open
- **WHEN** a tool is called with no workspace folder open
- **THEN** it returns `path_outside_workspace` with message `No workspace folder is open.`

#### Scenario: Relative path
- **WHEN** a tool is called with a relative path
- **THEN** the path is resolved against the first workspace root

#### Scenario: Absolute path inside workspace
- **WHEN** a tool is called with an absolute path that resolves (symlinks followed via realpath) inside some workspace root
- **THEN** the path is accepted and successful resolution yields a workspace-relative POSIX path used in all results

#### Scenario: Absolute path outside workspace
- **WHEN** a tool is called with an absolute path that resolves outside all workspace roots
- **THEN** it returns `path_outside_workspace` with message `Path resolves outside the workspace.`

### Requirement: et-4 — Set, policy, shared gating: text-file gate
THE text-file gate for `code_read` and `modifyFile` SHALL reject with `binary_file`: files larger than 2 MiB, documents whose VS Code `languageId` is `binary`, and documents with a NUL byte in the first 8 KiB. Documents VS Code cannot open return `unsupported_document` with the underlying message.

#### Scenario: File too large
- **WHEN** `code_read` or `modifyFile` is called on a file larger than 2 MiB
- **THEN** it returns `binary_file`

#### Scenario: Binary languageId
- **WHEN** `code_read` or `modifyFile` is called on a document whose VS Code `languageId` is `binary`
- **THEN** it returns `binary_file`

#### Scenario: NUL byte in first 8 KiB
- **WHEN** `code_read` or `modifyFile` is called on a document with a NUL byte in the first 8 KiB
- **THEN** it returns `binary_file`

#### Scenario: Document VS Code cannot open
- **WHEN** `code_read` or `modifyFile` is called on a document VS Code cannot open
- **THEN** it returns `unsupported_document` with the underlying message

### Requirement: et-5 — Read tools: code_read
`code_read({file, startLine?, endLine?})` SHALL return `{file, lineCount, startLine, endLine, lines: [{line, text}…]}` for the inclusive 1-based range, defaulting a missing bound to the file edge; an empty document SHALL return `{file, lineCount: 0, startLine: 0, endLine: 0, lines: []}`; non-integer bounds or a range violating `1 <= startLine <= endLine <= lineCount` SHALL return `invalid_range` (range message: `Range must satisfy 1 <= startLine <= endLine <= <lineCount>.` with details). A directory path returns `path_is_directory`; a missing file `file_not_found`. Success marks the file observed ([freshness](../realtime-agent-freshness/spec.md)).

#### Scenario: Successful read with explicit range
- **WHEN** `code_read` is called with a valid file and explicit `startLine`/`endLine`
- **THEN** it returns `{file, lineCount, startLine, endLine, lines: [{line, text}…]}` for the inclusive 1-based range

#### Scenario: Missing bound defaults to file edge
- **WHEN** `code_read` is called with a missing `startLine` or `endLine`
- **THEN** the missing bound defaults to the file edge

#### Scenario: Empty document
- **WHEN** `code_read` is called on an empty document
- **THEN** it returns `{file, lineCount: 0, startLine: 0, endLine: 0, lines: []}`

#### Scenario: Invalid range
- **WHEN** `code_read` is called with non-integer bounds or a range violating `1 <= startLine <= endLine <= lineCount`
- **THEN** it returns `invalid_range` with message `Range must satisfy 1 <= startLine <= endLine <= <lineCount>.` and details

#### Scenario: Directory path
- **WHEN** `code_read` is called with a directory path
- **THEN** it returns `path_is_directory`

#### Scenario: Missing file
- **WHEN** `code_read` is called with a path to a missing file
- **THEN** it returns `file_not_found`

#### Scenario: Successful read marks file observed
- **WHEN** `code_read` succeeds
- **THEN** the file is marked observed in freshness

### Requirement: et-6 — Read tools: list_files
`list_files({directory, recursive?, includeHidden?, maxEntries?})` SHALL list the resolved directory (non-recursive by default; recursive = breadth-first), skipping dot-prefixed names and the `.git`/`node_modules` directories unless `includeHidden` is true, capping at `maxEntries` (default 500; non-positive/non-integer → `invalid_range`), and SHALL return `{directory, recursive, truncated, entries: [{path, kind: "file"|"directory"}…]}` with entries sorted directories-first then by path; `truncated` is true when entries were cut. A file path returns `invalid_range` (`Expected a directory path.`); a missing one `file_not_found`.

#### Scenario: Non-recursive listing
- **WHEN** `list_files` is called without `recursive`
- **THEN** it lists the resolved directory non-recursively, skipping dot-prefixed names and `.git`/`node_modules`, and returns `{directory, recursive, truncated, entries: [{path, kind: "file"|"directory"}…]}` sorted directories-first then by path

#### Scenario: Recursive listing
- **WHEN** `list_files` is called with `recursive: true`
- **THEN** it lists breadth-first, skipping dot-prefixed names and `.git`/`node_modules` unless `includeHidden` is true

#### Scenario: includeHidden
- **WHEN** `list_files` is called with `includeHidden: true`
- **THEN** dot-prefixed names and `.git`/`node_modules` are included

#### Scenario: Entries truncated
- **WHEN** the number of entries exceeds `maxEntries` (default 500)
- **THEN** results are capped and `truncated` is true

#### Scenario: Invalid maxEntries
- **WHEN** `list_files` is called with a non-positive or non-integer `maxEntries`
- **THEN** it returns `invalid_range`

#### Scenario: File path instead of directory
- **WHEN** `list_files` is called with a file path
- **THEN** it returns `invalid_range` with message `Expected a directory path.`

#### Scenario: Missing directory
- **WHEN** `list_files` is called with a path to a missing directory
- **THEN** it returns `file_not_found`

### Requirement: et-7 — Read tools: rgrep
`rgrep({pattern, directory?, fileGlob?, caseSensitive?, maxMatches?, contextLinesBefore?, contextLinesAfter?})` SHALL evaluate `pattern` as a JavaScript regular expression (flags `g`, or `gi` only when `caseSensitive === false`; invalid pattern → `invalid_pattern`) over workspace files discovered via VS Code file search (glob default `**/*`, scoped under `directory` when given; at most 5 001 files considered), silently skipping files over 2 MiB, binary documents, and NUL-containing files, and SHALL return `{pattern, directory?, fileGlob?, truncated, matches}` where each match is `{file, line, character, text, matchText, contextBefore?, contextAfter?}` (1-based line, 0-based character, context lines only when requested and non-empty), matches sorted by file/line/character, capped at `maxMatches` (default 200) with `truncated` true only when at least one further match was found beyond the cap.

#### Scenario: Successful regex search
- **WHEN** `rgrep` is called with a valid pattern
- **THEN** it evaluates the pattern over workspace files and returns `{pattern, directory?, fileGlob?, truncated, matches}` with matches sorted by file/line/character

#### Scenario: Case-insensitive search
- **WHEN** `rgrep` is called with `caseSensitive === false`
- **THEN** the pattern is evaluated with flags `gi`

#### Scenario: Invalid pattern
- **WHEN** `rgrep` is called with an invalid regex pattern
- **THEN** it returns `invalid_pattern`

#### Scenario: Oversized or binary files skipped
- **WHEN** workspace files are discovered that are over 2 MiB, binary documents, or NUL-containing files
- **THEN** they are silently skipped

#### Scenario: Matches truncated
- **WHEN** the number of matches reaches `maxMatches` (default 200) and at least one further match exists
- **THEN** results are capped and `truncated` is true

### Requirement: et-8 — Read tools: read_visible_range
`read_visible_range({linesAbove, linesBelow})` (non-negative integers, else `invalid_range`; no active editor → `no_active_editor`) SHALL return the window around the active cursor — `{file, cursor, visibleStartLine, visibleEndLine, lines, requestedLinesAbove, requestedLinesBelow}` — from the live buffer, and marks file, viewport, and cursor observed.

#### Scenario: Successful read
- **WHEN** `read_visible_range` is called with valid non-negative integer arguments and an active editor is present
- **THEN** it returns `{file, cursor, visibleStartLine, visibleEndLine, lines, requestedLinesAbove, requestedLinesBelow}` from the live buffer and marks file, viewport, and cursor observed

#### Scenario: Invalid arguments
- **WHEN** `read_visible_range` is called with non-integer or negative `linesAbove`/`linesBelow`
- **THEN** it returns `invalid_range`

#### Scenario: No active editor
- **WHEN** `read_visible_range` is called with no active editor
- **THEN** it returns `no_active_editor`

### Requirement: et-9 — Navigation tools: set_cursor_position
`set_cursor_position({target, reveal?, returnVisibleRange?})` SHALL move the cursor: `target.mode == "absolute"` opens and focuses `target.file` and clamps `line`/`character` into the document; `mode == "relative"` offsets the active editor's cursor by `lineDelta` (no active editor → `no_active_editor`), with `character` defaulting to the current column. Reveal alignment is `top|center|bottom|nearest` (default center). The result is `{cursor: {file, line, character}}` plus a `visibleRange` window when `returnVisibleRange: {linesAbove, linesBelow}` is supplied. Freshness: cursor observed always; viewport observed when a visible range was requested; file observed when the returned window has lines. The move runs under an agent-mutation guard.

#### Scenario: Absolute mode
- **WHEN** `set_cursor_position` is called with `target.mode == "absolute"`
- **THEN** it opens and focuses `target.file`, clamps `line`/`character` into the document, and returns `{cursor: {file, line, character}}`

#### Scenario: Relative mode
- **WHEN** `set_cursor_position` is called with `mode == "relative"` and an active editor is present
- **THEN** it offsets the active editor's cursor by `lineDelta`, defaulting `character` to the current column, and returns `{cursor: {file, line, character}}`

#### Scenario: Relative mode no active editor
- **WHEN** `set_cursor_position` is called with `mode == "relative"` and no active editor
- **THEN** it returns `no_active_editor`

#### Scenario: returnVisibleRange supplied
- **WHEN** `set_cursor_position` is called with `returnVisibleRange: {linesAbove, linesBelow}`
- **THEN** the result includes a `visibleRange` window; viewport is marked observed; file is marked observed when the returned window has lines

#### Scenario: Cursor always marked observed
- **WHEN** `set_cursor_position` completes
- **THEN** cursor is marked observed

### Requirement: et-10 — Navigation tools: move_visible_range
`move_visible_range({target, returnVisibleRange?})` SHALL scroll without moving the cursor: absolute mode reveals `target.line` (clamped) in `target.file` with alignment `top|center|bottom` (default center); relative mode shifts the current viewport's first visible line by `lineDelta` (clamped; no active editor → `no_active_editor`). The result reports the (unchanged) cursor and an optional `visibleRange` — a window around the cursor when the cursor is inside the new viewport, else the viewport's lines. Freshness: viewport observed always; file observed when the returned window has lines; cursor observed when it lies inside the returned range. Runs under an agent-mutation guard.

#### Scenario: Absolute scroll mode
- **WHEN** `move_visible_range` is called with absolute mode
- **THEN** it reveals `target.line` (clamped) in `target.file` with the specified alignment (default center), without moving the cursor

#### Scenario: Relative scroll mode
- **WHEN** `move_visible_range` is called with relative mode and an active editor is present
- **THEN** it shifts the current viewport's first visible line by `lineDelta` (clamped), without moving the cursor

#### Scenario: Relative mode no active editor
- **WHEN** `move_visible_range` is called with relative mode and no active editor
- **THEN** it returns `no_active_editor`

#### Scenario: Viewport always marked observed
- **WHEN** `move_visible_range` completes
- **THEN** viewport is marked observed; file is marked observed when the returned window has lines; cursor is marked observed when it lies inside the returned range

### Requirement: et-11 — Write tool: modifyFile arguments
`modifyFile({start, end, exactText, replacementText, contextBeforeText, contextAfterText})` SHALL require all fields; positions are `{file, line (1-based, ≥1), character (0-based, ≥0)}` with `start.file == end.file` (else `file_mismatch`) and start ≤ end (else `invalid_position`); positions must lie inside the buffer (else `invalid_position`).

#### Scenario: Mismatched files
- **WHEN** `modifyFile` is called with `start.file != end.file`
- **THEN** it returns `file_mismatch`

#### Scenario: Start after end
- **WHEN** `modifyFile` is called with start > end
- **THEN** it returns `invalid_position`

#### Scenario: Position outside buffer
- **WHEN** `modifyFile` is called with positions that lie outside the buffer
- **THEN** it returns `invalid_position`

### Requirement: et-12 — Write tool: modifyFile verification
`modifyFile` SHALL verify, against the live buffer, that the text of `[start, end)` equals `exactText`, that the text from the start of the line three lines above `start` up to `start` equals `contextBeforeText`, and that the text from `end` to the end of the line three lines below `end` equals `contextAfterText` (windows clamp at file boundaries); a mismatch returns `expected_text_mismatch` / `context_before_mismatch` / `context_after_mismatch` with details `{file, start, end, mismatchCategory, expectedLength, actualLength, actualPreview (≤160 chars)}` and leaves the buffer unchanged.

#### Scenario: exactText mismatch
- **WHEN** `modifyFile` is called and the text of `[start, end)` does not equal `exactText`
- **THEN** it returns `expected_text_mismatch` with details `{file, start, end, mismatchCategory, expectedLength, actualLength, actualPreview (≤160 chars)}` and leaves the buffer unchanged

#### Scenario: contextBeforeText mismatch
- **WHEN** `modifyFile` is called and the before-context text does not equal `contextBeforeText`
- **THEN** it returns `context_before_mismatch` with details and leaves the buffer unchanged

#### Scenario: contextAfterText mismatch
- **WHEN** `modifyFile` is called and the after-context text does not equal `contextAfterText`
- **THEN** it returns `context_after_mismatch` with details and leaves the buffer unchanged

### Requirement: et-13 — Write tool: modifyFile application
WHEN validation passes, `modifyFile` SHALL apply the replacement through a VS Code `WorkspaceEdit` (buffer edit — undoable, not auto-saved) and return `{file, start, end, insertedText, replacedText}`; IF VS Code rejects the edit, THEN it SHALL return `edit_rejected` (`VS Code rejected the buffer edit.`). The edit runs under an agent-mutation guard and marks the file observed, so the extension does not notify the model of its own write ([freshness](../realtime-agent-freshness/spec.md) fr-5).

#### Scenario: Successful edit
- **WHEN** `modifyFile` validation passes
- **THEN** the replacement is applied through a VS Code `WorkspaceEdit` (undoable, not auto-saved) and returns `{file, start, end, insertedText, replacedText}`; the file is marked observed

#### Scenario: Edit rejected by VS Code
- **WHEN** validation passes but VS Code rejects the `WorkspaceEdit`
- **THEN** it returns `edit_rejected` with message `VS Code rejected the buffer edit.`

## Contracts

### `ToolError`

```json
{ "code": "<one of the codes below>", "message": "<human message>", "details": { } }
```

Codes: `no_active_editor`, `file_not_found`, `path_outside_workspace`,
`path_is_directory`, `binary_file`, `invalid_pattern`, `invalid_range`,
`too_many_results` (reserved, currently unproduced), `unsupported_document`,
`invalid_position`, `file_mismatch`, `expected_text_mismatch`,
`context_before_mismatch`, `context_after_mismatch`, `edit_rejected`.

### Error catalogue (pinned messages)

| Condition | Code | Message (exact) |
|---|---|---|
| Empty path argument | `file_not_found` | `Path is empty.` |
| No workspace open | `path_outside_workspace` | `No workspace folder is open.` |
| Path escapes workspace | `path_outside_workspace` | `Path resolves outside the workspace.` |
| Missing file/directory | `file_not_found` | `File not found.` / `Directory not found.` / `Search directory not found.` |
| Directory where file expected | `path_is_directory` | `Path is a directory.` |
| File where directory expected | `invalid_range` | `Expected a directory path.` / `Expected \`directory\` to be a directory.` |
| Oversize file | `binary_file` | `File is too large to read as text.` / `File is too large to edit as text.` |
| Binary languageId | `binary_file` | `Document is binary.` |
| NUL in first 8 KiB | `binary_file` | `File contains NUL bytes in the first 8 KiB.` |
| Bad `code_read` range | `invalid_range` | `Range must satisfy 1 <= startLine <= endLine <= <n>.` |
| No active editor | `no_active_editor` | `No active text editor.` (variants name the operation) |
| Bad regex | `invalid_pattern` | the `RegExp` constructor message |
| `modifyFile` target mismatch | `expected_text_mismatch` | `Target range text does not match \`exactText\`.` |
| `modifyFile` before-context mismatch | `context_before_mismatch` | `Before-context text does not match \`contextBeforeText\`.` |
| `modifyFile` after-context mismatch | `context_after_mismatch` | `After-context text does not match \`contextAfterText\`.` |
| Position outside buffer | `invalid_position` | `Start or end position is outside the document buffer.` |
| start > end | `invalid_position` | `Start position must be before or equal to the end position.` |
| Edit refused by VS Code | `edit_rejected` | `VS Code rejected the buffer edit.` |

### Worked example — `modifyFile` success

```json
// arguments
{
  "start": { "file": "src/example.ts", "line": 10, "character": 2 },
  "end":   { "file": "src/example.ts", "line": 10, "character": 7 },
  "exactText": "const",
  "replacementText": "let",
  "contextBeforeText": "}\n\nfunction f() {\n  ",
  "contextAfterText": " x = 1;\n  return x;\n}\n",
  "...": "context windows are exactly the 3 lines before/after, clamped at file edges"
}
// result
{
  "file": "src/example.ts",
  "start": { "file": "src/example.ts", "line": 10, "character": 2 },
  "end":   { "file": "src/example.ts", "line": 10, "character": 7 },
  "insertedText": "let",
  "replacedText": "const"
}
```

### Result shapes

Argument/result interfaces for all seven tools are defined in
`src/vscode-extension/src/tools/types.ts` (`CodeReadArgs/Result`,
`ListFilesArgs/Result`, `RgrepArgs/Result`, `ReadVisibleRangeArgs/Result`,
`SetCursorPositionArgs/Result`, `MoveVisibleRangeArgs/Result`,
`ModifyFileArgs/Result`, `VisibleRangeResult`); each tool also declares a
JSON `inputSchema` with `additionalProperties: false` advertised to the
model.

## Design

- `src/vscode-extension/src/tools/callSetBuilder.ts` — assembles the set
  from `ToolServices` (`editorAccess` + `freshness` hooks; hooks default to
  no-ops).
- `pathPolicy.ts` — `ResolveWorkspacePath` with realpath-based containment
  (`TryRealpath` falls back to parent-dir realpath, then `normalize`).
- `editorAccess.ts` — the only module touching `vscode` APIs for tools:
  stat/open/readDirectory/findFiles wrappers, editor handles
  (`getViewportInclusive0` treats an end-column-0 visible range as ending
  on the previous line), `ReplaceTextRange` via `WorkspaceEdit`. `bottom`
  alignment is approximated by revealing a range starting five lines above
  the target at top.
- `visibleWindow.ts` / `positionConversion.ts` — 1-based↔0-based
  conversion and window building (clamping rules shared by et-8/9/10).
- Navigation/write tools end their agent-mutation guards via
  `setImmediate` so the VS Code events caused by the action are still
  suppressed ([freshness](../realtime-agent-freshness/spec.md)).
- Tests: `tests/vscode-extension/tools/*.test.ts` (one per tool, plus
  `pathPolicy`, `replaceTextRange`, `toolDispatcherWiring`), using
  `tests/vscode-extension/helpers/memoryEditorAccess.ts`.

## Interactions

- [tool-dispatch](../realtime-agent-tool-dispatch/spec.md) — executes these callbacks; `ToolError`
  results are successful outputs at the dispatcher level.
- [freshness](../realtime-agent-freshness/spec.md) — observation marks and mutation guards above.
- [vscode-extension](../realtime-agent-vscode-extension/spec.md) — registers the set (vsx-9) and
  summarizes calls into chat bubbles.
