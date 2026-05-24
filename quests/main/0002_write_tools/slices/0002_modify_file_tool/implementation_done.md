# Implementation complete — slice 0002_modify_file_tool

## Summary

Implemented the `modifyFile` write tool and registered it on the renamed `sheaf VS Code` tool call set.

## Delivered

- **`modifyFile.ts`**: Validates arguments, workspace path, and buffer positions; reads target plus three-line before/after context ranges; rejects on any exact-text mismatch without mutating the buffer; applies edits via `ReplaceTextRange` inside `beginAgentMutation()` with deferred guard end and `markFileObserved`.
- **`callSetBuilder.ts`**: Tool call set name is `sheaf VS Code`; `modifyFile` is registered after the six read/navigation tools.
- **`toolSummary.ts`**: Chat summary for `modifyFile` (e.g. `Editing <file> at line <line>`).
- **Tests**: `modifyFile.test.ts` covers registry wiring, success paths (single-line, multi-line, zero-length insert, file-boundary context), error codes, compact mismatch details, and freshness mutation behavior; `sessionController.test.ts` and `toolSummary.test.ts` updated.

## Validation

- `npm run lint --prefix apps/vscode-extension` — pass
- `npm test --prefix apps/vscode-extension` — 86 tests pass
