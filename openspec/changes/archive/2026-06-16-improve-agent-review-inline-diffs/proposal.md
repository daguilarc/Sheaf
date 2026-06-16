## Why

Agent Review currently surfaces the focused hunk as a separate patch panel above the file preview, which breaks the sense of reviewing the actual file and hides surrounding changes unless they are selected. Review mode should feel like reading the file with inline diff annotations: additions and deletions visible where they belong, focused hunk colors brighter than background changes, navigation that follows the selected hunk, and comments placed next to the relevant code.

## What Changes

- Replace the fixed/top focused-hunk patch preview with a processed Agent Review file view that interleaves unchanged code, added lines, and deleted old lines inline with the rest of the file.
- Extend Agent Review state with file-scoped review documents for files that contain review hunks, including stable line anchors, hunk membership, old/new line metadata, and focused/non-focused styling roles.
- Display all changes in the open file while in Agent Review Mode, not only the focused hunk.
- Render focused additions/deletions with bright green/red treatments, and non-focused changes with duller green/red treatments.
- Keep the review comment text box adjacent to the focused hunk inside the inline diff view instead of in a separate top panel.
- Make previous/next hunk and previous/next file navigation automatically open the selected file and scroll the focused hunk anchor near the top of the viewport with a small context offset only when the target hunk is not already fully visible.
- After a hunk is accepted and staged, stop showing it as an unstaged red/green diff; the updated file view should reflect the now-staged version of that hunk while continuing to show remaining unstaged changes.
- Use an existing diff parser/algorithm if a suitably small, maintained dependency fits Sheaf Chat's frontend/server model; otherwise implement the file-view builder directly from Git unified diff metadata because the needed behavior is line-oriented and narrow.

## Capabilities

### New Capabilities

- None.

### Modified Capabilities

- `sheaf-chat-agent-review-mode`: Agent Review Mode changes from a focused patch panel to a file-wide inline diff review surface with all hunks visible, focused hunk scrolling, inline comment placement, and staged-result refresh behavior.

## Impact

- Affected code:
  - `projects/sheaf-chat/src/server/agentReview/git.ts`
  - `projects/sheaf-chat/src/server/agentReview/types.ts`
  - `projects/sheaf-chat/src/server/agentReview/service.ts`
  - `projects/sheaf-chat/src/ui/sheaf-chat.js`
  - `projects/sheaf-chat/src/ui/sheaf-chat.css`
  - Agent Review REST/WebSocket tests and UI tests under `projects/sheaf-chat/tests/`
- API/state impact:
  - Agent Review WebSocket/bootstrap/state payloads gain a file-scoped inline diff representation.
  - Existing hunk command and review-comment frames remain conceptually the same, but the browser anchors them to inline diff rows instead of the separate patch panel.
- Dependency impact:
  - Evaluate a small diff parsing package before implementation. If no dependency is clearly better, keep the server implementation dependency-free and build the inline document from `git diff --unified=0` or equivalent parsed hunk ranges plus file content.
- Systems impact:
  - Git side effects remain unchanged: staging/reverting still operate through validated hunk patches and state is recomputed from Git after each mutation.
