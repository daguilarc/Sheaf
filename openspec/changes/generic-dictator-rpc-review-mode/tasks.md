## 1. Dictator WebSocket RPC

- [x] 1.1 Add a `/ws/rpc` WebSocket upgrade route and per-connection client session registry.
- [x] 1.2 Implement request/response and event envelope encoding, decoding, validation, and error responses.
- [x] 1.3 Add heartbeat or timeout cleanup that releases client-owned cells and pushed context blocks.
- [x] 1.4 Add unit tests for valid connection, invalid connection, supported calls, unsupported methods, malformed params, ownership conflict errors, and cleanup.

## 2. Dictator Launchpad External Cells

- [x] 2.1 Implement RPC-backed Launchpad cell ownership with coordinate validation, RGB/off rendering, and disconnect cleanup.
- [x] 2.2 Route owned-cell press/release hardware events to `launchpad.cellPressed` and `launchpad.cellReleased` events with monotonic sequence numbers.
- [x] 2.3 Ensure owned cells consume hardware events and never dispatch static layout actions while owned.
- [x] 2.4 Remove built-in `(2,7)` voice review pad handling, review recording colors, and review pad actions.
- [x] 2.5 Remove hunk-provider command routing from the Launchpad control layer.
- [x] 2.6 Update product and fixture layout tests so `(2,7)` is completely removed from the review workflow and `(3,3)` can be externally owned as the only review/comment/post cell.
- [x] 2.7 Add Launchpad tests for external cell rendering, press/release dispatch, static-action suppression, and ownership cleanup.

## 3. Dictator Cursor Insertion And Context

- [x] 3.1 Implement `cursor.insertText` using the existing clipboard-preserving insertion path.
- [x] 3.2 Return insertion success only after paste and clipboard restoration both succeed; reject empty or over-1-MiB UTF-8 text before touching the clipboard; return structured errors otherwise.
- [x] 3.3 Implement `dictationContext.push` and `dictationContext.pop` with client-scoped context ids.
- [x] 3.4 Include active pushed context blocks in Launchpad dictation context snapshots.
- [x] 3.5 Add tests for successful insertion, empty insertion rejection, over-limit insertion rejection, paste failure, clipboard restoration failure, context replacement, context pop, and disconnect cleanup.

## 4. Retire Dictator Voice Diff Review

- [x] 4.1 Remove Dictator-owned active diff review store usage from Launchpad review flows.
- [x] 4.2 Remove review recording/refinement mode and review-specific contextual-backspace behavior.
- [x] 4.3 Remove hunk-review HTTP endpoints or replace them with compatibility failures if needed during migration.
- [x] 4.4 Update Dictator diagnostics to report generic RPC clients, owned cells, and pushed context instead of voice diff review state.
- [x] 4.5 Delete or rewrite tests that assert Dictator-owned review comments, reverted markers, serialization, or `(2,7)` review behavior.

## 5. Sheaf Chat Review State

- [x] 5.1 Move Agent Review Mode active review draft ownership into Sheaf Chat service state.
- [x] 5.2 Store ordered comment and rejected-hunk entries with hunk identity, file path, header, patch hash, and patch text.
- [x] 5.3 Update stage behavior so accepted hunks do not create review entries.
- [x] 5.4 Update revert behavior so successful reverts create Sheaf Chat rejected-hunk markers.
- [x] 5.5 Update undo behavior so undoing a revert removes the matching rejected-hunk marker.
- [x] 5.6 Implement review serialization, including reverted-hunk markers and their fenced diff blocks, and clear the draft only after successful Dictator insertion.
- [x] 5.7 Add service tests for review draft creation, entry ordering, stale hash preservation, revert marker add/remove, serialization, and clear-on-success.

## 6. Sheaf Chat Dictator RPC Client

- [x] 6.1 Add a Dictator RPC client for Agent Review Mode with connection, reconnect, capability hello, and disconnected status.
- [x] 6.2 Send `(3,3)` cell color updates over `launchpad.setCells` based on Agent Review state.
- [x] 6.3 Handle `launchpad.cellPressed` and `launchpad.cellReleased` events for Sheaf Chat-owned cells.
- [x] 6.4 Call `cursor.insertText` with the serialized review when `(3,3)` is pressed in green away-review state.
- [x] 6.5 Push and pop hunk dictation context blocks when review comment text boxes gain or lose focus.
- [x] 6.6 Add tests using a fake Dictator RPC server for color updates, cell event handling, insertion success/failure, and context push/pop.

## 7. Sheaf Chat Review Comment UI

- [x] 7.1 Add the focused-hunk review comment text box UI near the hunk.
- [x] 7.2 Ensure focusing a hunk with no comment does not show a text box automatically.
- [x] 7.3 Ensure pressing `(3,3)` while a hunk is focused reveals the text box and moves keyboard focus into it.
- [x] 7.4 Ensure focusing a hunk with an existing comment shows that hunk's text box.
- [x] 7.5 Ensure navigating away hides the visible text box while preserving draft content.
- [x] 7.6 Ensure only the current focused hunk's text box is visible.
- [x] 7.7 Add browser/UI tests for the text-box lifecycle and Launchpad-driven focus behavior.

## 8. Validation

- [x] 8.1 Run Dictator Swift tests covering RPC, Launchpad, insertion, context, and removed voice-review behavior.
- [x] 8.2 Run Sheaf Chat tests covering Agent Review Mode service state, Dictator RPC client, and UI lifecycle.
- [x] 8.3 Run a manual smoke test with Dictator, Launchpad, and Sheaf Chat: grey/blue/green `(3,3)`, comment dictation context, serialized review insertion, and no automatic submission.
- [x] 8.4 Update project coverage or operations docs if the new RPC surface changes documented diagnostics or manual test procedures.

## 9. Migrate Hunk Navigation Cells To Sheaf Chat

- [x] 9.1 Define the Agent Review Launchpad cell block in Sheaf Chat (previous/next hunk, previous/next file, stage, revert, undo, plus `(3,3)`) with the prior coordinates and colors.
- [x] 9.2 Send all owned cell colors over `launchpad.setCells`, lighting each navigation/mutation cell only when its action is available and off otherwise.
- [x] 9.3 Route `launchpad.cellPressed` events for navigation/mutation cells to the matching Agent Review command, ignoring presses for unavailable actions.
- [x] 9.4 Add Sheaf Chat tests for navigation-cell color-by-availability, press-dispatches-command, unavailable-press no-op, and unchanged `(3,3)` behavior.

## 10. WebSocket RPC Pipeline Regression Tests

- [x] 10.1 Add a Dictator integration test that boots `DictationHTTPServer` with an RPC service and connects a real masked WebSocket client, asserting `rpc.hello`, a successful method call, and that the upgrade does not crash the service (covers the upgrade handler-removal and client-frame unmasking fixes).
