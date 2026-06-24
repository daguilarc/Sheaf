## Why

Agent Review already has regression coverage for mixed staged/unstaged hunk mutations, but the current randomized test samples a small fixture set and a fixed operation sequence. The recent staging failure shows that this does not prove the hunk review state machine is robust across arbitrary staging, reverting, undoing, navigation, and Git diff regrouping behavior.

## What Changes

- Add a real-Git randomized state-machine test for Agent Review hunk mutation.
- Randomize generated repository contents, staged baseline changes, unstaged worktree changes, and operation sequences across many seeds.
- Drive Agent Review through its public WebSocket command surface rather than helper-only mutation calls.
- Maintain an independent semantic oracle for expected index/worktree/review outcomes after every operation.
- Assert after each command that success, failure, current review state, Git index content, worktree content, undo behavior, and rejected-marker state match the oracle.
- Keep the test deterministic, seed-reporting, and bounded enough for normal automated test runs.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `sheaf-chat-agent-review-mode`: require randomized semantic state-machine coverage for Agent Review hunk mutation correctness and robustness.

## Impact

- Affected project: `projects/sheaf-chat`
- Primary test file: `projects/sheaf-chat/tests/server/rest/agentReview.test.ts`
- Affected implementation areas for test hooks or helpers, if needed: `projects/sheaf-chat/src/server/agentReview/*`
- No user-facing API changes and no new runtime dependencies are expected.
