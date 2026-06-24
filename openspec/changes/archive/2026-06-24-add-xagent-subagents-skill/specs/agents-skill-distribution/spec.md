## MODIFIED Requirements

### Requirement: asd-4 — Install script: repo-local target-specific skill outputs
WHEN `projects/agents/scripts/install.py install --scope repo` runs, THE installer SHALL render each shared skill into only the repo-local harness skill directories selected by that skill's `targets` metadata.

#### Scenario: Skills installed for selected repo-local targets
- **WHEN** the install command completes successfully
- **THEN** every shared skill has an installed `SKILL.md` file in each selected repo-local harness skill directory
- **AND** the installer does not create repo-local skill outputs for harness targets omitted from the skill metadata

#### Scenario: Codex-only repo-local skill installed only for Codex
- **WHEN** a shared skill declares `targets` containing only `codex`
- **AND** repo-local install runs successfully
- **THEN** the skill is rendered to `.codex/skills/<skill-id>/SKILL.md`
- **AND** the skill is not rendered to `.claude/skills/<skill-id>/SKILL.md`
- **AND** the skill is not rendered to `.cursor/skills/<skill-id>/SKILL.md`
- **AND** the skill is not rendered to `.pi/skills/<skill-id>/SKILL.md`

### Requirement: asd-12 — User-global target-specific skill outputs
WHEN `projects/agents/scripts/install.py install --scope global` runs, THE installer SHALL render each shared skill into only the user-global harness skill directories selected by that skill's `targets` metadata, with `CODEX_HOME` defaulting to `$HOME/.codex`.

#### Scenario: Global skills installed for selected targets
- **WHEN** the global install command completes successfully
- **THEN** every shared skill has an installed `SKILL.md` file in each selected user-global harness skill directory
- **AND** the installer does not create user-global skill outputs for harness targets omitted from the skill metadata

#### Scenario: Codex-only global skill installed only for Codex
- **WHEN** a shared skill declares `targets` containing only `codex`
- **AND** global install runs successfully
- **THEN** the skill is rendered to `$HOME/.agents/skills/<skill-id>/SKILL.md`
- **AND** the skill is rendered to `$CODEX_HOME/skills/<skill-id>/SKILL.md`
- **AND** the skill is not rendered to `$HOME/.claude/skills/<skill-id>/SKILL.md`
- **AND** the skill is not rendered to `$HOME/.cursor/skills/<skill-id>/SKILL.md`
- **AND** the skill is not rendered to `$HOME/.pi/skills/<skill-id>/SKILL.md`

## ADDED Requirements

### Requirement: asd-20 — Shared skill: xagent-subagents
WHEN Codex review or subagent work benefits from cross-provider opinions, THE agents project SHALL provide a global Codex-only `xagent-subagents` skill under `projects/agents/global/skills/xagent-subagents/` with metadata and source instructions that guide Codex through using the `xagent` CLI to launch external review and worker subagents.

#### Scenario: xagent-subagents skill source exists
- **WHEN** the installer scans `projects/agents/global/skills/`
- **THEN** it finds an `xagent-subagents/` skill directory
- **AND** that directory includes a `skill.yaml` with `id: xagent-subagents`
- **AND** that `skill.yaml` declares `targets` containing `codex`
- **AND** that `skill.yaml` does not declare `claude`, `cursor`, or `pi`
- **AND** that directory includes a source `SKILL.md`

#### Scenario: Skill directs Codex to use Claude through xagent for review
- **WHEN** Codex opens the `xagent-subagents` skill for review work
- **THEN** the skill body instructs Codex to run `xagent` from the active worktree root
- **AND** the skill body instructs Codex to use `xagent run --harness claude_code` for cross-provider review opinions when appropriate
- **AND** the skill body instructs Codex to include the review scope, expected output shape, and relevant files or diffs in the subagent prompt

#### Scenario: Skill documents Claude model tiers
- **WHEN** Codex opens the `xagent-subagents` skill
- **THEN** the skill body identifies Claude Opus 4.8 as the strongest review model
- **AND** the skill body identifies Claude Sonnet 4.8 as the middle or default review model
- **AND** the skill body identifies Claude Haiku 4.7 as the fast, small, inexpensive review model

#### Scenario: Skill documents Cursor and GPT worker routing
- **WHEN** Codex opens the `xagent-subagents` skill
- **THEN** the skill body identifies Cursor Composer 2.5 as a capable worker option through the Cursor harness
- **AND** the skill body instructs Codex to prefer a GPT or Codex-backed worker agent for the trickiest implementation tasks

#### Scenario: Skill preserves agentic infrastructure escalation
- **WHEN** `xagent`, Claude Code, Cursor Agent, or a selected model cannot be launched as instructed
- **THEN** the skill body instructs Codex to surface the failure instead of silently working around broken agentic infrastructure
