## 1. Regression Tests

- [x] 1.1 Add a deterministic real-Git Agent Review test that stages, undoes, and repeatedly stages same-file hunks while staged and unstaged sibling changes remain.
- [x] 1.2 Add seeded randomized real-Git Agent Review coverage for mixed index/worktree hunk staging and sibling preservation.
- [x] 1.3 Add a Launchpad-originated command failure test that asserts Sheaf Chat emits the handled server-error log metadata without changing command-result/state behavior.

## 2. Implementation

- [x] 2.1 Update hunk mutation verification to tolerate benign Git diff regrouping while still rejecting actual sibling changed-line loss or mutation.
- [x] 2.2 Centralize Agent Review command-failure logging so browser WebSocket commands and Launchpad cell commands use the same safe stderr log path.
- [x] 2.3 Remove or gate temporary trace logging so production keeps failure logs without noisy success-path tracing.

## 3. Verification And Deployment

- [x] 3.1 Run the targeted Agent Review server tests and Sheaf Chat build.
- [x] 3.2 Rebuild Sheaf Chat and redeploy only the `sheaf-chat` service through the smoke-test workflow.
- [x] 3.3 Capture final status, including any remaining repro evidence or redeploy blockers.
