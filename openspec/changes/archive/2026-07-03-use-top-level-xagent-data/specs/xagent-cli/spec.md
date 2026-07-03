## MODIFIED Requirements

### Requirement: xa-9 — Offline logs and inspection commands
WHEN `xagent run` starts without an explicit log-root override, THE xagent CLI SHALL create a run directory under the Sheaf repository root's top-level `data/xagent/` directory, including when the CLI process is launched from `projects/xagent`, and offline commands `xagent list` and `xagent logs <run_id>` SHALL read only those persisted files without requiring a live daemon or server.

#### Scenario: Run log created
- **WHEN** `xagent run --harness codex --subagent` starts from the Sheaf repository root
- **THEN** the CLI creates a persistent run record under `data/xagent/` containing `run_id`, `harness`, `mode`, timestamps, exit status, and log paths

#### Scenario: Package directory launch uses top-level data directory
- **WHEN** `xagent run --harness fake --subagent` starts with the current working directory set to `projects/xagent`
- **THEN** the CLI creates the persistent run record under the Sheaf repository root's `data/xagent/`
- **AND** the CLI does not create a persistent run record under `projects/xagent/data/xagent/`

#### Scenario: Offline list
- **WHEN** the user runs `xagent list`
- **THEN** the CLI lists persisted run records from disk and does not contact any live xagent process

#### Scenario: Offline logs
- **WHEN** the user runs `xagent logs <run_id>`
- **THEN** the CLI prints the persisted normalized log for that run and does not contact any live xagent process
