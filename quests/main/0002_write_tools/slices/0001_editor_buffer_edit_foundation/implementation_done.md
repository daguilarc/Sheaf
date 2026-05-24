# Implementation complete

Slice `0001_editor_buffer_edit_foundation` is implemented.

## Summary

- Extended `types.ts` with required `CodePosition.character`, `ModifyFileArgs`, `ModifyFileResult`, and the six write-tool error codes on `ToolError`.
- Extended `OpenedTextDocument` with buffer-oriented helpers (`positionIsValid0`, `offsetAt0`, `lineEndCharacter0`, `getTextRange0`).
- Added `EditorAccess.ReplaceTextRange` to the shared interface.
- Implemented production buffer edits in `CreateVscodeEditorAccess` via `vscode.WorkspaceEdit.replace` and `vscode.workspace.applyEdit` (no direct filesystem writes).
- Implemented the same edit primitive in `MemoryEditorAccess` for in-memory test buffers.
- Added focused unit tests for single-line, multi-line, zero-length insertion, invalid-position rejection, and buffer helper coverage.
- `modifyFile` is not registered in the tool call set in this slice.

## Validation

- `npm run lint --prefix apps/vscode-extension` — pass
- `npm test --prefix apps/vscode-extension` — 73 tests pass
