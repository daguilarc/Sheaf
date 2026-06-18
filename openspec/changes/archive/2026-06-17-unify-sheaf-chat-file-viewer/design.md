## Context

Sheaf Chat's file browser already owns the regular workspace layout: explorer, tabs, file preview, and chat pane. Agent Review Mode separately owns the hunk-aware rendering and review controls for the same files, backed by `projects/sheaf-chat/src/server/agentReview/` and `/ws/agent-review`.

The current split creates two user-visible viewer states. Agent Review duplicates enough of the regular viewer to read files, but the user must still enter a special mode before hunk navigation and review controls are available. The desired behavior is a single file viewer that becomes review-aware whenever Agent Review state reports hunks for the selected workspace.

## Goals / Non-Goals

**Goals:**

- Make the normal tabbed file viewer the only file viewing surface in Sheaf Chat.
- Preserve Agent Review's existing hunk model, mutation commands, review comments, serialized review output, Launchpad behavior, and lifecycle safety.
- Make next/previous hunk operate within the selected file when that file has unstaged hunks.
- Make next/previous file jump from a selected file with no hunks to another file that has unstaged hunks.
- Keep normal Markdown/plain/highlighted file rendering when the selected file has no reviewable hunks.

**Non-Goals:**

- Changing Git hunk parsing, patch hash validation, stage/revert/undo semantics, or serialized review format.
- Adding client-side editing to the file browser.
- Adding a new API separate from the existing Agent Review availability and WebSocket surface.
- Changing Dictator's generic WebSocket RPC contract or Launchpad coordinates.

## Decisions

1. Keep Agent Review service state authoritative, but remove the UI mode boundary.

   The browser should connect to Agent Review for any workspace where it is available and keep that state alongside file workspace state. The regular file viewer decides how to render the selected tab from that state: inline review view when the selected file has reviewable hunks, normal preview otherwise.

   Alternative considered: merge Agent Review state into the chat/file REST API. That would blur a workspace-scoped Git workflow into chat-scoped file reads and would force hunk mutations through file browser contracts that intentionally expose no write/diff API.

2. Anchor review focus to the selected file.

   If the user selects a file with hunks, the viewer should focus one hunk in that file and enable next/previous hunk controls that loop only inside that file, matching current Agent Review behavior. If the user selects a file without hunks, no hunk is focused; next/previous file controls remain available when another file with hunks exists.

   Alternative considered: always force the selected tab to the current Agent Review hunk file. That preserves current review-mode behavior but violates the goal of a single normal file viewer because reading a non-hunk file would be treated as leaving review.

3. Treat next/previous file as review navigation among files with hunks, not ordinary tab navigation.

   The file navigation controls should open/focus adjacent files from Agent Review's ordered file summaries, including when the current selected file has no hunks. Ordinary tabs remain independent: users can still open, switch, and close file tabs normally.

   Alternative considered: use next/previous file to move through open tabs. That conflicts with Agent Review's existing Launchpad semantics and would make physical controls depend on browser tab history rather than review state.

4. Preserve Launchpad and review draft behavior.

   Sheaf Chat continues owning the same Dictator cells and dispatching the same Agent Review commands. Presence gating still depends on whether a browser client is focused. The `(3,3)` review/comment/post cell keeps its current behavior: comment focused hunk when a hunk is focused, or paste serialized review when away with a review draft.

   Alternative considered: disable Launchpad outside files with hunks. That would break the requested ability to jump to another file with hunks from a non-hunk selected file.

## Risks / Trade-offs

- Selected-file state and Agent Review current-hunk state can drift → Mitigation: explicitly synchronize focus when selecting a file with hunks, and explicitly clear hunk focus when selecting a file without hunks while retaining file navigation availability.
- Always connecting Agent Review can add background Git refresh work → Mitigation: keep the existing availability gate and only open the review socket when the workspace root is a Git worktree with Agent Review available.
- Removing the visible mode toggle can obscure why review controls appear → Mitigation: show compact controls and the existing position indicator only when Agent Review state is available, and use normal preview when the selected file has no hunks.
- File tabs for review navigation may proliferate → Mitigation: reuse existing tab deduplication; next/previous file focuses an existing tab for the target file when present.

## Migration Plan

1. Refactor the browser file workspace so Agent Review connection/state is initialized independently from an explicit mode toggle.
2. Replace the Agent Review toggle with conditional hunk-aware controls in the regular file viewer toolbar.
3. Route selected-file changes into Agent Review focus synchronization: select a hunk for files with hunks, clear hunk focus for files without hunks.
4. Reuse existing inline diff document rendering inside the regular file preview path for selected files with hunks.
5. Preserve existing Agent Review WebSocket commands and Launchpad mappings, adding only any command/state support needed for selected-file anchoring.
6. Update tests and docs, then remove dead mode-specific UI branches.

Rollback is to restore the explicit Agent Review toggle and only mount the hunk-aware rendering path while that mode flag is active; server-side Agent Review contracts remain unchanged.

## Open Questions

- None.
