## 1. VS Code Extension Scaffold

- [x] 1.1 Create `projects/vs-code-extension` package manifest, TypeScript config, build script, test script, source tree, and test tree.
- [x] 1.2 Add the VS Code extension manifest with hunk-pane commands, activation events, and contribution metadata.
- [x] 1.3 Add root/project build and test integration consistent with existing repo conventions.

## 2. Hunk Model And Git Operations

- [x] 2.1 Implement active workspace/repository resolution for the active text editor.
- [x] 2.2 Implement worktree-vs-index diff loading and unified hunk parsing with path, header, index/count, and patch identity metadata.
- [x] 2.3 Implement current-hunk preservation across recomputes, including nearest-hunk fallback when a hunk disappears.
- [x] 2.4 Implement previous/next hunk and previous/next changed-file navigation.
- [x] 2.5 Implement stage-current-hunk and revert-current-hunk patch operations with structured success/failure results.
- [x] 2.6 Implement undo stack entries for stage and revert, including clean failure behavior that clears the stack and recomputes state.
- [x] 2.7 Add unit tests for diff parsing, hunk identity, navigation, stage/revert command planning, and undo failure handling.

## 3. Pane UI And VS Code Reactivity

- [x] 3.1 Implement the custom peek-like webview pane shell and message bridge.
- [x] 3.2 Render current-file hunks with the current hunk selected and unavailable actions disabled or hidden.
- [x] 3.3 Open/reveal the pane when the active file has unstaged hunks and close/hide it when no active hunks remain.
- [x] 3.4 Wire VS Code events for window focus, active editor changes, open-buffer edits, workspace file-system watcher changes, Git/index changes, and post-command recomputes.
- [x] 3.5 Debounce recomputes and publish a fresh pane/controller snapshot after each relevant state change.
- [x] 3.6 Add extension tests for pane visibility state, action availability, and file-change-triggered recomputes.

## 4. Extension-To-Dictator Protocol

- [x] 4.1 Define JSON message types for extension registration, heartbeat, state snapshot, command request, command result, disconnect, and error.
- [x] 4.2 Implement the extension client connection to Dictator with reconnect and first-snapshot-on-connect behavior.
- [x] 4.3 Send snapshots containing window id, focused state, pane state, current file/hunk metadata, and action availability.
- [x] 4.4 Accept Dictator commands only for the current extension instance and execute the matching hunk operation.
- [x] 4.5 Add protocol/client tests with fake Dictator transport.

## 5. Dictator Protocol Service

- [x] 5.1 Add Dictator service models for VS Code extension instances, hunk pane snapshots, action availability, commands, and command results.
- [x] 5.2 Add a local bidirectional protocol endpoint for VS Code extension clients, preferably WebSocket with REST-compatible diagnostics.
- [x] 5.3 Track connected instances by window id, heartbeat health, focused state, pane state, and last command result.
- [x] 5.4 Select the most recent healthy focused instance as the active VS Code target and clear the active target when no focused healthy instance exists.
- [x] 5.5 Add diagnostics for connected instances, active target, pane state, action availability, and last command result.
- [x] 5.6 Add Dictator service tests for registration, heartbeat expiration, focused-target selection, command routing, and diagnostics.

## 6. Dictator Launchpad Hunk Controls

- [x] 6.1 Implement a `LaunchpadControlLayer` for VS Code hunk controls at `(0,2)`, `(1,2)`, `(2,2)`, `(3,2)`, `(0,3)`, `(1,3)`, and `(2,3)`, with `(3,3)` unused/off.
- [x] 6.2 Render LEDs only for actions reported available by the active VS Code target.
- [x] 6.3 Consume all hunk-control coordinate presses and send commands only when the matching action is lit and the active target is healthy, focused, and pane-open.
- [x] 6.4 Invalidate Launchpad rendering when VS Code snapshots, focus, heartbeat expiry, disconnect, or command results change action availability.
- [x] 6.5 Remove static `(0,2)` through `(3,3)` pads from product and fixture Launchpad layouts.
- [x] 6.6 Replace the old F13-F20 layout test with tests proving reserved coordinates have no static pads and unlit hunk buttons send no keyboard command.
- [x] 6.7 Add Launchpad control-layer tests for LED availability, command dispatch, inactive/off states, and stale-target behavior.

## 7. Integration And Validation

- [x] 7.1 Run VS Code extension unit tests and build.
- [x] 7.2 Run Dictator service tests covering protocol and Launchpad behavior.
- [x] 7.3 Run the relevant repo-level validation commands for `projects/vs-code-extension` and `projects/dictator`.
- [x] 7.4 Manually smoke test with VS Code focused/unfocused, multiple VS Code windows, external file edits, multiple hunks, multiple changed files, stage, revert, and undo.
- [x] 7.5 Update project docs or operations notes for the extension, Dictator protocol endpoint, and Launchpad hunk-control mapping.
