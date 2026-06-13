## Why

The current VS Code unstaged-hunk UI opens as a separate webview panel beside the editor, which makes hunk review feel detached from the file being edited and visually flattens the diff into one pane. The desired workflow is closer to VS Code's inline peek/diff experience: review additions and deletions directly in the active editor, with the current hunk clearly distinguished from nearby hunks.

## What Changes

- Remove the separate hunk webview panel entirely and replace it with a read-only virtual hunk document opened in the editor area.
- Highlight added and deleted changed regions using traditional green and red diff colors.
- Render the selected hunk with brighter red/green styling and render other hunks in duller red/green styling.
- Display deleted text as real rows in the read-only virtual hunk document, while keeping edits and Git operations targeted at the underlying real file.
- For replacement hunks, group display at the new-file position: show the added/replacement code together first and show the deleted code together immediately adjacent to that new-code block, instead of anchoring deleted lines at their original line numbers or interleaving red and green lines within the same hunk.
- Keep the existing hunk model, navigation, stage, revert, undo, and Dictator/Launchpad controller semantics, but publish enough file hunk detail for the inline renderer to draw all hunks in the active file.
- Make hunk navigation, including arrow-key-driven previous/next hunk navigation, reveal the selected hunk in the active editor viewport.
- Delete the webview-panel review UI so the hunk review experience is integrated into the main editor tab rather than opened as a separate tab or side pane.
- Add a reusable virtual-document mapping layer that maps real file positions and hunk identities to virtual document rows, and maps virtual rows back to the underlying real file/hunk context for future extension features.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `vs-code-extension-unstaged-hunk-pane`: change the hunk review rendering requirement from a separate custom pane to read-only virtual hunk documents that show additions, deletions, current-hunk emphasis, viewport reveal behavior, and reusable real-to-virtual row mappings.

## Impact

- Affects `projects/vs-code-extension`, especially the hunk rendering layer, removal of pane/webview review code, hunk model state shape, virtual-document content provider, reusable row-mapping layer, and extension host integration with active text editors.
- Existing hunk navigation and mutation commands should continue to work, including Launchpad-driven previous/next hunk, stage, revert, and undo.
- Dictator service models may need no behavioral change if controller state semantics remain stable, but the VS Code extension may include richer hunk-detail state internally for rendering.
- Tests should cover diff-line parsing needed for inline display, decoration-range planning, current versus non-current styling, cleanup when no hunks remain, and preservation of controller action availability.
