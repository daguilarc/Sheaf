# Capability: Agents Skill Distribution

Project: `projects/agents`
ID prefix: `asd` — requirement IDs are append-only; never renumber or reuse.

## Purpose

Maintains shared agent instructions and skills from a canonical
`projects/agents` source tree, then installs them into the harness-specific
locations used by Claude Code, Cursor, Pi, and Codex. This capability owns the
source skill metadata format, global instruction rendering, managed generated
file safety, and Makefile entry points for installing and checking the generated
agent guidance.
## Requirements
### Requirement: asd-1 — Source tree: canonical agents project
WHEN the agents project is implemented, THE repository SHALL contain `projects/agents/` with `global/AGENTS.md` as the canonical global instruction source and `global/skills/` as the canonical shared skill source tree.

#### Scenario: Source tree exists
- **WHEN** a developer inspects the repository root
- **THEN** the `projects/agents/` directory exists
- **AND** `projects/agents/global/AGENTS.md` exists
- **AND** `projects/agents/global/skills/` exists

### Requirement: asd-2 — Skill sources: one directory per shared skill
WHEN a shared skill is added, THE agents project SHALL store it under `projects/agents/global/skills/<skill-id>/` with metadata and a source `SKILL.md` body sufficient to render the skill for every supported harness target.

#### Scenario: Shared skill source exists
- **WHEN** the installer scans `projects/agents/global/skills/`
- **THEN** each shared skill is discoverable as one `projects/agents/global/skills/<skill-id>/` directory
- **AND** each shared skill includes metadata and source markdown

### Requirement: asd-3 — Initial skills: convert prompt drafts
WHEN the agents project is first implemented, THE repository SHALL include shared skills converted from the prompt drafts `about_me.me`, `git_workflow.md`, `incremental_mode.md`, `pyramid_index.md`, and `software_principles.md` found under `/Users/joyo/Desktop/prompt_draft`.

#### Scenario: Initial converted skills are present
- **WHEN** the installer scans the shared skill source tree
- **THEN** it finds source skills for `about-me`, `git-workflow`, `incremental-mode`, `pyramid-index`, and `software-principles`

### Requirement: asd-4 — Install script: harness-specific skill outputs
WHEN `projects/agents/scripts/install.py install` runs, THE installer SHALL render each shared skill into `.claude/skills/<skill-id>/SKILL.md`, `.cursor/skills/<skill-id>/SKILL.md`, `.pi/skills/<skill-id>/SKILL.md`, and `.codex/skills/<skill-id>/SKILL.md`.

#### Scenario: Skills installed
- **WHEN** the install command completes successfully
- **THEN** every shared skill has an installed `SKILL.md` file in the Claude Code, Cursor, Pi, and Codex skill directories

### Requirement: asd-5 — Install script: global instruction outputs
WHEN `projects/agents/scripts/install.py install` runs, THE installer SHALL render `projects/agents/global/AGENTS.md` to repository-root `AGENTS.md` and repository-root `CLAUDE.md`.

#### Scenario: Global instructions installed
- **WHEN** the install command completes successfully
- **THEN** root `AGENTS.md` exists with the rendered global instruction content
- **AND** root `CLAUDE.md` exists with the rendered global instruction content

### Requirement: asd-6 — Install script: managed-file safety
IF an install destination exists, differs from the rendered output, and is not marked as managed by the agents installer, THEN THE installer SHALL fail without overwriting it unless the user explicitly passes a force option.

#### Scenario: Unmarked conflict
- **WHEN** a destination file exists without the managed marker
- **AND** the destination content differs from the rendered content
- **THEN** installation fails before overwriting the file

### Requirement: asd-7 — Check mode: drift detection
WHEN `projects/agents/scripts/install.py check` runs, THE installer SHALL compare the rendered outputs with installed files and exit non-zero if any managed output is missing or stale.

#### Scenario: Installed output is stale
- **WHEN** an installed skill file differs from the rendered source
- **THEN** check mode exits non-zero and reports the stale path

### Requirement: asd-8 — Clean mode: managed output removal
WHEN `projects/agents/scripts/install.py clean` runs, THE installer SHALL remove only files and directories it can identify as managed agents-installer outputs.

#### Scenario: Unmanaged file exists
- **WHEN** clean mode encounters an unmarked file in a harness skill directory
- **THEN** it leaves the unmarked file unchanged

### Requirement: asd-9 — Makefile: delegated agents targets
WHEN the agents project is implemented, THE root Makefile SHALL expose delegated `agents`, `agents-install`, `agents-check`, and `agents-clean` targets that call the matching targets in `projects/agents/Makefile`.

#### Scenario: Agent install target invoked
- **WHEN** a developer runs `make agents-install`
- **THEN** make delegates to `projects/agents/Makefile`
- **AND** the agents installer runs in install mode

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

### Requirement: asd-16 — Shared skill: smoke-test

THE agents project SHALL provide a Sheaf-only `smoke-test` skill under `projects/agents/sheaf/skills/smoke-test/` (a `skill.yaml` with `id: smoke-test` targeting every supported harness plus a source `SKILL.md`) that documents how to ask production Conductor to launch services from the active worktree for human testing, replace the production-port service instances during the session, preserve git-ignored assets from the main checkout via `smoke_test: true`, and poll service health.

#### Scenario: Smoke-test skill source exists

- **WHEN** the installer scans `projects/agents/global/skills/`
- **THEN** the `smoke-test/` skill directory is not present in the global shared skill source tree
- **AND** `projects/agents/sheaf/skills/smoke-test/` is discoverable with a `skill.yaml` (`id: smoke-test`) and a `SKILL.md`

#### Scenario: Skill passes worktree to production Conductor

- **WHEN** an agent opens the `smoke-test` skill
- **THEN** the skill body explains that production Conductor handles smoke-test lifecycle requests
- **AND** it provides a copy-paste script or command sequence that verifies production Conductor is healthy, builds the current worktree services, restarts the asset-dependent services with `smoke_test: true` and a `worktree` path for the current worktree, and polls their health

#### Scenario: Skill describes worktree-code production-asset semantics

- **WHEN** an agent opens the `smoke-test` skill
- **THEN** the skill body explains that restarted services temporarily replace the production-port service instances with services launched from the worktree's code and tracked config
- **AND** it explains that git-ignored assets such as API keys, `.secrets.json`, and models continue to resolve from the main checkout asset root injected by Conductor

#### Scenario: Skill provides origin verification and recovery

- **WHEN** an agent opens the `smoke-test` skill
- **THEN** the skill body provides verification guidance that helps confirm Conductor and the restarted services are running from the worktree rather than the production checkout
- **AND** it provides recovery guidance for returning the production stack after manual smoke testing

#### Scenario: Skill distributes to harness targets

- **WHEN** `make agents-install` runs after the skill is added
- **THEN** the `smoke-test` skill is rendered into each supported harness's skills location alongside the other shared skills

### Requirement: asd-17 — Source tree: Sheaf-only skills

WHEN a skill is specific to this repository rather than suitable for user-global distribution, THE agents project SHALL store it under `projects/agents/sheaf/skills/<skill-id>/` with the same `skill.yaml` metadata and source `SKILL.md` body format used by global shared skills, and THE installer SHALL render it only into repo-local harness skill directories.

#### Scenario: Sheaf-only skill source exists

- **WHEN** the installer scans `projects/agents/sheaf/skills/`
- **THEN** each Sheaf-only skill is discoverable as one `projects/agents/sheaf/skills/<skill-id>/` directory
- **AND** each Sheaf-only skill includes metadata and source markdown

#### Scenario: Sheaf-only skill installs to repo-local targets

- **WHEN** `projects/agents/scripts/install.py install --scope repo` runs
- **THEN** each Sheaf-only skill is rendered into the repo-local harness skill directories selected by its `targets`

#### Scenario: Sheaf-only skill is excluded from user-global targets

- **WHEN** `projects/agents/scripts/install.py install --scope global` runs
- **THEN** Sheaf-only skills are not rendered into user-global harness skill directories

### Requirement: asd-18 — Install script: obsolete global skill cleanup

WHEN a previously global skill is reclassified as Sheaf-only, THE agents installer SHALL remove or report the obsolete managed user-global outputs for that skill during global install, check, and clean operations without deleting unmanaged files.

#### Scenario: Global install prunes obsolete managed skill

- **WHEN** `projects/agents/scripts/install.py install --scope global` runs
- **AND** an obsolete user-global skill output exists with the agents managed marker
- **THEN** the installer removes that obsolete output instead of leaving it installed globally

#### Scenario: Global check reports obsolete managed skill

- **WHEN** `projects/agents/scripts/install.py check --scope global` runs
- **AND** an obsolete user-global skill output exists with the agents managed marker
- **THEN** check mode exits non-zero and reports the obsolete output

#### Scenario: Global cleanup preserves unmanaged skill

- **WHEN** `projects/agents/scripts/install.py clean --scope global` runs
- **AND** an obsolete user-global skill path exists without the agents managed marker
- **THEN** clean mode leaves that file unchanged

### Requirement: asd-19 — Shared skill: OpenSpec Superpowers workflow

WHEN OpenSpec and Superpowers are both used to plan and implement changes, THE agents project SHALL provide a global `openspec-superpowers-workflow` skill under `projects/agents/global/skills/openspec-superpowers-workflow/` with metadata and source instructions that guide agents through converting an OpenSpec change into a Superpowers subagent-driven implementation workflow.

#### Scenario: OpenSpec Superpowers workflow skill source exists

- **WHEN** the installer scans `projects/agents/global/skills/`
- **THEN** it finds an `openspec-superpowers-workflow/` skill directory
- **AND** that directory includes a `skill.yaml` with `id: openspec-superpowers-workflow`
- **AND** that directory includes a source `SKILL.md`

#### Scenario: Skill preserves OpenSpec as source of truth

- **WHEN** an agent opens the `openspec-superpowers-workflow` skill
- **THEN** the skill body instructs the agent to inspect OpenSpec status and apply instructions for the selected change
- **AND** it instructs the agent to read every context file returned by OpenSpec before writing or executing a Superpowers implementation plan

#### Scenario: Skill routes ambiguity through brainstorming

- **WHEN** an agent opens the `openspec-superpowers-workflow` skill
- **THEN** the skill body explains that brainstorming is required before implementation when OpenSpec artifacts are ambiguous, incomplete, or require new design decisions
- **AND** it explains that full brainstorming is not required when the OpenSpec proposal, specs, design, and tasks are already clear and approved

#### Scenario: Skill supports plan-and-execute automation

- **WHEN** an agent opens the `openspec-superpowers-workflow` skill
- **THEN** the skill body explains how to write a Superpowers plan from OpenSpec artifacts
- **AND** it explains how explicit user pre-authorization can allow the agent to execute that plan with `superpowers:subagent-driven-development` without pausing for human checkpoints between plan creation and task execution
- **AND** it requires stopping for ambiguity, blockers, failed agentic infrastructure, approval-required commands, user interruption, or completion

#### Scenario: Skill keeps OpenSpec progress synchronized

- **WHEN** an agent opens the `openspec-superpowers-workflow` skill
- **THEN** the skill body instructs the agent to update OpenSpec task checkboxes only after the corresponding Superpowers task work is complete and verified

#### Scenario: Skill distributes globally

- **WHEN** `projects/agents/scripts/install.py install --scope global` runs after the skill is added
- **THEN** the `openspec-superpowers-workflow` skill is rendered into each supported user-global skill destination selected by its targets
