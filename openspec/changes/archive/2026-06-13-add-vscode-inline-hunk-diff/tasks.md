## 1. Hunk Display Model

- [x] 1.1 Extend the diff parser or hunk model with display-line metadata for context, added, and deleted lines without changing patch text used for stage/revert/undo.
- [x] 1.2 Add unit tests for display-line parsing, including additions, deletions, deletion-only hunks, and replacements that group all added lines before all deleted lines at the new-file position.
- [x] 1.3 Extend pane/review state or add renderer input state so the active file exposes all hunks, current hunk identity, and current/non-current classification to the renderer.

## 2. Inline Decoration Renderer

- [x] 2.1 Add a read-only virtual hunk document provider and renderer that opens generated hunk documents in the editor area.
- [x] 2.2 Implement green added-line decorations for real buffer ranges, with brighter styling for the current hunk and duller styling for non-current hunks.
- [x] 2.3 Implement red deleted-text rendering as synthetic rows in the read-only virtual hunk document, anchored at the hunk's new-file position without editing the real document buffer.
- [x] 2.4 Render replacement hunks as grouped added and deleted blocks rather than interleaved red/green lines, with every source line on its own viewport row and added lines shown before deleted lines.
- [x] 2.5 Add current-hunk boundary cues such as stronger borders, gutter markers, or overview-ruler markers.
- [x] 2.6 Ensure renderer cleanup clears decorations from the previous editor when the active file changes, no hunks remain, or the extension deactivates.

## 3. Extension Integration

- [x] 3.1 Remove the webview-panel review UI path and replace it with activation of the hunk review surface for active-file hunks.
- [x] 3.2 Preserve `paneOpen` and existing Dictator/Launchpad action-state semantics while interpreting the review surface as editor-integrated.
- [x] 3.3 Update previous/next hunk, arrow-key hunk navigation, and previous/next file commands to open or refresh virtual hunk documents and reveal the selected hunk in the editor viewport.
- [x] 3.4 Keep stage, revert, undo, get-current-hunk, and command-result behavior compatible with the existing controller protocol.

## 4. Mapping Layer

- [x] 4.1 Implement a reusable virtual hunk document mapping module with URI round-trip, virtual-row-to-context, hunk-id-to-virtual-span, and real-line-to-virtual-row APIs.
- [x] 4.2 Add unit tests for mapping context rows, added rows, deleted rows, uneven replacements, deletion-only hunks, hunk spans, and virtual URI round trips.

## 5. Tests and Documentation

- [x] 5.1 Add tests for renderer planning and cleanup behavior using VS Code API seams or focused pure planning helpers, including virtual hunk document rendering and separate-row deleted-line rendering.
- [x] 5.2 Update existing hunk model and smoke tests to expect hunk review-surface behavior and no webview panel opening.
- [x] 5.3 Update extension README or operations notes to describe virtual hunk documents, mapping behavior, deleted-text limitations, and Launchpad behavior.
- [x] 5.4 Run the VS Code extension test suite.

## 6. Manual Validation

- [x] 6.1 Manually smoke test in VS Code with additions, deletions, new-file-anchored grouped replacements, deletion-only hunks, multiple hunks, and multiple changed files.
- [x] 6.2 Manually verify current hunk styling is brighter than non-current hunks and that deleted text is visible in red on separate virtual document rows.
- [x] 6.3 Manually verify stage, revert, undo, file switching, active-editor switching, no-hunk cleanup, and viewport jumps during arrow-key hunk navigation.
- [x] 6.4 Manually verify Launchpad LEDs and commands still follow focused VS Code hunk action availability.
