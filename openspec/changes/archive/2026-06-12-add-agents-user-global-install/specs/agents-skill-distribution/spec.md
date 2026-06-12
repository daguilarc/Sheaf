## ADDED Requirements

### Requirement: asd-10 — Install scopes: repo, global, and all
WHEN `projects/agents/scripts/install.py` runs in `install`, `check`, or `clean` mode, THE installer SHALL accept a scope option with values `repo`, `global`, and `all`, where `all` is the default and includes both repo-local and user-global outputs.

#### Scenario: Default scope is all
- **WHEN** a developer runs `projects/agents/scripts/install.py install` without a scope
- **THEN** the installer processes both repo-local outputs and user-global outputs

#### Scenario: Repo-only scope
- **WHEN** a developer runs `projects/agents/scripts/install.py install --scope repo`
- **THEN** the installer processes repo-local outputs only

#### Scenario: Global-only scope
- **WHEN** a developer runs `projects/agents/scripts/install.py install --scope global`
- **THEN** the installer processes user-global outputs only

### Requirement: asd-11 — User-global instruction outputs
WHEN `projects/agents/scripts/install.py install --scope global` runs, THE installer SHALL render `projects/agents/global/AGENTS.md` to the user-global instruction paths `$HOME/.claude/CLAUDE.md`, `$HOME/.cursor/AGENTS.md`, `$HOME/.pi/AGENTS.md`, and `$CODEX_HOME/AGENTS.md` with `CODEX_HOME` defaulting to `$HOME/.codex`.

#### Scenario: Global instructions installed
- **WHEN** the global install command completes successfully
- **THEN** `$HOME/.claude/CLAUDE.md` exists with the rendered global instruction content
- **AND** `$HOME/.cursor/AGENTS.md` exists with the rendered global instruction content
- **AND** `$HOME/.pi/AGENTS.md` exists with the rendered global instruction content
- **AND** `$CODEX_HOME/AGENTS.md` exists with the rendered global instruction content

### Requirement: asd-12 — User-global skill outputs
WHEN `projects/agents/scripts/install.py install --scope global` runs, THE installer SHALL render each shared skill into `$HOME/.claude/skills/<skill-id>/SKILL.md`, `$HOME/.cursor/skills/<skill-id>/SKILL.md`, `$HOME/.pi/skills/<skill-id>/SKILL.md`, `$HOME/.agents/skills/<skill-id>/SKILL.md`, and `$CODEX_HOME/skills/<skill-id>/SKILL.md` with `CODEX_HOME` defaulting to `$HOME/.codex`.

#### Scenario: Global skills installed
- **WHEN** the global install command completes successfully
- **THEN** every shared skill has an installed `SKILL.md` file in the Claude Code, Cursor, Pi, documented Codex user skill, and Codex-home skill directories

### Requirement: asd-13 — Global check mode
WHEN `projects/agents/scripts/install.py check --scope global` runs, THE installer SHALL compare rendered user-global outputs with installed user-global files and exit non-zero if any managed output is missing, stale, or blocked by an unmanaged conflicting file.

#### Scenario: Global output is missing
- **WHEN** a user-global skill output is missing
- **THEN** global check mode exits non-zero and reports the missing path

#### Scenario: Global output is stale
- **WHEN** a user-global instruction file differs from the rendered source
- **THEN** global check mode exits non-zero and reports the stale path

### Requirement: asd-14 — Global clean mode
WHEN `projects/agents/scripts/install.py clean --scope global` runs, THE installer SHALL remove only user-global outputs that are marked as managed by the agents installer.

#### Scenario: Unmanaged global file exists
- **WHEN** global clean mode encounters an unmarked file at a configured global destination
- **THEN** it leaves the unmarked file unchanged

### Requirement: asd-15 — Makefile: scoped agents install targets
WHEN the agents project is implemented, THE root Makefile and `projects/agents/Makefile` SHALL expose install, check, and clean targets for all scopes, repo-only scope, and global-only scope.

#### Scenario: Global install target invoked
- **WHEN** a developer runs `make agents-install-global`
- **THEN** make delegates to `projects/agents/Makefile`
- **AND** the agents installer runs in install mode with global scope

#### Scenario: Default install target invoked
- **WHEN** a developer runs `make agents-install`
- **THEN** make delegates to `projects/agents/Makefile`
- **AND** the agents installer runs in install mode with all scope
