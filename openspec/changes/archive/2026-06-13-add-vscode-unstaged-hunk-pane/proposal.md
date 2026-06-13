## Why

Native VS Code peek views can be opened by extensions, but they do not expose reliable public state for the currently viewed hunk or for external hardware feedback. A dedicated VS Code extension and Dictator Launchpad bridge can provide fast, bidirectional hunk navigation with LEDs that reflect whether each action is currently useful.

## What Changes

- Add a new `projects/vs-code-extension` project that owns a custom peek-like unstaged-changes pane for the focused VS Code window.
- The extension tracks worktree-vs-index hunks for the active file, opens/closes the pane based on whether the current file has unstaged changes, and tracks the current hunk.
- The extension exposes commands for previous/next hunk, previous/next changed file, get current hunk, stage current hunk, revert current hunk, and undo last stage/revert operation.
- The extension reacts promptly when files change, including edits made by other agents or tools, and pushes updated pane/action state to Dictator.
- Dictator receives VS Code pane state, renders Launchpad LEDs only for available hunk actions, and sends button actions only when VS Code is focused and the reported state says the action can apply.
- Remove the existing Launchpad high-function-key pad rectangle at `(0,2)` through `(3,3)`; those pads stop sending F13-F20 and become dynamically owned by the VS Code hunk-control layer.
- Add a bidirectional controller protocol between the VS Code extension and Dictator, preferably a persistent local WebSocket connection with REST-compatible semantics where useful.

## Capabilities

### New Capabilities
- `vs-code-extension-unstaged-hunk-pane`: custom VS Code extension project, unstaged hunk pane state, hunk navigation/mutation commands, undo behavior, file-change reactivity, and Dictator state/action protocol from the extension side.
- `dictator-vscode-hunk-controls`: Dictator Launchpad control layer, VS Code window/pane state ingestion, LED rendering, button gating, hunk action dispatch, and removal of the old F13-F20 pad rectangle.

### Modified Capabilities
- `dictator-launchpad`: remove the default-layout requirement that maps `(0,2)` through `(3,3)` to F13-F20 and replace it with VS Code hunk-control ownership of those coordinates.

## Impact

- New project under `projects/vs-code-extension` with TypeScript VS Code extension build/test tooling.
- Dictator service changes under `projects/dictator/src/Sources/DictatorService/`, especially Launchpad layout/control-layer integration and the web/control API surface used by external clients.
- Launchpad layout files and tests under `projects/dictator/src/launchpad/` and `projects/dictator/tests/`.
- Local IPC protocol between the extension and Dictator for focused-window state, pane state, button commands, heartbeats, disconnect handling, and LED invalidation.
- Git operations for hunk parsing, staging, reverting, and undo require careful patch identity and clean-failure behavior when files change concurrently.
