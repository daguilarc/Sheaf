# Slice 0004 implementation complete

## Summary

Implemented the six Spec 02 navigation/reading tools (`code_read`, `list_files`, `rgrep`, `read_visible_range`, `set_cursor_position`, `move_visible_range`) under `apps/vscode-extension/src/tools/`, with workspace path policy, a single VS Code `editorAccess` seam, optional no-op `FreshnessHooks`, and `BuildVscodeToolCallSet` wired into `SessionController`’s `AgentStartConfig`.

## Tests

- Added `test/tools/*.test.ts` plus `test/helpers/memoryEditorAccess.ts` (in-memory editor + disk-backed seeds so `realpath` matches production path policy).
- Added `ToolDispatcher` wiring tests to assert `function_call_output` then `response.create` for both success and structured `ToolError` payloads when `responseAfterOutput: "always"`.
- Fixed `TryRealpath` fallback for non-existent paths (macOS `/var` vs `/private/var`) so missing files resolve inside the workspace and return `file_not_found` from tools rather than `path_outside_workspace`.

## Notes

- `SessionController` loads the real `CreateVscodeEditorAccess` via **dynamic** `import()` only when `buildVscodeToolCallSet` is omitted, so Node tests can inject `MemoryEditorAccess` without the `vscode` module. Unit tests use `find .test-dist/test -name '*.test.js'` so top-level tests (e.g. `sessionController.test.js`) run alongside `test/tools/`.
