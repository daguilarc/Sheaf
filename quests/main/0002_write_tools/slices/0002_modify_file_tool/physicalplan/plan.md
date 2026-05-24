# Slice 0002 - `modifyFile` Tool

## Objective

Implement and register the `modifyFile` tool so the VS Code extension can replace an exact range in a workspace text document buffer after validating exact target text and three-line surrounding context.

After this slice, the model-visible tool call set is named `sheaf VS Code`, still contains all six existing read/navigation tool names unchanged, and additionally exposes `modifyFile`.

## Expected Outcome

- `BuildVscodeToolCallSet` returns `name: "sheaf VS Code"`.
- Existing tools remain registered as:
  - `code_read`
  - `list_files`
  - `rgrep`
  - `read_visible_range`
  - `set_cursor_position`
  - `move_visible_range`
- New tool `modifyFile` is registered after the read/navigation tools.
- `modifyFile` validates the full edit window before calling the edit primitive.
- Any validation failure returns a structured `ToolError` and leaves the buffer unchanged.
- Successful edits are wrapped in the existing agent-mutation guard so agent-originated writes do not trigger freshness notifications back to the agent.

## Key Files / Systems Affected

- `apps/vscode-extension/src/tools/modifyFile.ts` (new)
- `apps/vscode-extension/src/tools/callSetBuilder.ts`
- `apps/vscode-extension/src/tools/types.ts`
- `apps/vscode-extension/src/tools/toolContext.ts`
- `apps/vscode-extension/src/chat/toolSummary.ts`
- `apps/vscode-extension/test/tools/modifyFile.test.ts` (new)
- `apps/vscode-extension/test/tools/toolDispatcherWiring.test.ts`
- Freshness-related tests as needed under `apps/vscode-extension/test/freshness/`

## Existing APIs To Reuse As-Is

- `ToolDefinition` and `ToolCallSet` from `realtime-agent-lib`.
- `ToolServices` to pass `editorAccess` and `freshness` into tool factories.
- `EditorAccess.ResolveWorkspacePathForTools`, `Stat`, and `OpenTextDocument` for workspace containment, file existence/type checks, and buffer-backed document reads.
- The slice 0001 range-read and replacement methods on `OpenedTextDocument` / `EditorAccess`.
- `FreshnessHooks.beginAgentMutation()` and `markFileObserved(file)` from the existing freshness contract.
- `IsToolError` for branching on structured failures.

## APIs To Extend Or Modify

Add `CreateModifyFileTool(services: ToolServices): ToolDefinition<ModifyFileArgs, ModifyFileResult | ToolError>`.

`callSetBuilder.ts` must import and include it:

```ts
return {
  name: "sheaf VS Code",
  tools: [
    CreateCodeReadTool(services),
    CreateListFilesTool(services),
    CreateRgrepTool(services),
    CreateReadVisibleRangeTool(services),
    CreateSetCursorPositionTool(services),
    CreateMoveVisibleRangeTool(services),
    CreateModifyFileTool(services),
  ] as ToolDefinition[],
};
```

If `toolSummary.ts` has tool-name-specific summaries, add a concise `modifyFile` summary such as `Editing <file> at line <line>` without changing existing summaries.

## Implementation Details

### Argument validation

`modifyFile` must reject invalid argument shapes before reading the document:

- `start` and `end` must be objects.
- `start.file` and `end.file` must be non-empty strings.
- `start.line` and `end.line` must be positive integers.
- `start.character` and `end.character` must be non-negative integers.
- `exactText`, `replacementText`, `contextBeforeText`, and `contextAfterText` must be strings.
- If `start.file !== end.file`, return `file_mismatch`.

For invalid line/character values or invalid document positions, return `invalid_position`.

### Workspace and document validation

Use the existing path policy flow:

1. Resolve `start.file` through `ResolveWorkspacePathForTools`.
2. Return any existing path-policy `ToolError` as-is.
3. Call `Stat`; missing file returns `file_not_found`, directory returns `path_is_directory`.
4. Call `OpenTextDocument`; return any `ToolError` as-is.
5. Reject binary/unsupported documents using the same practical checks already used by `code_read` where applicable.

The resolved `relativePosix` path is the canonical `file` in the result and in error details.

### Position conversion

Convert tool positions at the boundary:

- Tool `line` is 1-based.
- Tool `character` is 0-based.
- Internal editor positions are 0-based.

Validate both start and end positions with the slice 0001 document helpers. Then require start to be before or equal to end by comparing line first and character second.

### Edit-window computation

Compute three ranges from the current VS Code buffer:

- Target range: `start` through `end`, start inclusive and end exclusive.
- Before-context range: from the start of the line up to three full lines above `start`, clamped to the beginning of the document, through `start`.
- After-context range: from `end` through the line end up to three full lines below `end`, clamped to the end of the document.

Concrete range rules:

- `beforeStartLine0 = Math.max(0, startLine0 - 3)`
- before range start is `(beforeStartLine0, 0)`
- before range end is `(startLine0, startCharacter0)`
- `afterEndLine0 = Math.min(document.lineCount - 1, endLine0 + 3)`
- after range start is `(endLine0, endCharacter0)`
- after range end is `(afterEndLine0, document.lineEndCharacter0(afterEndLine0))`

Because these ranges are clamped to real file boundaries, exact string comparison naturally enforces the spec rule that shorter-than-three-line context is valid only at the beginning or end of the file.

### Exact matching

Read all three computed ranges before applying any edit. Compare exactly, including whitespace and line breaks:

- Target mismatch returns `expected_text_mismatch`.
- Before-context mismatch returns `context_before_mismatch`.
- After-context mismatch returns `context_after_mismatch`.

The tool must not attempt partial edits. It must call `ReplaceTextRange` only after all validation and all three comparisons pass.

### Error details

Mismatch and invalid-position errors should include compact recovery details:

- `file`
- requested `start` and `end`
- `mismatchCategory`
- `expectedLength`
- `actualLength`
- `actualPreview` capped to a small limit such as 160 characters

Do not include large file contents or the full document in `details`.

### Applying the edit

When validation passes:

1. Start `const guard = services.freshness.beginAgentMutation()`.
2. Call `ReplaceTextRange(...)`.
3. If replacement is rejected, return `edit_rejected` and leave the buffer as VS Code reports it.
4. On success, call `services.freshness.markFileObserved(relativePosix)` while the mutation guard is still active so the post-edit buffer is treated as the agent's current observed state.
5. End the guard in a `finally` block, using the same deferred-end pattern already used by cursor/viewport mutation tools to suppress VS Code change events emitted immediately after the API call.
6. Return:

```ts
{
  file: relativePosix,
  start,
  end,
  insertedText: replacementText,
  replacedText: exactText,
}
```

Use normalized result positions with the canonical relative file path.

## Validation Expectations

Add tests covering:

- Tool call set name is exactly `sheaf VS Code`.
- Existing six tool names and contracts remain callable.
- `modifyFile` appears in the tool registry and dispatcher output path.
- Successful single-line replacement.
- Successful multi-line replacement.
- Successful insertion with `start === end` and `exactText === ""`.
- Context at beginning of file may contain fewer than three before lines.
- Context at end of file may contain fewer than three after lines.
- `file_mismatch` when start and end files differ.
- `invalid_position` for out-of-range lines, negative characters, and start after end.
- `expected_text_mismatch`, `context_before_mismatch`, and `context_after_mismatch` each leave the buffer unchanged.
- Error details include lengths and a short preview, not full file contents.
- A spy `FreshnessHooks` verifies successful edits call `beginAgentMutation`, end the guard, and mark the file observed; mismatch failures do not begin a mutation.

Run:

- `npm run lint --prefix apps/vscode-extension`
- `npm test --prefix apps/vscode-extension`

## Sequencing Notes

This slice depends on slice 0001. It must not wait for prompt changes from slice 0003; after this slice the tool is functional and registered, but the built-in agent instructions still need to be taught the intended write workflow.
