## Why

Sheaf Chat currently has two file-viewing modes even though Agent Review Mode is a strict superset of the regular file viewer for files with unstaged hunks. This creates duplicated UI state and forces users to switch modes just to navigate or review hunks in the file they are already reading.

## What Changes

- Replace the separate Agent Review entry/exit mode with a single Sheaf Chat file viewer that always uses the normal tabbed file workspace.
- When the selected file has unstaged reviewable hunks, show Agent Review's inline diff rendering, focused-hunk affordances, hunk comments, stage/revert/undo controls, position indicator, and next/previous hunk navigation inside that selected file.
- When the selected file has no unstaged hunks but another file does, keep the normal file preview visible and make next-file/previous-file navigation available so the user can jump to the nearest file with hunks.
- Preserve all existing Agent Review behavior: hunk discovery, in-file hunk looping, file navigation, mutation safety, review draft entries, rejected-hunk serialization, Dictator Launchpad cells, focus gating, dictation context, and teardown semantics.
- Remove user-visible mode switching and any duplicated regular-vs-review file viewer path; Agent Review state should enhance the one file viewer rather than replace it.

## Capabilities

### New Capabilities

- None.

### Modified Capabilities

- `sheaf-chat-file-browser`: the browser workspace's file viewer becomes the only file viewing surface and gains conditional Agent Review affordances based on the selected file and workspace hunk state.
- `sheaf-chat-agent-review-mode`: Agent Review is no longer a separately entered UI mode; its existing behavior is preserved as the hunk-aware behavior of the unified file viewer.

## Impact

- Affects `projects/sheaf-chat/src/ui/sheaf-chat.js` and related CSS/tests for removing the Agent Review toggle path and integrating hunk-aware rendering into the regular file viewer.
- Affects `projects/sheaf-chat/src/server/agentReview/` only where session lifecycle, focus, or current-file anchoring must support always-available viewer integration.
- Affects Sheaf Chat UI, REST/WebSocket integration tests, and docs describing the file browser and Agent Review workflow.
- No new dependencies or external API surfaces are intended.
