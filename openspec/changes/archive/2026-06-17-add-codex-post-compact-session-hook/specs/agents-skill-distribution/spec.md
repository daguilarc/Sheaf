## ADDED Requirements

### Requirement: asd-20 — Source tree: Codex global hook assets

WHEN Codex-specific user-global hook behavior is added, THE agents project SHALL store the canonical hook configuration template and hook script under `projects/agents/global/codex/`.

#### Scenario: Codex hook source assets exist

- **WHEN** a developer inspects `projects/agents/global/codex/`
- **THEN** the Codex hook configuration template is present in that tree
- **AND** the hook script that emits the post-compaction reminder is present in that tree

#### Scenario: Codex hook assets remain repository-owned

- **WHEN** the agents installer renders user-global Codex hook outputs
- **THEN** it uses the files under `projects/agents/global/codex/` as the source of truth
- **AND** it does not require hook source files that live only under `$CODEX_HOME`

### Requirement: asd-21 — User-global Codex hook installation

WHEN `projects/agents/scripts/install.py install --scope global` runs, THE agents installer SHALL install the Codex post-compaction hook into the resolved `$CODEX_HOME` user-global hook location with managed-file safety.

#### Scenario: Global install writes Codex hook outputs

- **WHEN** the global install command completes successfully
- **THEN** the Codex hook script exists under the resolved `$CODEX_HOME`
- **AND** the Codex user-global hook configuration exists under the resolved `$CODEX_HOME`
- **AND** the hook configuration references the installed hook script with a stable absolute path

#### Scenario: Global check validates Codex hook outputs

- **WHEN** `projects/agents/scripts/install.py check --scope global` runs
- **THEN** check mode compares the rendered Codex hook script and hook configuration with the installed files
- **AND** check mode exits non-zero if either file is missing, stale, or blocked by an unmanaged conflict

#### Scenario: Global clean removes managed Codex hook outputs

- **WHEN** `projects/agents/scripts/install.py clean --scope global` runs
- **THEN** clean mode removes managed Codex hook files installed by the agents installer
- **AND** clean mode leaves unmanaged Codex hook files unchanged

#### Scenario: Repo install does not activate global Codex hooks

- **WHEN** `projects/agents/scripts/install.py install --scope repo` runs
- **THEN** the installer does not write the user-global Codex hook configuration
- **AND** the installer does not write the user-global Codex hook script

### Requirement: asd-22 — Codex hook behavior: post-compaction plan reminder

WHEN Codex starts a session with `SessionStart` source `compact`, THE installed Sheaf Codex hook SHALL inject extra developer context reminding the agent to review any active plan, checklist, or task list after compaction.

#### Scenario: Hook emits reminder after compaction

- **WHEN** the hook receives a `SessionStart` event whose source is `compact`
- **THEN** the hook outputs Codex-compatible hook JSON with `hookSpecificOutput.hookEventName` set to `SessionStart`
- **AND** the hook output includes additional developer context containing the reminder "If you were working from a plan, checklist, or task list, please review it after compaction."

#### Scenario: Hook ignores non-compaction starts

- **WHEN** the hook receives a `SessionStart` event whose source is `startup`, `resume`, or `clear`
- **THEN** the hook exits successfully without injecting additional developer context

#### Scenario: Hook output identifies its source

- **WHEN** the hook injects additional developer context
- **THEN** the injected context identifies itself as a post-compaction reminder from the Sheaf Codex hook
- **AND** the injected context does not present itself as a new user request
