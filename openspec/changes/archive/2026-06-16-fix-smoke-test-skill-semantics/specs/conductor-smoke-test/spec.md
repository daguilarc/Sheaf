## ADDED Requirements

### Requirement: smk-6 — Lifecycle API: worktree launch root

WHEN a lifecycle start or restart request includes a `worktree` JSON request body field, THE service SHALL validate that value as an absolute existing Sheaf repository root and launch the service command from that worktree instead of Conductor's own repository root; WHEN the field is absent, THE service SHALL preserve the existing launch-root behavior.

#### Scenario: Worktree launch root provided

- **WHEN** `POST /api/services/<name>/restart` includes a valid absolute `worktree` path
- **THEN** Conductor stops the existing service instance as usual
- **AND** Conductor starts the service command with the supplied worktree as the process working directory
- **AND** service logs for that spawn are written under the supplied worktree's `logs/<service>/` directory

#### Scenario: Worktree launch root omitted

- **WHEN** `POST /api/services/<name>/restart` omits `worktree`
- **THEN** Conductor starts the service command from Conductor's own repository root exactly as before

#### Scenario: Invalid worktree launch root

- **WHEN** `POST /api/services/<name>/restart` includes a `worktree` value that is not a string, is empty, is relative, does not exist, or does not contain Sheaf repository root markers
- **THEN** Conductor rejects the request with a client error
- **AND** Conductor does not silently fall back to Conductor's own repository root

#### Scenario: Smoke restart with worktree uses production assets

- **WHEN** `POST /api/services/<name>/restart` includes both `smoke_test: true` and a valid `worktree` path
- **THEN** Conductor starts the service command from the supplied worktree
- **AND** Conductor injects `SHEAF_SMOKE_TEST_MODE=1`
- **AND** Conductor injects `SHEAF_SMOKE_ASSET_ROOT` using Conductor's normal smoke asset-root discovery rather than resolving assets from the supplied worktree
