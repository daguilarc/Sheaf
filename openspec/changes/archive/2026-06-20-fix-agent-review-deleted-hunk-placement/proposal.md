## Why

Agent Review's inline file view can display pure deleted lines one live line too early when Git reports a zero-context deletion with a zero-length new range. This makes the Sheaf Chat review surface disagree with the original hunk shown in chat and can make a removed member appear outside the block where it originally lived.

## What Changes

- Correct inline diff document construction for pure deletion hunks so deleted rows are inserted after the preceding new-file line encoded by Git's `+N,0` range.
- Preserve existing placement for replacements, additions, and mixed hunks whose new range contains live file rows.
- Add regression coverage for deleted-only hunks adjacent to unchanged context, including deletion after an opening brace or similar boundary line.

## Capabilities

### New Capabilities

- None.

### Modified Capabilities

- `sheaf-chat-agent-review-mode`: clarify that inline diff document rows preserve Git hunk order for zero-context deletion ranges, including pure deletions represented by zero-length new-file ranges.

## Impact

- Affected code: `projects/sheaf-chat/src/server/agentReview/git.ts`.
- Affected tests: Agent Review REST/state tests covering inline diff document row ordering.
- APIs and protocol shape remain unchanged; the fix only changes row ordering in existing `inlineFiles` state.
- No new dependencies.
