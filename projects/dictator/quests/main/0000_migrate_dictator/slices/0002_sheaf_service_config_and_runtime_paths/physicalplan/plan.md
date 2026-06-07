# Physical Plan: Sheaf Service Config And Runtime Paths

## Objective

Turn the imported Swift package into a Sheaf-registered Dictator service that reads service endpoint data from `config/services.json`, non-secret settings from `config/dictator.json`, API keys from `config/api_keys.json`, logs under `logs/dictator/`, and runtime data under `data/dictator/`.

Expected outcome:

- `config/services.json` registers `dictator` on `0.0.0.0:9003` with command `make dictator-run` and `home_path` pointing at the Dictator web UI path.
- Root `Makefile` adds `dictator` to `PROJECTS` and thin forwarding targets only.
- `projects/dictator/Makefile` has working `all`, `build`, `test`, `run`, and `clean` targets.
- The service executable starts from the registered endpoint by default and has an explicit logged override path for manual local binding.
- Dictator no longer uses app-local `apps/dictator-main/Config/**`, app-local secrets, `/tmp/dictator-trace.log`, `apps/dictator-main/Data`, or `/Users/joyo/dictator`.

## Key Files And Systems

Likely affected files:

- `config/services.json`
- `config/dictator.json`
- `config/api_keys.example.json`
- `Makefile`
- `projects/dictator/Makefile`
- `projects/dictator/Package.swift`
- `projects/dictator/src/Sources/DictatorCore/RuntimeConfig.swift`
- `projects/dictator/src/Sources/DictatorCore/RuntimeConfiguration.swift`
- `projects/dictator/src/Sources/DictatorCore/SecretsStore.swift`
- `projects/dictator/src/Sources/DictatorCore/APIKeyResolver.swift`
- `projects/dictator/src/Sources/DictatorCore/SystemPromptCatalog.swift`
- `projects/dictator/src/Sources/DictatorService/TraceLogger.swift`
- `projects/dictator/src/Sources/DictatorService/ServiceRegistry.swift`
- `projects/dictator/src/Sources/DictatorService/main.swift`
- `projects/dictator/tests/DictatorCoreTests/**`
- `projects/dictator/tests/DictatorServiceTests/**`

## Existing APIs To Reuse As-Is

- Reuse `RuntimeConfigFile` field names for the migrated `config/dictator.json` shape:
  - `cloud_model`
  - `local_model`
  - `use_cloud`
  - `fallback_mode`
  - `ollama_host`
  - `ollama_bin_path`
  - `system_prompt`
  - `auxiliary_system_prompt_1`
  - `auxiliary_system_prompt_2`
  - `system_prompts_dir`
  - `stt_model_path`
  - `stt_language`
  - `data_dir`
  - `interactions_buffer_bytes`
  - `dictator_server_enabled`
  - `dictator_server_host`
  - `dictator_server_port`
  - `version`
  - `updated_at`
- Reuse `RuntimeConfigStore.save` atomic-write behavior for safe persistence.
- Reuse `APIKeyResolver.normalized` behavior for trimming and rejecting blank keys.
- Reuse `TraceLogger.configure(logDirectoryPath:)`, changing the default log directory to the Sheaf path.

## APIs To Extend Or Modify

- Add a service registry loader in `DictatorService`, for example `ServiceRegistry.load(repoRoot:serviceName:)`, that parses the root `config/services.json` array and returns `name`, `host`, `port`, `command`, and optional `home_path`.
- Add repo-root discovery utility that walks upward from the executable/current directory until it finds `config/services.json` and `projects/dictator/`.
- Change service startup endpoint resolution:
  - default: registered `dictator` entry from `config/services.json`
  - explicit override: visible CLI flags such as `--host` and `--port`, logged as an override
  - old `dictator_server_host` and `dictator_server_port` fields remain in `config/dictator.json` for compatibility/UI display but do not override service registry in normal Sheaf operation.
- Change `RuntimeConfigStore.defaultFileURL` to `repoRoot/config/dictator.json`.
- Change `RuntimeConfigFile.bootstrap` defaults:
  - `data_dir`: `data/dictator`
  - `system_prompts_dir`: `projects/dictator/src/prompts/system-prompts`
  - `dictator_server_host`: `0.0.0.0`
  - `dictator_server_port`: `9003`
  - `dictator_server_enabled`: `true`
- Change `shouldPreferRepoRoot` path rules so `projects/dictator/src/prompts`, `config`, `data/dictator`, and `logs/dictator` resolve under the Sheaf repo root.
- Replace `SecretsStore` with `APIKeysStore` semantics over `config/api_keys.json`; keep the `SecretStore` protocol.
- Use this tracked secret template shape in `config/api_keys.example.json` and docs:

```json
{
  "dictator": {
    "openai_api_key": ""
  }
}
```

- Read only `dictator.openai_api_key` from `config/api_keys.json`. Do not read environment variables and do not write secrets through the service.
- Configure logging to `logs/dictator/trace.log`, and ensure startup/request/config/key failures are logged without secret values.
- Configure interaction history and generated runtime data under `data/dictator/`.

## Implementation Notes

`config/dictator.json` should be tracked because it contains only non-secret defaults. It should not contain real paths to local model binaries except safe defaults such as `models/ggml-base.en.bin` or an intentionally empty documented value. Large STT model binaries are never committed.

If `dictator_server_enabled` remains false, the executable should not silently make `make dictator-run` succeed without serving the registered service. Preferred behavior is to log a warning and keep the registered service enabled unless an explicit CLI mode documents otherwise. Cover this with a test so the field cannot accidentally disable normal Sheaf operation.

The old `ConductorIntegration.swift` should not remain as an active startup dependency. If small URL/registry parsing helpers are useful, move them into a Sheaf-named file and remove `/services`, `/restart_service`, `/trace`, and conductor endpoint assumptions from Dictator startup.

Root `Makefile` changes are limited to:

- add `dictator` to `PROJECTS`
- add `dictator-build`, `dictator-test`, `dictator-run`, and `dictator-clean` forwarding targets
- update help examples/projects if needed.

`config/services.json` entry:

```json
{
  "name": "dictator",
  "host": "0.0.0.0",
  "port": 9003,
  "home_path": "/",
  "command": "make dictator-run"
}
```

## Validation

- `make dictator-build`
- `make dictator-test`
- `make -C projects/dictator run` in a controlled smoke test that starts and stops the service.
- Focused tests for:
  - service registry lookup reads `config/services.json`
  - missing `dictator` service entry fails with a clear error
  - service binds to port `9003` from registry by default
  - CLI override is logged and visible
  - `config/dictator.json` load/save and old field decoding
  - `dictator_server_host`/`dictator_server_port` do not override registry by accident
  - no persistent config lookup from environment variables
  - `config/api_keys.json` `dictator.openai_api_key` lookup trims blanks and never logs key values
  - missing/invalid API key file produces a non-secret warning/status
  - logs write to `logs/dictator/`
  - interaction data writes to `data/dictator/`.
- Static checks:
  - `rg "Config/runtime-config|Config/secrets|apps/dictator-main/Data|/tmp/dictator-trace|/Users/joyo/dictator|ProcessInfo\\.processInfo\\.environment" projects/dictator/src projects/dictator/tests`
