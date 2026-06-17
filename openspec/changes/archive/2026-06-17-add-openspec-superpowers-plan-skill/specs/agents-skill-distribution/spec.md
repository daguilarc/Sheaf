## ADDED Requirements

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
