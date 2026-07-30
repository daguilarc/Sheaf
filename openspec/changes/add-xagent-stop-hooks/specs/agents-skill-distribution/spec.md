## MODIFIED Requirements

### Requirement: asd-6 — Install script: managed-file safety
IF an install destination exists, differs from the rendered output, and is not marked as managed by the agents installer, THEN THE installer SHALL fail without overwriting it unless the user explicitly passes a force option, except that shared `$CODEX_HOME/hooks.json` ownership SHALL be determined by the group-level contract in asd-21 and SHALL never be destructively replaced by `--force`.

#### Scenario: Unmarked conflict
- **WHEN** a destination file other than shared `$CODEX_HOME/hooks.json` exists without the managed marker
- **AND** the destination content differs from the rendered content
- **THEN** installation fails before overwriting the file

#### Scenario: Unmarked valid shared Codex configuration
- **WHEN** `$CODEX_HOME/hooks.json` is valid but carries no agents whole-file marker
- **THEN** installation applies the group-level merge in asd-21
- **AND** it does not treat unrelated valid hook content as an unmanaged whole-file conflict

### Requirement: asd-13 — Global check mode
WHEN `projects/agents/scripts/install.py check --scope global` runs, THE installer SHALL compare rendered user-global outputs with installed user-global files and exit non-zero if any managed output is missing, stale, or blocked by an unmanaged conflicting file, while checking shared `$CODEX_HOME/hooks.json` by the group-level contract in asd-21 rather than whole-file marker or byte equality.

#### Scenario: Global output is missing
- **WHEN** a user-global skill output is missing
- **THEN** global check mode exits non-zero and reports the missing path

#### Scenario: Global output is stale
- **WHEN** a user-global instruction file differs from the rendered source
- **THEN** global check mode exits non-zero and reports the stale path

#### Scenario: Shared Codex configuration contains unrelated groups
- **WHEN** the agents-owned Codex hook group and script are current
- **AND** `$CODEX_HOME/hooks.json` also contains canonical xagent-owned or unrelated valid groups
- **THEN** global check does not report the shared file stale solely because of those groups

### Requirement: asd-14 — Global clean mode
WHEN `projects/agents/scripts/install.py clean --scope global` runs, THE installer SHALL remove only user-global outputs marked as managed by the agents installer, except that it SHALL remove the canonical agents-owned group from shared `$CODEX_HOME/hooks.json` by the group-level contract in asd-21 while preserving all non-agents content.

#### Scenario: Unmanaged global file exists
- **WHEN** global clean mode encounters an unmarked file at a configured global destination other than shared `$CODEX_HOME/hooks.json`
- **THEN** it leaves the unmarked file unchanged

#### Scenario: Shared Codex configuration has agents-owned content
- **WHEN** global clean encounters valid `$CODEX_HOME/hooks.json` containing the canonical agents-owned group
- **THEN** it removes only that group under asd-21
- **AND** it preserves canonical xagent-owned and unrelated valid content

### Requirement: asd-20 — Source tree: Codex global hook assets

WHEN Codex-specific user-global hook behavior is added, THE agents project SHALL store the canonical agents-owned hook-group template and hook script under `projects/agents/global/codex/`.

#### Scenario: Codex hook source assets exist

- **WHEN** a developer inspects `projects/agents/global/codex/`
- **THEN** the Codex hook-group configuration template is present in that tree
- **AND** the hook script that emits the post-compaction reminder is present in that tree

#### Scenario: Codex hook assets remain repository-owned

- **WHEN** the agents installer merges user-global Codex hook outputs
- **THEN** it uses the group template and script under `projects/agents/global/codex/` as the source of truth for agents-owned content
- **AND** it does not require hook source files that live only under `$CODEX_HOME`

### Requirement: asd-21 — User-global Codex hook installation

WHEN `projects/agents/scripts/install.py install --scope global` runs, THE agents installer SHALL install the Codex post-compaction script and merge only the `SessionStart` group identified by the canonical compact matcher and absolute installed-script command into the resolved `$CODEX_HOME/hooks.json`, preserving canonical xagent-owned groups and unrelated valid configuration without requiring the shared JSON file to carry the agents managed marker.

#### Scenario: Global install writes Codex hook outputs

- **WHEN** the global install command completes successfully
- **THEN** the Codex hook script exists under the resolved `$CODEX_HOME`
- **AND** the Codex user-global hook configuration exists under the resolved `$CODEX_HOME`
- **AND** the hook configuration references the installed hook script with a stable absolute path
- **AND** unrelated valid top-level keys and hook groups retain their semantic values and relative order
- **AND** an absent agents-owned group is appended while an existing canonical group is updated in place

#### Scenario: Legacy whole-file marker exists

- **WHEN** valid `$CODEX_HOME/hooks.json` contains the legacy top-level `_sheaf_agents_managed` marker
- **THEN** agents installation removes that whole-file marker during the group-level merge
- **AND** xagent installation tolerates the marker before migration

#### Scenario: Global check validates agents-owned Codex hook outputs

- **WHEN** `projects/agents/scripts/install.py check --scope global` runs
- **THEN** check mode compares the rendered Codex hook script and agents-owned hook group with the installed files
- **AND** check mode exits non-zero if the script or agents-owned group is missing or stale
- **AND** canonical xagent-owned or unrelated valid groups do not make the shared configuration stale

#### Scenario: Global clean removes only agents-owned Codex hook outputs

- **WHEN** `projects/agents/scripts/install.py clean --scope global` runs
- **THEN** clean mode removes the agents-owned hook script and agents-owned group
- **AND** clean mode rewrites the shared configuration when canonical xagent-owned or unrelated valid content remains
- **AND** clean mode removes the configuration file only when no non-agents content remains
- **AND** clean reports that Codex `/hooks` re-approval may be required when positional group indices change

#### Scenario: Shared Codex hook JSON is malformed

- **WHEN** `$CODEX_HOME/hooks.json` is invalid JSON or has an incompatible hooks shape
- **THEN** agents install, check, and clean fail without replacing or deleting it
- **AND** `--force` does not authorize destructive replacement of malformed shared hook configuration

#### Scenario: Repo install does not activate global Codex hooks

- **WHEN** `projects/agents/scripts/install.py install --scope repo` runs
- **THEN** the installer does not write the user-global Codex hook configuration
- **AND** the installer does not write the user-global Codex hook script

## ADDED Requirements

### Requirement: asd-31 — Installer: preserve xagent-managed Codex hooks
WHEN the agents installer processes valid user-global Codex hook configuration, THE installer SHALL manage only the agents-owned post-compaction hook content while preserving canonical xagent-owned `PostToolUse` and `Stop` hook groups and unrelated valid configuration in relative order.

#### Scenario: Global install follows xagent installation
- **WHEN** `$CODEX_HOME/hooks.json` contains canonical xagent-owned hook groups
- **AND** `projects/agents/scripts/install.py install --scope global` runs
- **THEN** the agents installer installs or updates its post-compaction hook
- **AND** the resulting configuration retains exactly one copy of each canonical xagent-owned hook group

#### Scenario: Global check sees valid combined configuration
- **WHEN** the agents-owned post-compaction content is current
- **AND** canonical xagent-owned groups are present and valid
- **THEN** `projects/agents/scripts/install.py check --scope global` does not report those xagent groups as stale agents-owned content

#### Scenario: Global clean sees xagent-owned groups
- **WHEN** `$CODEX_HOME/hooks.json` contains agents-owned and canonical xagent-owned hook groups
- **AND** `projects/agents/scripts/install.py clean --scope global` runs
- **THEN** clean removes the agents-owned hook content
- **AND** it retains the canonical xagent-owned groups and unrelated valid configuration

#### Scenario: Install order is reversed and repeated
- **WHEN** the agents and xagent global installers run repeatedly in either order
- **THEN** the resulting Codex configuration contains one agents-owned post-compaction hook group
- **AND** it contains one canonical xagent observer group and one canonical xagent stop group
- **AND** neither installer deletes or reorders unrelated valid hook groups
- **AND** either installer reports the Codex `/hooks` re-approval boundary after an effective group change that can invalidate positional trust

### Requirement: asd-32 — Installer: preserve xagent Claude hooks atomically
WHEN the managed Superpowers installer updates `$HOME/.claude/settings.json`, THE installer SHALL atomically merge its `enabledPlugins` entry while preserving xagent-owned hooks and unrelated valid settings with a recoverable prior-file backup.

#### Scenario: Superpowers install follows xagent installation
- **WHEN** Claude settings contain canonical xagent observer and stop groups
- **AND** the managed Superpowers global install enables its Claude plugin
- **THEN** both xagent hook groups remain semantically unchanged
- **AND** the Superpowers plugin is enabled

#### Scenario: Claude settings update is interrupted
- **WHEN** the managed Superpowers installer changes an existing Claude settings file
- **THEN** it stages and atomically replaces the JSON file
- **AND** a sibling backup retains the prior content

#### Scenario: Claude settings are malformed
- **WHEN** `$HOME/.claude/settings.json` is invalid JSON or has an incompatible `enabledPlugins` shape
- **THEN** the managed Superpowers installer fails without replacing that file
