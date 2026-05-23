# Slice 0004 — Navigation and Code Reading Tools

## Objective

Implement the six VS Code tools defined in Spec 02 (`code_read`,
`list_files`, `rgrep`, `read_visible_range`, `set_cursor_position`,
`move_visible_range`) inside `apps/vscode-extension` and register them
with the realtime-agent session started by the scaffold from slice 0003.
After this slice the model can read files, list directories, search the
workspace, inspect the current visible code, move the cursor, and scroll
the viewport by voice.

This slice publishes only the spec's shared types and tool contracts. It
does not yet send proactive "changed since last check" context — that is
slice 0006.

## Scope

In scope:

- A new `src/tools/` directory in `apps/vscode-extension` with:
  - `types.ts` — `CodePosition`, `CodeRange`, `CodeLine`,
    `VisibleRangeResult`, `ToolError`, per-tool arg/result types, and
    a minimal `FreshnessHooks` placeholder interface (four no-op
    method signatures: `markFileObserved`, `markViewportObserved`,
    `markCursorObserved`, `beginAgentMutation`). Slice 0006 takes
    ownership of the real interface and re-exports it from
    `apps/vscode-extension/src/freshness/types.ts`; until then this
    placeholder is the canonical definition.
  - `pathPolicy.ts` — workspace-relative validation, "is inside
    workspace" check, structured `ToolError` builders.
  - `editorAccess.ts` — small helpers around `vscode.window`,
    `vscode.workspace`, `vscode.workspace.openTextDocument`,
    `TextEditorRevealType`, and active-editor lookup.
  - `codeRead.ts`, `listFiles.ts`, `rgrep.ts`, `readVisibleRange.ts`,
    `setCursorPosition.ts`, `moveVisibleRange.ts` — one file per tool,
    each exporting a `ToolDefinition` compatible with
    `realtime-agent-lib`.
  - `index.ts` — `BuildVscodeToolCallSet(deps)` returning a
    `ToolCallSet` containing all six tools in declaration order. `deps`
    is `{ editorAccess: EditorAccess; freshness?: FreshnessHooks }`.
    The `freshness` parameter is optional in this slice (defaults to a
    no-op hooks object) so the tools work in isolation. Slice 0006
    will introduce `FreshnessHooks` proper and require the extension
    to supply a real coordinator-backed hooks object. Tool internals
    call the hooks freely; the no-op default keeps slice 0004 tests
    independent.
- `SessionController` from slice 0003 wires
  `toolCallSet: BuildVscodeToolCallSet()` into `AgentStartConfig`.
  `responseAfterToolOutput: true` is already set by slice 0003, so each
  tool result automatically chains a queued follow-up `response.create`
  through the realtime-agent dispatcher.
- Tool callbacks return JSON-serializable results that match the spec
  exactly. Errors return a `ToolError` payload (not a thrown exception)
  so the model receives a structured failure rather than a generic
  tool-callback failure.
- Per-tool input validation matching the spec (range bounds, non-negative
  integers, valid regex, etc.).

Out of scope:

- File editing/typing tools (out of quest scope per Spec 02).
- Context freshness notifications driven by tool calls (slice 0006).
- Tool call bubbles in the chat pane (slice 0005).

## Key Files / Systems Affected

New files in `apps/vscode-extension/src/tools/` as listed above.
Updates to `src/sessionController.ts` to import and pass the tool set.

## APIs To Reuse As-Is

- `ToolDefinition` and `ToolCallSet` from `realtime-agent-lib`. Each tool
  exports `{ name, description, inputSchema, callback }`.
- `vscode.workspace.openTextDocument(uri)` — produces a TextDocument
  whose content reflects unsaved buffer state.
- `vscode.workspace.findFiles(include, exclude, maxResults)` — directory
  listing and glob matching honoring workspace excludes.
- `vscode.workspace.findTextInFiles` — note: this API is **proposed** and
  not available in stable VS Code without `enableProposedApi`. Plan
  below addresses this.
- `vscode.window.activeTextEditor`, `TextEditor.selection`,
  `TextEditor.visibleRanges`, `TextEditor.revealRange`,
  `vscode.Selection`, `vscode.Position`, `vscode.Range`.

## APIs To Extend / Modify

None outside the new files. The realtime-agent library already exposes
everything needed.

## Design Notes

### Position convention

The spec specifies 1-based line numbers and 0-based characters.
`editorAccess.ts` provides converters:

```ts
function toVscodePosition(line: number, character: number): vscode.Position
{
  return new vscode.Position(Math.max(0, line - 1), Math.max(0, character));
}

function fromVscodePosition(p: vscode.Position): { line: number; character: number }
{
  return { line: p.line + 1, character: p.character };
}
```

Every tool converts at boundaries; the rest of the code uses VS Code's
native convention internally.

### Workspace path policy

`pathPolicy.resolveWorkspacePath(input)` returns either `{ uri, relative
}` or a `ToolError`. Logic:

1. Trim input. Empty -> `invalid_range` (re-use code semantically? No —
   add `invalid_arguments` to the `ToolError` code union if not present).
   Spec defines a fixed code list, so empty paths return
   `path_outside_workspace` or `file_not_found` per the closest fit.
   Decision: empty input returns `file_not_found` with a clear message.
2. If absolute, ensure the resolved real path is inside the workspace's
   root folders (`vscode.workspace.workspaceFolders[].uri.fsPath`).
   Otherwise return `path_outside_workspace`.
3. If relative, join to the first workspace folder and re-validate via
   step 2 (handles `..` traversal).
4. Returned `relative` path is computed via `path.posix.relative` against
   the matched workspace folder root so results always use forward
   slashes.

If no workspace folder is open, every workspace-relative call returns
`path_outside_workspace`.

### `code_read`

- Use `vscode.workspace.openTextDocument(uri)`.
- Reject binary files by checking `document.languageId === "binary"` or
  by guarding against the document throwing on UTF-8 decode. Practically,
  also reject paths whose stat returns >2 MiB or whose first 8 KiB
  contains a NUL byte — return `binary_file`.
- Reject directories with `path_is_directory` after `vscode.workspace.fs.stat`.
- Defaults: omitted both → full file. One bound → fill the other per
  spec. Validate after defaults: `1 <= startLine <= endLine <=
  document.lineCount`. Empty file → `lineCount: 0`, empty `lines`,
  `startLine: 0`, `endLine: 0` (degenerate case; alternative is to error,
  but the spec explicitly allows empty file).
- Build `lines: CodeLine[]` from `document.lineAt(i).text`.

### `list_files`

- Resolve directory via `pathPolicy`; reject if it is a file.
- `recursive: false`: use `vscode.workspace.fs.readDirectory(uri)`,
  filter hidden entries by leading `.` unless `includeHidden`, drop
  ignored directories (`.git`, `node_modules`) by name unless
  `includeHidden`.
- `recursive: true`: use `vscode.workspace.findFiles(new
  RelativePattern(uri, "**/*"), undefined, maxEntries + 1)` to detect
  truncation, plus a manual traversal pass that includes directories
  (because `findFiles` returns files only). Sort directories first then
  files, lexicographic by path.
- `maxEntries` default: 500. If results exceed `maxEntries`, set
  `truncated: true` and trim.

### `rgrep`

- Pattern compiled once via `new RegExp(pattern, caseSensitive ? "g" :
  "gi")`. Invalid regex → `invalid_pattern`.
- Search files via `vscode.workspace.findFiles(includeGlob,
  excludeGlob, maxFileCandidates)`, where `includeGlob` is built from
  `directory` + `fileGlob`, and `excludeGlob` is the workspace's
  `files.exclude` setting union'd with `node_modules` and `.git`.
- For each candidate file, open the document via
  `vscode.workspace.openTextDocument(uri)` and scan line by line. Build
  `RgrepMatch` entries with 1-based line, 0-based char, and the matched
  text. Apply `contextLinesBefore`/`After` from neighboring lines.
- Halt at `maxMatches` (default 200), set `truncated: true` if more
  remain.
- Decision on `vscode.workspace.findTextInFiles`: it is a proposed API
  not generally available, so this slice does not depend on it. Hand-
  rolling the per-file scan keeps the implementation portable and still
  honors the spec's "use VS Code workspace APIs" rule because file
  discovery and document buffers come from VS Code.
- Sort: file path, then line, then character.

### `read_visible_range`

- `vscode.window.activeTextEditor`; missing → `no_active_editor`.
- Cursor: `editor.selection.active`.
- Compute requested range: `[cursor.line - linesAbove, cursor.line +
  linesBelow]` (0-based internally), clamped to
  `[0, document.lineCount - 1]`.
- Convert and build `VisibleRangeResult` (file path
  workspace-relative, cursor, visibleStartLine/EndLine 1-based, lines
  built from document).

### `set_cursor_position`

- Absolute:
  - Resolve file via `pathPolicy`; open via
    `vscode.window.showTextDocument(uri, { preserveFocus: false })`.
  - Clamp `line` to `[1, document.lineCount]`, `character` defaults to
    0, clamped to line length.
  - Apply selection: `editor.selection = new Selection(pos, pos)`.
- Relative:
  - Active editor required; missing → `no_active_editor`.
  - `newLine = clamp(currentLine + lineDelta)`. Character defaults to
    `currentCharacter`; clamped to new line length.
- Reveal: `reveal.align` mapped to `TextEditorRevealType` (`center` →
  `InCenter`, `top` → `AtTop`, `bottom` → close to `InCenter`/`AtTop`
  hybrid — VS Code has no `AtBottom`; emulate by revealing a synthetic
  range that starts a few lines above the cursor. `nearest` → `Default`).
  Default `center`.
- If `returnVisibleRange` provided, call the shared visible-range
  builder.

### `move_visible_range`

- Same opening rules as `set_cursor_position`.
- Cursor must not change. Use `editor.revealRange(range, type)` with a
  range constructed at the target line.
- After reveal, compute the new visible range from
  `editor.visibleRanges[0]`.
- If `returnVisibleRange` provided:
  - Determine whether the cursor line is inside the new visible range.
  - If inside, build a window around the cursor of the requested size.
  - If outside, return `lines` covering the actual visible viewport and
    leave `cursor` as the unchanged cursor position (per spec).

### Errors

`ToolError` always returned through the tool callback by returning the
error object directly (not thrown). The realtime-agent dispatcher
serializes the return value as the tool output, which is what the model
sees. Throwing would route through `callback_failed` and lose the
structured `code`. Document this in `tools/types.ts`.

### Tool descriptions and JSON schemas

Each tool's `description` field is a one-line natural-language summary so
the model picks the right tool. `inputSchema` is hand-written JSON schema
matching the spec's TypeScript shapes (`type: "object"`, `properties`,
`required` only for non-optional fields, `additionalProperties: false`).

## Validation

- Tests under `apps/vscode-extension/test/tools/`:
  - `pathPolicy.test.ts` — workspace inside/outside, `..` traversal,
    posix relative form.
  - `codeRead.test.ts` — full file, range, defaults, empty file, missing
    file, directory, binary, out-of-workspace, invalid range.
  - `listFiles.test.ts` — non-recursive, recursive, hidden/ignored
    suppression, truncation flag.
  - `rgrep.test.ts` — basic match, case sensitivity, fileGlob filter,
    directory scoping, context lines, truncation, invalid regex.
  - `readVisibleRange.test.ts` — clamps, no active editor.
  - `setCursorPosition.test.ts` — absolute, relative, character clamp,
    reveal alignments, returnVisibleRange path.
  - `moveVisibleRange.test.ts` — cursor preserved, scroll up/down,
    returnVisibleRange behavior when cursor in/out of viewport.
- Tests run via Node test runner against a fake `vscode` module
  (`test/helpers/fakeVscode.ts`) that simulates `workspace`, `window`,
  `Position`, `Range`, `Selection`, `Uri`, and the few document/editor
  methods used. Each tool module imports `vscode` by name; the test
  rig substitutes the module via Node's `--import` loader (or by
  re-exporting through a single `editorAccess.ts` seam that tests can
  stub). Decision: use the single-seam approach — every tool talks to
  VS Code only through `editorAccess.ts`, which is the only file that
  imports `vscode`. Tests substitute `editorAccess` via dependency
  injection in `BuildVscodeToolCallSet({ editorAccess })`.
- Manual smoke: in Extension Development Host, ask the agent (after
  slice 0005 chat pane lands, or temporarily via output channel logs)
  to call each tool and confirm the model receives results.
- An integration test (using a fake realtime-agent socket plus the real
  `BuildVscodeToolCallSet` against a fake editor seam) confirms a
  successful tool call produces `function_call_output` followed by a
  queued `response.create`, and a structured tool error produces the
  same two-event sequence. This guards the slice 0003/0004 wiring
  against regressing the QP-0002 contract.

## Risks / Open Concerns

- `vscode.workspace.findTextInFiles` is a proposed API; the plan above
  explicitly avoids it. If the reviewer prefers using it, gating it
  behind `enableProposedApi` is a follow-up consideration, not a
  blocker.
- `binary_file` detection by content sniffing is heuristic. The spec
  does not require a specific algorithm; the heuristic above is
  documented inline.
- The `bottom` alignment for `set_cursor_position` reveal has no direct
  VS Code equivalent. The emulation note above is an acceptable
  approximation.
