## Context

Agent Review Mode stages, reverts, undoes, and navigates zero-context Git hunks through the Sheaf Chat WebSocket API. Existing tests cover known mixed-index regressions and include a seeded fixture generator, but the randomized test still follows a fixed operation script and only samples a few generated shapes. That leaves gaps when Git reheaders, splits, merges, or emits canceling changed-line pairs after partial index mutation.

The new test should act as a deterministic state-machine check over real Git behavior. It should produce many mixed staged/unstaged same-file and cross-file states, perform randomized operation sequences, and validate every command against an independent semantic oracle.

## Goals / Non-Goals

**Goals:**

- Exercise Agent Review through its public review WebSocket command surface.
- Generate many deterministic repository states with mixed staged and unstaged changes.
- Randomize operation sequences across navigation, stage, revert, and undo.
- Keep a semantic oracle that predicts expected index, worktree, undo stack, rejected markers, and available operations without reimplementing Agent Review hunk parsing.
- Check after every operation that the command result and Git-visible repository state match the oracle.
- Make failures actionable by reporting seed, step, operation, selected hunk summary, command result, and concise semantic diffs.

**Non-Goals:**

- Exhaustively prove Git itself correct.
- Replace focused regression tests for specific historical bugs.
- Add production-only test hooks or alter the public Agent Review protocol solely for the test.
- Require unbounded fuzzing or slow property-test infrastructure in normal CI.

## Decisions

### Use generated semantic edit records as the oracle

The test will generate base files as line records with stable identities, then generate staged and unstaged edit records that map identity ranges to desired index and worktree content. The oracle will track those records as semantic changes: which edit is currently staged, unstaged, reverted, or restored.

Alternative considered: parse Agent Review hunk patches in the test and mirror the service verifier. That would duplicate the code under test and miss bugs where both implementations share the same assumptions.

### Observe Git for actual files, not for expected hunk grouping

After every successful or failed operation, the test will read Git-visible state using stable commands such as `git show :<file>`, worktree file reads, `git diff --cached --numstat`, and `git diff --numstat`. It may use Agent Review state to choose the currently focused command target, but expectations come from the oracle's semantic edit model and the observed index/worktree files.

Alternative considered: assert exact remaining hunk IDs, headers, or patch text. Git regrouping is one of the behaviors the test must tolerate, so exact hunk-shape assertions would be brittle and would recreate the failure mode.

### Randomize commands as a bounded state machine

For each seed, the test will run a bounded number of steps. At each step it will choose among enabled operations: next hunk, previous hunk, next file, previous file, stage, revert, undo, focus a known hunk, and optionally send a stale command captured from earlier state. The oracle will predict whether the command should succeed, fail as stale, or be unavailable, then validate the result and repository state.

Alternative considered: randomize only fixture contents while keeping a fixed stage/undo/stage script. That is the current gap: it samples edit shapes without exploring the command state space.

### Use many small deterministic seeds with targeted shape diversity

The generator will create multiple files, duplicate changed content, pure insertions, pure deletions, replacements, close hunks, large insert blocks before later edits, staged-only edits, unstaged-only edits, and mixed staged/unstaged edits in the same file. Seeds should be fixed and printed in assertions; a smaller smoke set can run by default, with an environment-controlled larger seed count for local stress runs.

Alternative considered: one huge random repository per run. Smaller seeds make failures easier to reduce and keep the test suitable for normal automation.

### Preserve existing focused regressions

The new state-machine test should augment existing targeted tests. Focused tests remain useful documentation for bugs that already escaped and provide quick diagnosis when a specific invariant regresses.

Alternative considered: replace existing tests with the randomized state-machine test. That would reduce clarity and make failures harder to triage.

## Risks / Trade-offs

- [Risk] Randomized coverage can become flaky if it asserts unstable hunk grouping. -> Mitigation: assert semantic file/index/worktree/review outcomes and treat hunk grouping as an implementation detail except when selecting currently exposed command targets.
- [Risk] Failures can be hard to reproduce. -> Mitigation: include seed, step, operation, generated edit summary, focused hunk id/hash, command result, and concise state deltas in assertion messages.
- [Risk] The semantic oracle may accidentally duplicate service logic. -> Mitigation: model edit records and resulting file contents, not Git patch application, hunk IDs, hunk headers, or Agent Review verifier internals.
- [Risk] A broad randomized test can slow CI. -> Mitigation: use a fixed bounded seed/step set in default tests and optionally expand with an environment variable for local stress.
- [Risk] Revert semantics are harder to model for overlapping or dependent edits. -> Mitigation: generate edit records with stable line identities and non-overlapping semantic regions per file, while still allowing Git hunk regrouping through spacing, large insertions, and staged/unstaged combinations.
