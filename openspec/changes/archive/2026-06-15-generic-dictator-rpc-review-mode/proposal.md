## Why

The current Dictator/Sheaf Chat review integration puts too much review-specific behavior inside Dictator: Dictator owns review recording, hunk comments, review serialization, and a specialized Launchpad Web API. That boundary makes Sheaf Chat's review UI harder to reason about and couples audio capture to a workflow that should be normal text entry.

This change replaces the hunk/review-specific Dictator contract with a generic WebSocket RPC surface for Launchpad cells, cursor insertion, and transient dictation context. Sheaf Chat then owns Agent Review Mode state and uses the generic surface to drive the Launchpad and paste serialized reviews.

## What Changes

- Add a generic Dictator WebSocket RPC API that supports:
  - app/client registration and heartbeat
  - owned Launchpad cell color updates
  - generic Launchpad cell pressed/released events
  - cursor text insertion with clipboard-preserving paste semantics
  - push/pop dictation context blocks
- **BREAKING** Replace Dictator's specialized hunk-review provider API and voice diff review ownership with generic RPC calls.
- **BREAKING** Remove Dictator-owned review recording, review entry storage, reverted-hunk review tracking, and review serialization.
- Completely remove `(2,7)` from the review workflow.
- Use `(3,3)` as the single logical review/comment/post Launchpad control.
- Migrate the existing hunk navigation and mutation Launchpad cells (previous/next hunk, previous/next file, stage, revert, undo) to Sheaf Chat ownership over the generic RPC, preserving their prior positions and colors. Dictator no longer renders or routes these cells itself; Sheaf Chat sets their colors from action availability and dispatches the matching Agent Review command on press.
- Preserve the old review-button color language at `(3,3)`: off, grey, blue, green; red is no longer part of the review-comment control because it no longer records audio.
- Make Sheaf Chat own Agent Review Mode comments, hunk association, reverted markers, review serialization, and clearing-on-success.
- Replace the old record-review flow with a hunk-local comment text box:
  - focusing a hunk with no comment does not show a text box
  - pressing `(3,3)` creates/reveals the text box and focuses it
  - focusing a hunk with an existing comment shows its text box
  - only the current focused hunk's text box is visible
  - navigating away hides the current text box, and navigating back restores it if a comment exists
- Let Sheaf Chat call Dictator's cursor insertion RPC with the serialized review when the Launchpad review/post cell is pressed in away-review mode.
- Let Sheaf Chat push hunk context to Dictator while the review comment text box has focus, so normal dictation can use the current hunk as context without Dictator knowing about reviews.

## Capabilities

### New Capabilities

- `dictator-websocket-rpc`: Generic local WebSocket RPC protocol for external apps to own Launchpad cells, receive cell events, request cursor insertion, and manage pushed dictation context.

### Modified Capabilities

- `dictator-launchpad`: Remove the specialized `(2,7)` voice review pad and hunk-provider routing, and support the single `(3,3)` Sheaf Chat review/comment/post cell through generic external ownership.
- `dictator-voice-diff-review`: Retire Dictator-owned voice diff review state, review recording, reverted-hunk tracking, serialization, and diagnostics.
- `sheaf-chat-agent-review-mode`: Move review state, hunk comments, review serialization, Launchpad cell state, Dictator RPC integration, and hunk-context push/pop ownership into Sheaf Chat.

## Impact

- `projects/dictator/src/Sources/DictatorService/`: replace hunk-review HTTP endpoints/control layers with a WebSocket RPC server, generic external Launchpad cell ownership, cursor insertion RPC, and context-stack storage.
- `projects/dictator/src/launchpad/launchpad-layout.json` and fixtures: ensure `(2,7)` is not part of the review workflow and `(3,3)` is available for Sheaf Chat's externally owned review/comment/post cell.
- `projects/sheaf-chat/src/`: update Agent Review Mode service/UI to own comments and review serialization, connect to Dictator over WebSocket RPC, set `(3,3)` cell colors, handle cell events, call cursor insertion, and push/pop context around comment text-box focus.
- Tests across Dictator Swift service code and Sheaf Chat TypeScript code need to cover RPC framing, Launchpad rendering/event routing, insertion success/failure, context stack behavior, comment text-box lifecycle, and review clearing semantics.
