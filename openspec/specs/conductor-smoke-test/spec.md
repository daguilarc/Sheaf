# conductor-smoke-test Specification

## Purpose
TBD - created by archiving change smoke-test-mode-via-conductor. Update Purpose after archive.
## Requirements
### Requirement: smk-1 — Environment contract: smoke-test mode flag

THE repository SHALL define `SHEAF_SMOKE_TEST_MODE` as the environment variable that marks a process as running in smoke-test mode, where any non-empty value other than `0` or `false` means smoke-test mode is active and any unset, empty, `0`, or `false` value means it is inactive.

#### Scenario: Mode active

- **WHEN** a process starts with `SHEAF_SMOKE_TEST_MODE=1`
- **THEN** the process treats smoke-test mode as active

#### Scenario: Mode inactive

- **WHEN** a process starts with `SHEAF_SMOKE_TEST_MODE` unset, empty, `0`, or `false`
- **THEN** the process treats smoke-test mode as inactive and behaves exactly as a normal launch

### Requirement: smk-2 — Environment contract: smoke asset root

THE repository SHALL define `SHEAF_SMOKE_ASSET_ROOT` as an absolute filesystem path to the repository whose git-ignored assets (`config/api_keys.json`, `.secrets.json`, and whisper/STT models under `models/`) services SHALL use while smoke-test mode is active, redirecting only those git-ignored assets and continuing to resolve tracked files from the service's own repository root.

#### Scenario: Asset root provided

- **WHEN** smoke-test mode is active and `SHEAF_SMOKE_ASSET_ROOT` points at an existing directory
- **THEN** services resolve their git-ignored assets from that directory
- **AND** services resolve tracked files from their own repository root

#### Scenario: Asset root missing

- **WHEN** smoke-test mode is active and `SHEAF_SMOKE_ASSET_ROOT` is unset, empty, or not an existing directory
- **THEN** services log a warning and fall back to normal repository-root asset resolution without failing startup

### Requirement: smk-3 — Asset-root discovery: main working tree

WHEN Conductor needs a smoke asset root, THE service SHALL use an explicit `SHEAF_SMOKE_ASSET_ROOT` from its own environment if present, otherwise discover the main working tree's root from git (the parent of the shared `.git` directory reported by `git rev-parse --git-common-dir`), and otherwise fall back to its own repository root when it is itself the main checkout.

#### Scenario: Operator override present

- **WHEN** Conductor's own environment already contains `SHEAF_SMOKE_ASSET_ROOT`
- **THEN** Conductor uses that value as the smoke asset root

#### Scenario: Discover from a worktree

- **WHEN** Conductor runs from a git worktree with no operator override
- **THEN** Conductor resolves the smoke asset root to the main working tree (the parent of the shared `.git` directory)

#### Scenario: Running from main checkout

- **WHEN** Conductor runs from the main checkout with no operator override
- **THEN** Conductor uses its own repository root as the smoke asset root

### Requirement: smk-4 — Lifecycle API: optional smoke_test flag

THE start and restart lifecycle endpoints (`POST /api/services/<name>/start` and `POST /api/services/<name>/restart`) SHALL accept an optional JSON request body field `smoke_test`, where an absent or `false` value preserves the existing non-smoke behavior unchanged and a `true` value launches the service in smoke-test mode.

#### Scenario: Flag absent

- **WHEN** a start or restart request omits `smoke_test` or sends `smoke_test: false`
- **THEN** Conductor spawns the service exactly as it does without smoke-test mode

#### Scenario: Flag set

- **WHEN** a start or restart request sends `smoke_test: true`
- **THEN** Conductor spawns the service in smoke-test mode

### Requirement: smk-5 — Spawn injection: smoke environment

WHEN Conductor spawns a service with `smoke_test: true`, THE service SHALL inject `SHEAF_SMOKE_TEST_MODE=1` and `SHEAF_SMOKE_ASSET_ROOT` set to the discovered asset root into the child process environment, merged over Conductor's inherited environment, and SHALL inject neither variable when launching without smoke-test mode.

#### Scenario: Smoke spawn carries the environment

- **WHEN** Conductor spawns a service with `smoke_test: true`
- **THEN** the child process environment contains `SHEAF_SMOKE_TEST_MODE=1` and `SHEAF_SMOKE_ASSET_ROOT` set to the discovered asset root
- **AND** the child otherwise inherits Conductor's environment

#### Scenario: Non-smoke spawn is unchanged

- **WHEN** Conductor spawns a service without smoke-test mode
- **THEN** the child process environment contains neither `SHEAF_SMOKE_TEST_MODE` nor a Conductor-injected `SHEAF_SMOKE_ASSET_ROOT`

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
