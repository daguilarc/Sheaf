## Context

VS Code's native peek widget is not observable enough for hunk-aware hardware control: extensions can open peek locations, but cannot reliably read the currently selected/visible hunk from the public API. Dictator already owns the Launchpad MIDI surface and has a `LaunchpadControlLayer` abstraction that can override pad colors and consume pad events before static layout cells. The new shape is therefore a dedicated VS Code extension that owns an unstaged-hunk pane and a Dictator bridge that mirrors its action state onto Launchpad LEDs.

The user workflow is hardware-first: when VS Code is focused and the active file has unstaged changes, Launchpad pads light for actions that can actually run. When VS Code is not focused, no extension instance is active, no current file has unstaged changes, or an action is unavailable, the matching pad stays off and Dictator sends no command.

## Goals / Non-Goals

**Goals:**
- Add `projects/vs-code-extension` as a standalone VS Code extension project for the unstaged-hunk pane, separate from the existing realtime-agent voice extension.
- Render a custom peek-like webview for worktree-vs-index hunks in the active file, opening only when that file has unstaged changes.
- Maintain a precise current hunk and expose hunk/file navigation, stage, revert, get-current-hunk, and undo operations.
- React promptly when files or Git state change, including edits made by external agents or tools.
- Stream pane/action state from each VS Code window to Dictator and accept commands back from Dictator for the focused window.
- Replace Dictator's `(0,2)` through `(3,3)` high-function-key rectangle with a dynamic VS Code hunk control layer.

**Non-Goals:**
- Do not try to control or observe VS Code's native peek pane.
- Do not build a redo stack.
- Do not make Dictator infer Git state from the filesystem; VS Code extension state is authoritative.
- Do not send hidden F13-F20 keystrokes for the hunk controls.
- Do not require the hunk pane to operate across multiple repositories in one command; repository scoping follows the active file.

## Decisions

### Dedicated extension project

Create `projects/vs-code-extension` instead of extending `projects/realtime-agent/src/vscode-extension`. The existing extension is scoped to realtime voice sessions, OpenAI configuration, chat UI, and editor tools; the hunk pane is a hardware/Git control extension with a different lifecycle and no Realtime dependency.

Alternative considered: fold the hunk pane into the realtime-agent VS Code extension. That would reuse some editor access helpers, but it would couple a small hardware control surface to voice-session startup, API-key settings, and realtime build dependencies.

### Extension owns Git hunk state

The extension computes unstaged changes as worktree-vs-index hunks for the active file and tracks current file/current hunk in memory. Hunk identity should be based on file path plus patch header/content hash, with graceful fallback when the current hunk disappears after a recompute.

Alternative considered: Dictator computes Git diffs. That would duplicate workspace/repository detection outside VS Code and lose direct access to active-editor and window focus events.

### Custom webview pane

Use a VS Code webview panel or webview view with a compact diff renderer that behaves like a peek pane from the user's perspective. The extension controls pane open/close/reveal state: no active file or no unstaged hunks closes/hides it; active hunks opens/reveals it and highlights the current hunk.

Alternative considered: native `editor.action.peekLocations`. This can open peek UI but cannot expose the current selected hunk or reliable visibility state.

### Reactive state recomputation

The extension listens to all relevant local state sources and debounces recomputation:
- `window.onDidChangeWindowState` for focused window state.
- `window.onDidChangeActiveTextEditor` and text editor selection/visible-range events for active file context.
- `workspace.onDidChangeTextDocument` for open-buffer edits.
- `workspace.createFileSystemWatcher` for disk changes made by external agents/tools.
- Git extension/repository state events where available, plus explicit recompute after extension-issued stage/revert/undo operations.

This gives the "onFileChanged" behavior: if another agent writes a file, the watcher fires, the extension recomputes hunks, updates the pane, and sends fresh state to Dictator.

### Bidirectional controller protocol

Prefer a persistent local WebSocket connection from each VS Code extension instance to Dictator. Each instance registers with a generated `windowId`, sends heartbeats and state snapshots, and marks whether its VS Code window is focused. Dictator treats the most recent focused healthy instance as authoritative and sends button commands back to that instance.

REST endpoints can exist for diagnostics or fallback, but button-to-LED feedback benefits from a live bidirectional connection.

### Dictator Launchpad control layer

Implement a `LaunchpadControlLayer` for the VS Code hunk controls. It owns:

```text
(0,2) revert current hunk
(1,2) previous hunk
(2,2) stage current hunk
(3,2) undo
(0,3) previous changed file
(1,3) next hunk
(2,3) next changed file
```

The layer renders `.off` for unavailable actions and consumes presses for its coordinates so no static fallback keystroke can leak through. The static layout removes `(0,2)` through `(3,3)`, including `(3,3)`, and no longer maps those pads to F13-F20.

## Risks / Trade-offs

- [Git patch apply can fail after concurrent edits] -> Stage/revert/undo commands return structured failure, trigger a full recompute, and clear the undo stack when an undo no longer applies cleanly.
- [File watchers can be noisy or miss a race] -> Debounce recomputes and also recompute after focus, active-editor, Git, and command events.
- [Multiple VS Code windows can report stale state] -> Require heartbeats, focused-window state, and timeout stale instances before sending commands.
- [WebSocket connection can drop] -> Dictator turns hunk LEDs off when no focused healthy instance exists; the extension reconnects with a fresh state snapshot.
- [The custom pane may not feel exactly like native peek] -> Keep it compact and action-oriented, and prioritize reliable state/control over exact native widget fidelity.

## Migration Plan

1. Add OpenSpec-backed scaffolding for `projects/vs-code-extension`.
2. Implement the extension hunk model and local pane UI with tests against sample diffs.
3. Add the Dictator protocol endpoint and hunk control layer behind default-off behavior.
4. Remove the static F13-F20 Launchpad rectangle from product and fixture layouts.
5. Wire extension-to-Dictator state snapshots and Dictator-to-extension commands.
6. Validate with automated tests first, then a manual Launchpad/VS Code smoke test.

Rollback is straightforward: stop the extension or disconnect from Dictator; Dictator should turn all hunk LEDs off and the existing non-hunk Launchpad controls continue working.

## Open Questions

- Exact transport framing: raw WebSocket JSON messages versus HTTP long-poll/SSE plus POST commands.
- Whether the custom pane should be a `WebviewPanel`, a side `WebviewView`, or both.
- Whether "current hunk" should follow editor cursor position automatically or only change through Launchpad/webview navigation.
