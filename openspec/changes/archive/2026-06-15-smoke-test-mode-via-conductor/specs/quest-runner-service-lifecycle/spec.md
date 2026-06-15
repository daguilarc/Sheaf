## ADDED Requirements

### Requirement: svc-14 — Startup: smoke-test asset resolution

WHILE smoke-test mode is active (`SHEAF_SMOKE_TEST_MODE`), THE quest-runner service SHALL resolve any git-ignored assets it reads — such as `config/api_keys.json` and `.secrets.json` — from the smoke asset root given by `SHEAF_SMOKE_ASSET_ROOT`, while continuing to resolve tracked files (including `config/services.json` and `config/quest-runner.json`) from its own repository root; IF `SHEAF_SMOKE_ASSET_ROOT` is unset, empty, or not an existing directory, THEN the service SHALL log a warning and fall back to normal repository-root asset resolution.

#### Scenario: Assets read from the smoke asset root

- **WHEN** quest-runner starts with `SHEAF_SMOKE_TEST_MODE=1` and `SHEAF_SMOKE_ASSET_ROOT` pointing at an existing main-repo checkout
- **THEN** it resolves its git-ignored assets from that smoke asset root
- **AND** it loads `config/services.json` and `config/quest-runner.json` from its own repository root

#### Scenario: Smoke mode off

- **WHEN** quest-runner starts without `SHEAF_SMOKE_TEST_MODE` active
- **THEN** it resolves all assets from its own repository root exactly as before

#### Scenario: Asset root missing

- **WHEN** quest-runner starts with smoke-test mode active but `SHEAF_SMOKE_ASSET_ROOT` unset, empty, or not an existing directory
- **THEN** it logs a warning and resolves assets from its own repository root
