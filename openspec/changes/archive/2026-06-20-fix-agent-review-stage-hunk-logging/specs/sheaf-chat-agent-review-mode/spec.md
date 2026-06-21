## ADDED Requirements

### Requirement: arm-31 — Hunk mutation: Mixed index sibling preservation
WHEN an Agent Review stage command targets a hunk in a file that also has staged content, other unstaged hunks, or both, THE Sheaf Chat service SHALL stage only the targeted hunk, preserve every non-target sibling unstaged change in the worktree, tolerate benign Git diff regrouping of the remaining hunks, recompute Agent Review state from Git, and report success unless the target is stale or Git actually failed to apply or verify the mutation.

#### Scenario: Stage after undo in mixed same-file state
- **WHEN** a user stages a same-file hunk, undoes that stage, and then repeatedly stages available hunks in that same file while other staged or unstaged sibling hunks remain
- **THEN** each non-stale stage command succeeds
- **AND** only the targeted hunk moves into the Git index
- **AND** sibling unstaged changes remain present in the worktree

#### Scenario: Remaining hunks regroup after stage
- **WHEN** Git recomputes the unstaged diff after a targeted hunk is staged and represents sibling changes with different hunk headers, grouping, or split boundaries
- **THEN** the service treats the command as successful if the selected hunk is absent and the sibling changed-line content is preserved
- **AND** the service does not roll back solely because a sibling hunk signature changed

#### Scenario: Sibling content actually changes
- **WHEN** post-mutation verification detects that changed-line content from non-target sibling hunks was removed, added, or altered
- **THEN** the service rolls back the mutation when rollback is possible
- **AND** reports a failed command result with a failure message that identifies verification failure without including the hunk patch body

### Requirement: arm-32 — Logging: Launchpad command failures
WHEN an Agent Review command invoked by a Sheaf Chat-owned Launchpad navigation or mutation cell fails, THE Sheaf Chat service SHALL emit the same handled server-error log metadata required for browser Agent Review command failures, including Agent Review feature area, repo id, workspace id, action, stale-state flag when applicable, and failure message, while preserving existing command-result and state refresh behavior for connected Agent Review browser clients.

#### Scenario: Launchpad stage failure is logged
- **WHEN** Dictator reports a press for the Sheaf Chat-owned stage cell and the resulting Agent Review stage command returns `ok: false`
- **THEN** the service emits a handled server-error log entry for the failed stage command
- **AND** the log entry identifies the action as `stage`
- **AND** connected browser clients receive the same command result and state refresh behavior as before

#### Scenario: Launchpad stale command is logged
- **WHEN** a Launchpad-triggered stage, revert, or undo command fails because the focused hunk or patch hash is stale
- **THEN** the service emits a handled server-error log entry with the stale-state flag set
- **AND** the service still recomputes and broadcasts Agent Review state according to the existing hunk command requirements

#### Scenario: Successful Launchpad command is not error-logged
- **WHEN** a Launchpad-triggered stage, revert, undo, or navigation command succeeds
- **THEN** the service does not emit a handled-error log entry for that command
