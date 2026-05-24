# Slice 0001 - Editor Buffer Edit Foundation

## Objective

Add the reusable VS Code-buffer editing primitives needed by `modifyFile`, without exposing a new model-visible write tool yet.

After this slice, the extension has typed support for validating document positions, reading exact text ranges from the current VS Code text document buffer, and applying a replacement through the VS Code extension API. Existing read/navigation tools continue to behave unchanged.

## Expected Outcome

- The shared tool type surface includes the `modifyFile` argument/result shapes and additional stable error codes from the quest spec.
- `EditorAccess` exposes buffer-oriented edit operations that production code implements with VS Code APIs, not direct filesystem writes.
- The in-memory test editor can exercise the same edit operations without changing the production tool logic.
- No `modifyFile` tool is registered in the tool call set in this slice.

## Key Files / Systems Affected

- `apps/vscode-extension/src/tools/types.ts`
- `apps/vscode-extension/src/tools/editorAccessTypes.ts`
- `apps/vscode-extension/src/tools/editorAccess.ts`
- `apps/vscode-extension/test/helpers/memoryEditorAccess.ts`
- Focused tests under `apps/vscode-extension/test/tools/`

## Existing APIs To Reuse As-Is

- `ResolveWorkspacePathForTools` and `Stat` from the existing `EditorAccess` path policy flow.
- `OpenTextDocument(absPath, relativePosix)` for opening a VS Code-backed text document that reflects the current buffer.
- `ToolError` as the structured error shape returned by tool callbacks.
- Existing 1-based line / 0-based character `CodePosition` convention at tool boundaries.

## APIs To Extend Or Modify

Extend `apps/vscode-extension/src/tools/types.ts`:

- Keep existing read/navigation argument and result contracts unchanged.
- Change `CodePosition.character` to be required, matching the quest spec. Existing cursor result builders already populate `character`; any compile failures should be fixed at their construction sites. Existing cursor move argument shapes keep their own optional `character` fields.
- Add:
  - `ModifyFileArgs`
  - `ModifyFileResult`
  - error codes `invalid_position`, `file_mismatch`, `expected_text_mismatch`, `context_before_mismatch`, `context_after_mismatch`, and `edit_rejected` to the `ToolError.code` union.

Extend `OpenedTextDocument` in `editorAccessTypes.ts` with methods that avoid ad hoc text slicing:

- `positionIsValid0(line0: number, character0: number): boolean`
- `offsetAt0(line0: number, character0: number): number`
- `lineEndCharacter0(line0: number): number`
- `getTextRange0(startLine0: number, startCharacter0: number, endLine0: number, endCharacter0: number): string`

Extend `EditorAccess` with:

- `ReplaceTextRange(absPath: string, relativePosix: string, range: { startLine0: number; startCharacter0: number; endLine0: number; endCharacter0: number }, replacementText: string): Promise<{ accepted: true } | ToolError>`

Production `CreateVscodeEditorAccess` implements these methods by using:

- `vscode.TextDocument.validatePosition`, `offsetAt`, `lineAt`, and `getText(new vscode.Range(...))`.
- `vscode.WorkspaceEdit.replace` plus `vscode.workspace.applyEdit` for replacement. This edits the VS Code document buffer and participates in VS Code document events and undo history. It must not call `fs.writeFile`, shell commands, or patch utilities.

`MemoryEditorAccess` implements the same interface by updating its in-memory line store. It may continue to use filesystem writes only for test fixture seeding because that is outside the production tool implementation.

## Validation Expectations

- Add unit tests for the new in-memory editor edit primitive:
  - Replaces a single-line range.
  - Replaces a multi-line range while preserving `\n` in the test buffer.
  - Inserts text when start equals end.
  - Rejects invalid positions without mutating the in-memory buffer.
- Add compile coverage by running `npm run lint --prefix apps/vscode-extension`.
- Run `npm test --prefix apps/vscode-extension` to ensure existing read/navigation behavior still passes.

## Sequencing Notes

This slice is required before slice 0002. It intentionally does not register `modifyFile`, so there is no partially implemented public write tool for the agent to call.
