## Why

Agent Review currently inherits Git's default diff context, so nearby edits can be merged into one review hunk even when the user wants to accept, reject, or comment on them independently. Splitting hunks whenever unchanged source lines sit between edits makes Launchpad review actions more precise and keeps each spoken or typed review comment attached to the smallest practical change.

## What Changes

- Change Agent Review hunk discovery so unchanged lines between edits split those edits into separate hunks instead of being absorbed as shared context.
- Preserve the existing ordered hunk model, patch hash validation, stage/revert/undo behavior, review comments, rejected markers, and serialized review format for the newly smaller hunks.
- Update the Agent Review file viewer so navigation to a newly selected hunk reveals it with three lines of leading context above the hunk when possible, rather than pinning the hunk directly to the top edge.
- Keep binary and unsupported diff handling unchanged.

## Capabilities

### New Capabilities

- None.

### Modified Capabilities

- `sheaf-chat-agent-review-mode`: Agent Review hunk discovery and hunk reveal behavior become more granular and predictable for adjacent-but-separated edits.

## Impact

- `projects/sheaf-chat/src/server/agentReview/git.ts`: hunk discovery and patch construction.
- `projects/sheaf-chat/src/server/agentReview/service.ts`: state refresh, navigation, and mutation behavior should continue to work with smaller hunk snapshots.
- `projects/sheaf-chat/src/ui/sheaf-chat.js`: hunk reveal/scroll positioning in Agent Review Mode.
- Tests under `projects/sheaf-chat/tests/server/rest/agentReview.test.ts`, `projects/sheaf-chat/tests/ui/chatScreen.test.ts`, and any affected integration coverage for Agent Review navigation and inline diff rendering.
