## ADDED Requirements

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

## MODIFIED Requirements

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
