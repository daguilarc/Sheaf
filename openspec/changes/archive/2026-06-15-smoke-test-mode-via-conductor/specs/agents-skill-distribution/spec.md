## ADDED Requirements

### Requirement: asd-16 — Shared skill: smoke-test

THE agents project SHALL provide a shared `smoke-test` skill under `projects/agents/global/skills/smoke-test/` (a `skill.yaml` with `id: smoke-test` targeting every supported harness plus a source `SKILL.md`) that documents how to launch the services for human testing through Conductor and includes a ready-to-run script or `curl` sequence covering restarting the asset-dependent services with `smoke_test: true` and polling their health.

#### Scenario: Smoke-test skill source exists

- **WHEN** the installer scans `projects/agents/global/skills/`
- **THEN** the `smoke-test/` skill directory is discoverable with a `skill.yaml` (`id: smoke-test`) and a `SKILL.md`

#### Scenario: Skill provides a ready-to-run launch sequence

- **WHEN** an agent opens the `smoke-test` skill
- **THEN** the skill body explains launching services for human testing via Conductor
- **AND** it provides a copy-paste script or `curl` commands that restart the asset-dependent services with `smoke_test: true` and poll their health

#### Scenario: Skill distributes to harness targets

- **WHEN** `make agents-install` runs after the skill is added
- **THEN** the `smoke-test` skill is rendered into each supported harness's skills location alongside the other shared skills
