## 1. Agent Review State Integration

- [x] 1.1 Audit `projects/sheaf-chat/src/ui/sheaf-chat.js` Agent Review state ownership and identify mode-flag branches that should become unconditional hunk-aware viewer behavior.
- [x] 1.2 Initialize Agent Review availability/socket state for eligible workspaces without requiring an explicit Agent Review toggle.
- [x] 1.3 Preserve Agent Review disconnection/error handling in the unified viewer.
- [x] 1.4 Ensure Agent Review teardown still closes sockets, clears focus, and releases Dictator-owned cells when the workspace editor closes.

## 2. Unified File Viewer Rendering

- [x] 2.1 Remove the separate Agent Review file-viewing mode entry/exit UI while preserving any compact review controls needed in the normal file viewer.
- [x] 2.2 Route selected files with reviewable hunks through the existing inline diff document renderer inside the normal file preview pane.
- [x] 2.3 Keep the normal Markdown, highlighted text, plain text, unsupported-file, and error preview paths for selected files without reviewable hunks.
- [x] 2.4 Preserve normal explorer, tab open/focus/close, tab deduplication, active-tab visibility, pane resize/collapse, mobile panels, file-link interception, and `file.changed` stale-tab behavior while Agent Review state is available.

## 3. Focus And Navigation Semantics

- [x] 3.1 Synchronize selected-file changes into Agent Review focus: focus a hunk when the selected file has hunks and clear hunk focus when it does not.
- [x] 3.2 Keep next-hunk and previous-hunk looping within the selected file's hunks, including single-hunk disablement.
- [x] 3.3 Support next-file and previous-file from a selected file without hunks, opening or focusing the target hunk file in the normal tabbed viewer.
- [x] 3.4 Preserve next-file and previous-file behavior from files with hunks, landing on the first hunk of the adjacent hunk file.
- [x] 3.5 Preserve scroll anchoring: avoid scrolling already-visible hunks and otherwise reveal focused hunk rows with up to three leading inline rows.

## 4. Review Draft, Mutation, And Launchpad Behavior

- [x] 4.1 Preserve stage, revert, undo, stale-state handling, patch-hash validation, and root-scoped Git safety for the focused hunk.
- [x] 4.2 Preserve review comment text-box lifecycle, hidden draft retention, hunk dictation context push/pop, and per-hunk comment placement in the inline viewer.
- [x] 4.3 Preserve rejected-hunk markers, serialized review output, insert-on-`(3,3)`, and clear-on-success behavior.
- [x] 4.4 Preserve Launchpad navigation/mutation/review cell coordinates, colors, dispatch, availability gating, and focused-browser presence semantics in the unified viewer.

## 5. Tests And Documentation

- [x] 5.1 Update UI tests for rendering files with hunks in the normal viewer without pressing an Agent Review toggle.
- [x] 5.2 Add UI tests for selecting a non-hunk file while hunks exist elsewhere, then using next-file or previous-file to jump to a hunk file.
- [x] 5.3 Update existing Agent Review UI tests that assert explicit mode entry/exit to assert unified viewer behavior instead.
- [x] 5.4 Add or update server/rest tests if selected-file anchoring requires new Agent Review command or state behavior.
- [x] 5.5 Update Sheaf Chat docs and coverage notes describing File Browser and Agent Review as one unified file viewer.
- [x] 5.6 Run the Sheaf Chat test suite and a browser smoke test for normal file browsing, hunk navigation, stage/revert/undo, comments, and review insertion.
