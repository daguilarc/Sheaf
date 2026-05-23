# Implementation complete — slice 0006

## Summary

Implemented **context freshness** for the VS Code extension per the physical plan: a stable `FreshnessCoordinator` with fixed `hooks` passed into `BuildVscodeToolCallSet` at activation, and a per-session `FreshnessService` that subscribes to VS Code document, active-editor, visible-range, and selection events; pushes structured context (`file_changed_since_last_read`, `viewport_changed_since_last_check`, `cursor_changed_since_last_check`) via `session.sendStructuredContext` and records each push in `ChatModel.recordContextPush`. Agent mutations from `set_cursor_position` / `move_visible_range` use `beginAgentMutation()` with `setImmediate`-deferred `end()` so follow-up events do not flip staleness incorrectly.

## Integration

- `extension.ts`: one coordinator, one cached tool call set with `CreateVscodeEditorAccess()` and `freshness: coordinator.hooks`; `SessionController` receives `freshnessCoordinator` and the cached `buildVscodeToolCallSet`.
- `sessionController.ts`: after a successful session and mic start, dynamically loads `FreshnessService` + default VS Code host (keeps Node tests from loading `vscode`), attaches listeners, `coordinator.attach(service)`; `coordinator.detach()` on stop, start failure, connection loss, and before session stop ordering. Exposes `OnSessionStarted(session)` and `OnSessionStopped()` (stopped listeners run before freshness detach on normal stop and on connection loss).
- Tools: `read_visible_range` marks file + viewport + cursor; `code_read` marks file only on successful read; `set_cursor_position` / `move_visible_range` use deferred mutation guards and observation rules from the plan; **rgrep** and **list_files** no longer call `markFileObserved` (rgrep documented per plan).
- Tests under `test/freshness/` plus `test/helpers/fakeVscodeEvents.ts`; all `npm test` and `npm run lint` pass for the extension package.
