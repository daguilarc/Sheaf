## ADDED Requirements

### Requirement: arm-33 — Test coverage: Randomized hunk state machine
WHEN automated tests cover Agent Review hunk mutation behavior, THE Sheaf Chat test suite SHALL include a deterministic randomized real-Git state-machine test that drives Agent Review through its public WebSocket command surface across many generated mixed staged/unstaged hunk scenarios and validates each operation against an independent semantic oracle rather than a duplicate of the Agent Review hunk parser or verifier.

#### Scenario: Generated repository states cover mixed hunk shapes
- **WHEN** the randomized state-machine test creates a seed fixture
- **THEN** it generates real Git repositories with multiple files and a mix of staged-only, unstaged-only, and mixed staged/unstaged edits
- **AND** the generated edits include replacements, pure insertions, pure deletions, duplicate changed content, close hunks, large insert blocks before later edits, and same-file sibling hunks

#### Scenario: Operation order is randomized
- **WHEN** the randomized state-machine test runs a seed
- **THEN** it chooses a bounded randomized sequence of Agent Review operations from the operations currently meaningful for the model state, including navigation, stage, revert, undo, focus changes, and stale command attempts
- **AND** it does not use a fixed stage/undo/stage-only script as the randomized test's primary proof path

#### Scenario: Semantic oracle predicts outcomes
- **WHEN** the randomized state-machine test prepares and mutates a seed fixture
- **THEN** it tracks expected repository state through generated semantic edit records, expected index file contents, expected worktree file contents, expected undo stack effects, expected rejected markers, and expected command success or failure
- **AND** it does not compute those expectations by reusing or duplicating Agent Review hunk parsing, hunk id construction, patch-hash validation, or post-mutation verifier logic

#### Scenario: Every operation is checked
- **WHEN** the randomized state-machine test executes an Agent Review command
- **THEN** it validates the command result, stale-state flag when applicable, current Agent Review state invariants, Git index contents, worktree contents, staged diff presence, unstaged diff presence, undo availability, and review-draft rejected marker state against the semantic oracle before executing the next command

#### Scenario: Failures are reproducible
- **WHEN** the randomized state-machine test detects an unexpected outcome
- **THEN** the failing assertion identifies the seed, step number, chosen operation, target hunk summary when available, command result, and concise semantic mismatch needed to reproduce and reduce the failure

#### Scenario: Default run is bounded
- **WHEN** the normal Sheaf Chat automated test suite runs
- **THEN** the randomized state-machine test uses a fixed bounded seed and step count suitable for routine automation
- **AND** it provides a deterministic way to run a larger stress seed set locally without changing the test source
