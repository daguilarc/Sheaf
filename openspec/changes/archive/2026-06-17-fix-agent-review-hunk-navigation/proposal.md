## Why

Agent Review Mode still has sharp edges in real review sessions: staging a non-first hunk can affect the wrong location, the paste-ready review cell can go dark when the browser loses focus, and hunk navigation/mutation can move the reviewer farther than intended. These issues erode trust in the review controls precisely when the user is trying to make selective, non-linear decisions across a diff.

## What Changes

- Fix Agent Review hunk mutation so stage/revert/undo always apply to the targeted hunk snapshot, including hunks later in the same file after non-linear navigation.
- Add randomized browser-level regression coverage that drives Agent Review through fake WebSocket state and fake Dictator RPC events: jump around hunks/files, skip decisions, add/preserve comments, stage/revert/undo selected hunks, paste an armed review, and assert state after each step.
- Keep the `(3,3)` review/comment/post Launchpad cell lit while an active review draft is paste-ready even when no Sheaf Chat browser client is focused, so the user can paste the review elsewhere.
- Fix inline reveal behavior so navigation that must move the viewport honors the existing three-row context offset above the selected hunk when available.
- Stop automatic cross-file advancement after the final hunk in a file is staged or reverted; crossing files happens only through the next-file or previous-file command.

## Capabilities

### New Capabilities

### Modified Capabilities

- `sheaf-chat-agent-review-mode`: Tightens hunk mutation fidelity, inline reveal context behavior, Launchpad review-cell focus gating, and post-mutation file-boundary behavior.

## Impact

- `projects/sheaf-chat/src/server/agentReview/git.ts` and `service.ts`: targeted hunk application, mutation history/undo, post-mutation focus selection, Dictator cell state calculation.
- `projects/sheaf-chat/src/ui/sheaf-chat.js` and related CSS/test helpers: inline reveal target selection, fake WebSocket/browser tests, review draft/comment/paste interaction coverage.
- `projects/sheaf-chat/tests`: new deterministic randomized Agent Review workflow test using fake browser/WebSocket/Dictator surfaces rather than Dictator itself; Playwright may be used if existing test infrastructure supports it cleanly.
- No public REST or WebSocket protocol shape changes are expected, but command semantics and Launchpad cell coloring become stricter.
