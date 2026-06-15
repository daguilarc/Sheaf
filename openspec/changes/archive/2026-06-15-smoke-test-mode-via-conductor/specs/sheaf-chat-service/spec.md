## ADDED Requirements

### Requirement: svc-14 — Startup: smoke-test asset resolution

WHILE smoke-test mode is active (`SHEAF_SMOKE_TEST_MODE`), THE Sheaf Chat service SHALL resolve its git-ignored assets — `config/api_keys.json` and any other git-ignored credential or model files it reads — from the smoke asset root given by `SHEAF_SMOKE_ASSET_ROOT`, while continuing to resolve tracked files (including `config/services.json` and `config/global_config.json`) from its own repository root; IF `SHEAF_SMOKE_ASSET_ROOT` is unset, empty, or not an existing directory, THEN the service SHALL log a warning and fall back to normal repository-root asset resolution.

#### Scenario: Assets read from the smoke asset root

- **WHEN** Sheaf Chat starts with `SHEAF_SMOKE_TEST_MODE=1` and `SHEAF_SMOKE_ASSET_ROOT` pointing at an existing main-repo checkout
- **THEN** it loads `config/api_keys.json` from that smoke asset root
- **AND** it loads `config/services.json` and `config/global_config.json` from its own repository root

#### Scenario: Smoke mode off

- **WHEN** Sheaf Chat starts without `SHEAF_SMOKE_TEST_MODE` active
- **THEN** it resolves all assets from its own repository root exactly as before

#### Scenario: Asset root missing

- **WHEN** Sheaf Chat starts with smoke-test mode active but `SHEAF_SMOKE_ASSET_ROOT` unset, empty, or not an existing directory
- **THEN** it logs a warning and resolves assets from its own repository root
