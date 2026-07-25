## MODIFIED Requirements

### Requirement: asd-4 — Install script: repo-local target-specific skill outputs
WHEN `projects/agents/scripts/install.py install --scope repo` runs, THE installer SHALL render only Sheaf-specific skills from `projects/agents/sheaf/skills/` into the repo-local harness skill directories selected by each skill's `targets` metadata and SHALL NOT render shared skills from `projects/agents/global/skills/` into repo-local harness directories.

#### Scenario: Sheaf-only skills installed for selected repo-local targets
- **WHEN** the repo-local install command completes successfully
- **THEN** every Sheaf-only skill has an installed `SKILL.md` file in each selected repo-local harness skill directory
- **AND** the installer does not create repo-local skill outputs for harness targets omitted from the skill metadata

#### Scenario: Shared global skill is not installed repo-locally
- **WHEN** a skill exists under `projects/agents/global/skills/<skill-id>/`
- **AND** repo-local install runs successfully
- **THEN** the installer does not render that skill under `.claude/skills/`, `.cursor/skills/`, `.pi/skills/`, or `.codex/skills/`

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

#### Scenario: Skill distributes only to repo-local harness targets

- **WHEN** `make agents-install-repo` runs after the skill is added
- **THEN** the `smoke-test` skill is rendered into each supported repo-local harness skills location selected by its targets
- **AND** `make agents-install-global` does not render `smoke-test` into any user-global skill location

### Requirement: asd-23 — Shared skill: xagent-subagents

WHEN Codex review or subagent work benefits from cross-provider opinions, THE xagent Codex plugin SHALL provide a Codex-only `xagent-subagents` skill under `plugins/xagent/skills/xagent-subagents/`, and THE agents project SHALL NOT install a standalone repo-local or user-global copy of that plugin-owned skill.

#### Scenario: xagent-subagents skill has one canonical source

- **WHEN** the xagent plugin source is inspected
- **THEN** `plugins/xagent/skills/xagent-subagents/SKILL.md` exists
- **AND** `projects/agents/global/skills/xagent-subagents/` does not exist
- **AND** `projects/agents/sheaf/skills/xagent-subagents/` does not exist

#### Scenario: Skill directs Codex to use Claude through xagent for review

- **WHEN** Codex opens the plugin-provided `xagent-subagents` skill for review work
- **THEN** the skill body instructs Codex to run the packaged xagent launcher from the active worktree root
- **AND** the skill body instructs Codex to use `xagent run --harness claude_code` for cross-provider review opinions when appropriate
- **AND** the skill body instructs Codex to include the review scope, expected output shape, and relevant files or diffs in the subagent prompt

#### Scenario: Skill explains repository-independent use

- **WHEN** Codex opens the plugin-provided `xagent-subagents` skill
- **THEN** the skill explains that xagent is launched from the active worktree root so child harnesses use that repository
- **AND** it explains that the executable runtime is supplied by the installed Codex plugin rather than by the active repository
- **AND** it explains that packaged xagent defaults persisted logs to `/Users/joyo/Sheaf/data/xagent`

#### Scenario: Skill documents Claude model tiers

- **WHEN** Codex opens the plugin-provided `xagent-subagents` skill
- **THEN** the strongest-review command example uses `--model opus`
- **AND** the surrounding guidance does not recommend the stale dotted alias `claude-opus-4.8`
- **AND** the skill instructs Codex to verify unfamiliar Claude Code model aliases locally before retrying
- **AND** it instructs Codex not to silently downgrade to a weaker model after a model rejection

#### Scenario: Skill documents Cursor and GPT worker routing

- **WHEN** Codex opens the plugin-provided `xagent-subagents` skill
- **THEN** the skill body identifies Cursor Composer 2.5 as a capable worker option through the Cursor harness
- **AND** the skill body instructs Codex to prefer a GPT or Codex-backed worker agent for the trickiest implementation tasks

#### Scenario: Skill explains invocation and harness permission failures

- **WHEN** Codex opens the plugin-provided `xagent-subagents` skill
- **THEN** it explains that sandboxed agents can invoke xagent but real runs may fail with `log_root_unavailable` or harness-specific errors when they lack write, network, auth, or process permissions

#### Scenario: Skill preserves agentic infrastructure escalation

- **WHEN** the packaged xagent launcher or tool, Claude Code, Cursor Agent, or a selected model cannot be launched as instructed
- **THEN** the skill body instructs Codex to surface the failure instead of silently working around broken agentic infrastructure

### Requirement: asd-18 — Install script: obsolete global skill cleanup

WHEN a previously global skill becomes Sheaf-only or plugin-owned, THE agents installer SHALL remove or report the obsolete managed user-global outputs for that skill during global install, check, and clean operations without deleting unmanaged files.

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

#### Scenario: Plugin-owned standalone skill is pruned globally

- **WHEN** global agents installation runs after `xagent-subagents` becomes plugin-owned
- **AND** a standalone user-global `xagent-subagents` output exists with the agents managed marker
- **THEN** the installer removes that obsolete standalone skill output
- **AND** it does not remove the xagent plugin's bundled skill

## ADDED Requirements

### Requirement: asd-24 — Install script: obsolete repo-local global skill cleanup
WHEN shared skills are user-global only, THE agents installer SHALL remove or report obsolete managed repo-local outputs previously rendered from `projects/agents/global/skills/` during repo install, check, and clean operations without deleting unmanaged files.

#### Scenario: Repo install prunes obsolete managed global skill
- **WHEN** `projects/agents/scripts/install.py install --scope repo` runs
- **AND** an obsolete repo-local global skill output exists with the agents managed marker
- **THEN** the installer removes that obsolete output

#### Scenario: Repo check reports obsolete managed global skill
- **WHEN** `projects/agents/scripts/install.py check --scope repo` runs
- **AND** an obsolete repo-local global skill output exists with the agents managed marker
- **THEN** check mode exits non-zero and reports the obsolete output

#### Scenario: Repo clean removes obsolete managed global skill
- **WHEN** `projects/agents/scripts/install.py clean --scope repo` runs
- **AND** an obsolete repo-local global skill output exists with the agents managed marker
- **THEN** clean mode removes that obsolete output

#### Scenario: Repo cleanup preserves unmanaged skill
- **WHEN** a repo-local path formerly used by a global skill contains a file without the agents managed marker
- **THEN** install, check, and clean operations leave that unmanaged file unchanged
