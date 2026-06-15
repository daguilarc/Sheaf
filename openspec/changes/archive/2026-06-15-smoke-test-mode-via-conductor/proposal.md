## Why

Smoke testing the production services (Dictator, Sheaf Chat) from a feature
worktree is manual and error-prone: agents take down the running production
services, hand-copy the git-ignored whisper model and API keys out of the main
checkout into the worktree, then start servers on the production ports. A
worktree never has the git-ignored assets (worktrees share `.git` but not
ignored working-tree files), so this copy step is unavoidable today. We want a
single, repeatable way to launch the worktree's services for human testing,
driven through Conductor, with assets sourced from the main repo automatically.

## What Changes

- Introduce a repo-wide **smoke-test mode** signalled by the `SHEAF_SMOKE_TEST_MODE`
  environment variable. It is a general "this process is running for testing"
  flag so future test-only behavior can hang off the same switch.
- When `SHEAF_SMOKE_TEST_MODE` is set, services resolve their git-ignored
  **assets** (`config/api_keys.json`, `.secrets.json`, whisper/STT models under
  `models/`) from a main-repo asset root given by `SHEAF_SMOKE_ASSET_ROOT`,
  instead of from the worktree. Tracked files (code, `config/services.json`,
  `config/dictator.json`, etc.) still come from the worktree so the worktree's
  behavior is what gets tested.
- Add an optional `smoke_test` flag to Conductor's lifecycle API
  (`POST /api/services/<name>/start` and `POST /api/services/<name>/restart`).
  When set, Conductor spawns the service with `SHEAF_SMOKE_TEST_MODE=1` and
  `SHEAF_SMOKE_ASSET_ROOT` pointed at the main working tree it discovers.
- Conductor learns to discover the main working tree's root (for the asset
  root) and to inject a custom environment into spawned services (the process
  runner currently passes no custom env).
- Add a `smoke-test` skill under `projects/agents/global/skills/smoke-test/`
  describing how to launch the services for human testing, including a
  ready-to-run script / `curl` commands so an agent does not have to assemble
  the calls itself.

## Capabilities

### New Capabilities
- `conductor-smoke-test`: Conductor-owned smoke-test orchestration — the
  `SHEAF_SMOKE_TEST_MODE` / `SHEAF_SMOKE_ASSET_ROOT` environment contract,
  main working-tree asset-root discovery, the optional `smoke_test` flag on the
  start/restart lifecycle endpoints, and spawning services with the smoke
  environment injected.

### Modified Capabilities
- `dictator-service-lifecycle`: at startup, WHEN smoke-test mode is active,
  Dictator resolves `config/api_keys.json` and its STT (whisper) model from the
  smoke asset root rather than its own repo root.
- `sheaf-chat-service`: at startup, WHEN smoke-test mode is active, Sheaf Chat
  resolves `config/api_keys.json` (and any other git-ignored assets it reads)
  from the smoke asset root rather than its own repo root.
- `quest-runner-service-lifecycle`: at startup, WHEN smoke-test mode is active,
  quest-runner resolves any git-ignored assets it reads from the smoke asset
  root rather than its own repo root. (Every registered service except
  Conductor honors the flag; Conductor has no external asset dependencies.)
- `agents-skill-distribution`: adds the `smoke-test` shared skill to the
  canonical source tree so it is distributed to every harness target.

## Impact

- **conductor**: `src/server.ts` (parse optional `smoke_test` flag on
  start/restart), `src/lifecycle.ts` and `src/process_runner.ts` (thread a
  custom env through `spawn`), new asset-root discovery helper, plus tests.
- **dictator**: `src/Sources/DictatorService/DictatorServiceMain.swift` asset
  resolution (`config/api_keys.json`, STT model path), plus `DictatorCore`/
  `DictatorService` tests.
- **sheaf-chat**: `src/server/repo_paths.ts` (and callers) asset resolution,
  plus tests.
- **quest-runner**: git-ignored asset resolution in the service startup path,
  plus tests.
- **agents**: new `projects/agents/global/skills/smoke-test/` skill source
  (`skill.yaml` + `SKILL.md`); regenerated harness skill files via
  `make agents-install`.
- **docs**: `structure/testing.md` smoke-test guidance; affected projects'
  `docs/operations.md`.
- No change to the regular `make test` lane; smoke mode is opt-in and only
  affects how a running service locates git-ignored assets.
