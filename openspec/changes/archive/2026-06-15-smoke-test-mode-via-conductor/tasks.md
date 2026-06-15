## 1. Conductor: environment contract and asset-root discovery

- [x] 1.1 Add a smoke-mode helper module (e.g. `src/smoke_test.ts`) that parses `SHEAF_SMOKE_TEST_MODE` (non-empty and not `0`/`false` ⇒ active) and exposes the env-var names as constants
- [x] 1.2 Add main working-tree asset-root discovery: honor an existing `SHEAF_SMOKE_ASSET_ROOT` override, else derive from `git rev-parse --git-common-dir` (parent of the shared `.git`), else fall back to Conductor's own repo root
- [x] 1.3 Unit-test the truthy parsing and the discovery resolution order (override → worktree discovery → main-checkout fallback)

## 2. Conductor: thread a custom env through spawn and lifecycle

- [x] 2.1 Extend `spawnCommand`/`ProcessRunner.spawn` in `src/process_runner.ts` to accept an optional `env` map merged over `process.env`; non-smoke spawns pass no env and behave identically
- [x] 2.2 Add a `smokeTest` option to `LifecycleManager.StartService`/`RestartService` in `src/lifecycle.ts` that builds `{ SHEAF_SMOKE_TEST_MODE: "1", SHEAF_SMOKE_ASSET_ROOT: <discovered root> }` and passes it to spawn
- [x] 2.3 Parse an optional `smoke_test` boolean from the request body of `POST /api/services/<name>/start` and `/restart` in `src/server.ts` and forward it to the lifecycle manager
- [x] 2.4 Tests: start/restart with `smoke_test: true` inject the smoke env; absent/`false` leaves the spawn env unchanged (smk-4, smk-5)

## 3. Dictator: smoke-test asset resolution

- [x] 3.1 In `DictatorServiceMain.swift`, read `SHEAF_SMOKE_TEST_MODE`/`SHEAF_SMOKE_ASSET_ROOT` and, when active and valid, resolve `config/api_keys.json` and the STT (whisper) model path from the smoke asset root; keep tracked config on the repo root
- [x] 3.2 Warn-and-fall-back to repo-root resolution when smoke mode is active but the asset root is unset/empty/missing
- [x] 3.3 Add `DictatorCore`/`DictatorService` tests for smoke-on (assets from asset root), smoke-off (unchanged), and missing-asset-root fallback (svc-13)

## 4. Sheaf Chat: smoke-test asset resolution

- [x] 4.1 In `src/server/repo_paths.ts` (and callers), redirect git-ignored asset resolution (`config/api_keys.json` and any other git-ignored credential/model files) to `SHEAF_SMOKE_ASSET_ROOT` when smoke mode is active; keep tracked config on the repo root
- [x] 4.2 Warn-and-fall-back to repo-root resolution when smoke mode is active but the asset root is unset/empty/missing
- [x] 4.3 Add tests for smoke-on, smoke-off, and missing-asset-root fallback (svc-14)

## 5. quest-runner: smoke-test asset resolution

- [x] 5.1 In the quest-runner service startup path, read `SHEAF_SMOKE_TEST_MODE`/`SHEAF_SMOKE_ASSET_ROOT` and, when active and valid, resolve any git-ignored assets it reads (e.g. `config/api_keys.json`, `.secrets.json`) from the smoke asset root; keep tracked config (`config/services.json`, `config/quest-runner.json`) on the repo root
- [x] 5.2 Warn-and-fall-back to repo-root resolution when smoke mode is active but the asset root is unset/empty/missing
- [x] 5.3 Add tests for smoke-on, smoke-off, and missing-asset-root fallback (svc-14)

## 6. Agents: smoke-test skill

- [x] 6.1 Create `projects/agents/global/skills/smoke-test/skill.yaml` (`id: smoke-test`, `name`, `description`, targets claude/cursor/pi/codex)
- [x] 6.2 Write `projects/agents/global/skills/smoke-test/SKILL.md`: how to launch services for human testing via Conductor, a ready-to-run bash/`curl` sequence (ensure Conductor up → restart dictator, sheaf-chat, and quest-runner with `{"smoke_test": true}` → poll `/api/services/<name>/health`), the note that a smoke restart displaces the running production instance on that port, and the note to run `make agents-install` after editing the skill
- [x] 6.3 Run `make agents-install` and `make agents-check` to render and verify the skill across harness targets (asd-16)

## 7. Documentation

- [x] 7.1 Document smoke-test mode and the env contract in `structure/testing.md`
- [x] 7.2 Update affected projects' `docs/operations.md` (conductor smoke API; dictator, sheaf-chat, and quest-runner asset-resolution behavior under smoke mode)

## 8. Verification

- [x] 8.1 Run `make test` (regular lane) — confirm smoke changes do not affect it (conductor 93/93, sheaf-chat 193/193, dictator 213/213, quest-runner smoke tests pass; one pre-existing unrelated quest-runner failure for a missing `docs/capabilities/experiments.md`, not caused by this change)
- [x] 8.2 Manual smoke check: user ran the dictator service in smoke-test mode and confirmed live dictation worked end-to-end (reading the whisper model and API keys from the main repo), then restored the production dictator
- [x] 8.3 Run `openspec validate smoke-test-mode-via-conductor` and resolve any issues
