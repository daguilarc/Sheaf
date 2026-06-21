## Context

The observed failure was an Agent Review stage command triggered from the Launchpad after a sequence of staging, undoing, and repeated stage attempts. Tracing showed the selected patch applied, then post-mutation verification rejected the result as "a sibling hunk changed while mutating the selected hunk", causing rollback and an `ok: false` command result. Browser WebSocket command failures already have an error logging path, but Launchpad-originated command failures can bypass that path and leave no useful Sheaf Chat server-log record.

Agent Review hunk mutation currently performs real Git operations and then verifies that the target hunk disappeared while sibling hunks remain. That verifier must distinguish semantic sibling changes from benign Git diff regrouping/reheadering that can happen when nearby same-file hunks are partially staged.

## Goals / Non-Goals

**Goals:**

- Stage only the selected hunk across mixed staged/unstaged same-file states, including after undo and repeated stage attempts.
- Preserve sibling hunks without treating harmless post-apply diff regrouping as corruption.
- Emit a handled server-error log entry for every failed Agent Review mutation command, regardless of whether the command came from the browser WebSocket or Launchpad.
- Add deterministic and seeded randomized real-Git tests so the failure mode is covered by actual index/worktree behavior rather than UI-only fakes.

**Non-Goals:**

- Replace the Agent Review patch application strategy with a new Git abstraction.
- Log successful command traces by default.
- Change Dictator's generic RPC contract or give Dictator ownership of Agent Review state.

## Decisions

1. Use content-preservation verification at the changed-line level for sibling hunks.

   The verifier should continue to require that the selected hunk is gone from the unstaged diff after staging. For sibling preservation, compare multiset counts of normalized changed lines outside the selected hunk rather than comparing whole hunk signatures. This still catches missing or extra sibling edits while tolerating Git's decision to merge, split, or reheader remaining hunks after the selected patch is staged.

   Alternative considered: disable sibling verification and trust `git apply --cached`. That would reduce false negatives, but it would also remove the safety net that catches accidental mutation of adjacent worktree edits.

2. Centralize Agent Review command-failure logging around command results.

   Browser and Launchpad inputs should both call the same helper when a command result has `ok: false`. The helper should include safe correlation metadata: feature, repo id, workspace id, optional client id, optional command id, action, stale flag, and message. It must not include patch bodies or file contents.

   Alternative considered: add ad hoc Launchpad logging only. That would fix the repro but leave two divergent failure paths and make future parity regressions likely.

3. Test with real Git fixtures plus a seeded randomized scenario loop.

   The regression test should exercise the exact shape: multiple same-file hunks, staged/unstaged mixed index state, undo, and repeated stage attempts. The randomized test should generate reproducible line edits and run a small seed set against real temporary repositories. If a seed fails, the test name and assertion should report the seed.

   Alternative considered: mock Git diff/apply responses. Mock tests are useful for protocol behavior, but this bug lives in Git's actual index/worktree semantics and diff regrouping, so mocks would be too weak.

## Risks / Trade-offs

- Changed-line multiset verification can be less precise than whole-hunk signature verification when sibling hunks contain duplicate changed lines. Mitigation: keep multiset counts and add randomized coverage that includes duplicate edit text.
- Real-Git randomized tests can become slow or flaky if too broad. Mitigation: use a fixed seed list, small files, and deterministic assertions.
- Logging every command-result failure can increase stderr volume during repeated hardware presses. Mitigation: log only failures at handled-error severity, not successful command traces.
