## Why

Agent Review stage-hunk failures can currently look like no-ops when they are triggered from the Launchpad: the command can fail and roll back, but the failure is not reliably emitted to Sheaf Chat server logs or surfaced through the same command path as the browser control. The bug also exposed a testing gap around real Git index/worktree transitions after staging, undoing, and rapidly staging hunks again.

## What Changes

- Make Agent Review hunk staging resilient to mixed staged and unstaged hunks in the same file, including after undo and repeated stage attempts.
- Treat Launchpad navigation/mutation presses as first-class Agent Review commands for failure logging, parity checks, state refresh, and command-result semantics.
- Ensure handled Agent Review command failures are logged to Sheaf Chat server stderr with stable, safe metadata whether they originate from a browser WebSocket command or a Dictator Launchpad cell press.
- Add deterministic real-Git regression coverage for the staged/undo/re-stage failure and seeded randomized real-Git coverage over mixed index/worktree hunk scenarios.

## Capabilities

### New Capabilities

- None.

### Modified Capabilities

- `sheaf-chat-agent-review-mode`: tighten hunk mutation and Launchpad/browser command parity requirements for mixed staged/unstaged same-file hunks and command failure logging.
- `sheaf-chat-service`: clarify that handled server-error logging includes Agent Review command failures produced by non-browser control surfaces such as Launchpad input.

## Impact

- `projects/sheaf-chat/src/server/agentReview/service.ts`
- `projects/sheaf-chat/src/server/agentReview/git.ts`
- `projects/sheaf-chat/src/ui/sheaf-chat.js`
- `projects/sheaf-chat/tests/server/rest/agentReview.test.ts`
- Smoke deployment for only the `sheaf-chat` service through Conductor after rebuilding.
