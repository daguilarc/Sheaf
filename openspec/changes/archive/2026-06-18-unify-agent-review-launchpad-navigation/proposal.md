## Why

Agent Review Launchpad navigation can light the correct cells while pressing them fails to produce the same visible navigation as pressing the matching browser buttons. This happened because unified file-viewer behavior made some post-command UI synchronization browser-origin-specific, and the existing fake Dictator RPC tests do not prove Launchpad-originated navigation behaves identically.

## What Changes

- Add parity tests for Agent Review navigation flows that run the same scenarios through browser command buttons and through fake Dictator WebSocket RPC `launchpad.cellPressed` events.
- Ensure the Launchpad path produces the same Agent Review command semantics as the browser path, especially for cross-file navigation and selected-file changes in the unified file viewer.
- Require tests to fail against the current incorrect Launchpad behavior before implementation fixes it.
- Tighten the Agent Review contract so any intentional difference between browser and Launchpad command behavior must be explicit and justified.
- Preserve browser-only behavior only where the Launchpad action is not equivalent to a browser command, such as the review/comment/post cell.

## Capabilities

### New Capabilities

- None.

### Modified Capabilities

- `sheaf-chat-agent-review-mode`: Agent Review navigation and mutation commands exposed on Launchpad-owned cells must be behaviorally equivalent to the corresponding browser controls, and tests must cover both command origins through the unified file viewer.

## Impact

- `projects/sheaf-chat/src/server/agentReview/service.ts`
- `projects/sheaf-chat/src/ui/sheaf-chat.js`
- `projects/sheaf-chat/tests/server/rest/agentReview.test.ts`
- `projects/sheaf-chat/tests/ui/chatScreen.test.ts`
- No new runtime dependencies are expected.
