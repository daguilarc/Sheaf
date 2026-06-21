## Why

Agent Review hunk-aware files currently use a separate render/decorate path from ordinary file previews, which regressed syntax highlighting and Emacs-style source navigation on files with unstaged hunks. The unified file viewer should treat a file with no hunks as the zero-hunk case of the same source-rendering model, with hunk affordances layered on top rather than replacing normal preview behavior.

## What Changes

- Make the browser file viewer use one source-backed rendering and navigation pipeline for ordinary files and Agent Review files.
- Preserve syntax highlighting for hunk-bearing supported text files, including virtual deletion/addition text where applicable.
- Treat red/green virtual hunk text as addressable text for Emacs point, mark, active region, incremental search, search-origin mark behavior, and mark exchange.
- Support search, point, mark, and highlighting through pure insertions, pure deletions, and edits in Agent Review inline views.
- Add regression coverage that runs the normal no-hunk Emacs and syntax-highlighting scenarios against hunk-bearing files.
- Add a final implementation task to audit the full coverage matrix and implementation for remaining split code paths.

## Capabilities

### New Capabilities

- None.

### Modified Capabilities

- `sheaf-chat-file-browser`: Normal file rendering, syntax highlighting, point, mark, search, minibuffer, and source-offset behavior must also hold when Agent Review hunk affordances are present.
- `sheaf-chat-agent-review-mode`: Inline hunk rendering must become an overlay on the normal unified file viewer behavior, preserving Agent Review-specific rows, colors, navigation, comments, and mutation controls without replacing normal source rendering semantics.

## Impact

- Affects `projects/sheaf-chat/src/ui/sheaf-chat.js` and `projects/sheaf-chat/src/ui/sheaf-file-navigation.js`.
- May require extending Agent Review inline row metadata from `projects/sheaf-chat/src/server/agentReview/git.ts` and related types so the client can project source and virtual diff text ranges deterministically.
- Affects browser/unit/integration tests in `projects/sheaf-chat/tests/ui/` and `projects/sheaf-chat/tests/integration/`, especially tests covering Highlight.js, Emacs navigation/search/mark behavior, and Agent Review inline hunk rendering.
- Does not change public REST or WebSocket route names, hunk mutation semantics, Launchpad command semantics, or file browser write restrictions.
