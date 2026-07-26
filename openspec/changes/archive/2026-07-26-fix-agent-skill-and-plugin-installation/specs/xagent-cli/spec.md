## MODIFIED Requirements

### Requirement: xa-11 — Distribution: Codex plugin launcher
WHERE xagent is distributed for Codex agents, THE xagent project SHALL provide a globally installable Codex plugin package containing the `xagent-subagents` skill and a stable launcher that executes xagent without requiring the active repository to contain `projects/xagent`, `plugins/xagent`, `node_modules`, or a prebuilt `dist/` directory.

#### Scenario: Installed launcher works outside Sheaf
- **WHEN** a Codex agent invokes xagent from the globally installed plugin while its active repository is not a Sheaf checkout
- **THEN** the launcher starts the packaged xagent runtime from the installed plugin assets
- **AND** it does not read xagent source or plugin files from the active repository

#### Scenario: PATH is not required
- **WHEN** a Codex agent has the xagent plugin installed but no `xagent` binary on `PATH`
- **THEN** the agent can invoke xagent through the launcher path supplied by the installed plugin

#### Scenario: Missing runtime asset
- **WHEN** the installed plugin runtime asset is missing or not executable
- **THEN** the launcher exits non-zero with a diagnostic naming the missing packaged asset

## ADDED Requirements

### Requirement: xa-14 — Distribution: global Codex plugin lifecycle
WHEN a developer invokes the xagent global plugin install target, THE Sheaf build SHALL install or update xagent through Codex's personal-marketplace plugin mechanism without requiring manual marketplace edits.

#### Scenario: Global install target
- **WHEN** `make xagent-plugin-install-global` runs successfully
- **THEN** it builds and validates an untracked temporary xagent plugin package without modifying tracked plugin assets
- **AND** it creates or updates an `xagent` entry in the personal marketplace at `$HOME/.agents/plugins/marketplace.json`
- **AND** that entry uses `source.source: "local"` with a `source.path` that resolves under the invoking home to `$HOME/.agents/plugins/plugins/xagent`
- **AND** it stages the managed plugin package under `$HOME/.agents/plugins/plugins/xagent/`
- **AND** the staged package contains `.sheaf-managed` with exact contents `sheaf-xagent-plugin\n`
- **AND** the entry contains `policy.installation: "AVAILABLE"`, `policy.authentication: "ON_INSTALL"`, and `category: "Productivity"`
- **AND** it reads the marketplace's top-level name and invokes `codex plugin add xagent@<marketplace-name>`
- **AND** `codex plugin list` reports that plugin identity installed and enabled at the staged package path

#### Scenario: Idempotent global update
- **WHEN** the global install target runs while a managed xagent personal-marketplace package is already installed
- **THEN** it replaces the staged package with the newly validated package
- **AND** it applies one fresh Codex cachebuster to the staged manifest
- **AND** it preserves the existing marketplace name, interface metadata, and unrelated plugin entries
- **AND** it reinstalls the same xagent plugin identity without creating a second marketplace entry or plugin identity

#### Scenario: Unmanaged destination conflict
- **WHEN** the intended global xagent package path exists without Sheaf management metadata
- **THEN** global installation exits non-zero without overwriting or deleting that path

#### Scenario: Required plugin infrastructure unavailable
- **WHEN** the Codex CLI, required plugin-creator helper, package validator, or plugin installation command is unavailable or fails
- **THEN** global installation exits non-zero with a diagnostic naming the failed dependency or command
- **AND** it does not silently install through another path

#### Scenario: Launcher remains executable
- **WHEN** the global install target stages the validated plugin package
- **THEN** `$HOME/.agents/plugins/plugins/xagent/scripts/xagent` retains executable permissions

### Requirement: xa-15 — Distribution: single installed owner
WHERE xagent is installed globally for Codex, THE Sheaf installers SHALL install its skill, launcher, and runtime only as members of the xagent plugin package and SHALL NOT deploy duplicate executable or standalone-skill copies to other user-global or repo-local destinations.

#### Scenario: No standalone xagent skill
- **WHEN** agents and xagent global installation complete
- **THEN** `xagent-subagents` is discoverable through the installed xagent plugin
- **AND** no agents-installer-managed `xagent-subagents` skill exists under `$HOME/.agents/skills/` or `$CODEX_HOME/skills/`
- **AND** no repo-local agents-installer-managed `xagent-subagents` skill exists

#### Scenario: No duplicate executable installation
- **WHEN** xagent global installation completes
- **THEN** the installer has not copied `scripts/xagent` or the packaged runtime into `$HOME/.local/bin`, `$HOME/.agents/skills`, `$CODEX_HOME/skills`, or any repo-local `.claude/skills`, `.cursor/skills`, `.pi/skills`, or `.codex/skills` directory
- **AND** the only Sheaf-managed global deployment containing those executable assets is `$HOME/.agents/plugins/plugins/xagent/`
