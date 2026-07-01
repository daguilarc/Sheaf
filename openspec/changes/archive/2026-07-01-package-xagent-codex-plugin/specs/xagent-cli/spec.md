## ADDED Requirements

### Requirement: xa-11 — Distribution: Codex plugin launcher
WHERE xagent is distributed for Codex agents, THE xagent project SHALL provide a Codex-installable package containing a stable launcher that executes xagent without requiring the active repository to contain `projects/xagent`, `node_modules`, or a prebuilt `dist/` directory.

#### Scenario: Launcher works outside Sheaf
- **WHEN** a Codex agent invokes the packaged xagent launcher from a repository that is not the Sheaf checkout
- **THEN** the launcher starts the packaged xagent runtime from the plugin assets
- **AND** it does not read xagent source files from the active repository

#### Scenario: PATH is not required
- **WHEN** a Codex agent has the xagent plugin installed but no `xagent` binary on `PATH`
- **THEN** the agent can still invoke xagent through the packaged launcher or tool path documented by the plugin skill

#### Scenario: Missing runtime asset
- **WHEN** the packaged xagent runtime asset is missing or not executable
- **THEN** the launcher exits non-zero with a diagnostic naming the missing packaged asset

### Requirement: xa-12 — Distribution: active repository and central log semantics
WHEN a Codex agent launches packaged xagent from an active repository root, THE packaged xagent runtime SHALL use that active repository root as the child harness working directory while using the configured xagent log root for persisted run logs, defaulting packaged launches to `/Users/joyo/Sheaf/data/xagent`.

#### Scenario: Logs written to main Sheaf repository by default
- **WHEN** the packaged launcher runs `xagent run --harness fake --subagent` from `/tmp/example-repo`
- **THEN** xagent creates run logs under `/Users/joyo/Sheaf/data/xagent/`
- **AND** it does not write run logs under `/tmp/example-repo/data/xagent/`
- **AND** it does not write run logs under the plugin installation directory

#### Scenario: Configured log root override
- **WHEN** `XAGENT_LOG_ROOT` is set before invoking the packaged launcher
- **THEN** xagent writes persisted run logs under that configured log root instead of the default main Sheaf repository log root

#### Scenario: Harness sees active repository
- **WHEN** the packaged launcher starts a child harness from an active worktree
- **THEN** the child harness receives the active worktree as its current working directory

#### Scenario: Codex child bypasses prompts and sandboxing
- **WHEN** the packaged launcher starts the Codex child harness
- **THEN** xagent invokes Codex with its explicit approval-and-sandbox bypass flag
- **AND** the xagent-spawned Codex child does not stop for command approval prompts
- **AND** the xagent-spawned Codex child is not constrained by a restrictive Codex sandbox profile

#### Scenario: Log root unavailable
- **WHEN** the packaged launcher can be invoked but the configured xagent log root cannot be created or written
- **THEN** xagent writes structured JSONL containing an `error` event with `code: "log_root_unavailable"`
- **AND** xagent exits non-zero before starting a child harness

### Requirement: xa-13 — Distribution: packaged runtime validation
WHEN the xagent package is built for Codex distribution, THE build SHALL verify that the packaged launcher can execute xagent help and a fake-harness smoke run using only packaged runtime assets plus the active working directory.

#### Scenario: Help smoke test
- **WHEN** the Codex package build validation runs
- **THEN** it invokes the packaged launcher with `--help`
- **AND** verifies the command exits zero and prints xagent usage

#### Scenario: Fake harness smoke test
- **WHEN** the Codex package build validation runs
- **THEN** it invokes the packaged launcher with `XAGENT_TEST_ADAPTER=fake` from a temporary non-Sheaf repository directory
- **AND** verifies the run exits successfully and writes logs under a configured central log root rather than under that temporary repository
