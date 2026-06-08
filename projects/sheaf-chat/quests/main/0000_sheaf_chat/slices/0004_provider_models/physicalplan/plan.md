# Slice 4: Provider, Auth, And Model Registry

## Objective

Make Sheaf Chat independent of global Pi configuration for model/provider behavior, with OpenAI subscription/OAuth storage under the service data directory and a local OpenAI-compatible inference provider.

Expected outcome:

- Pi auth material for Sheaf Chat uses `data/sheaf-chat/auth/openai/` or a documented equivalent under `data/sheaf-chat/auth/`, never global `~/.pi`.
- The model registry merges OpenAI subscription/OAuth-backed models and local inference models.
- The local provider reads `sheaf_chat.local_inference_url` from `global_config.json` and `local_inference_api_key` from `api_keys.json`.
- Model metadata exposes provider, id, display name, context capability when known, and availability.
- Model validation is reusable by session creation and WebSocket model selection.

## Key Files And Systems

- `projects/sheaf-chat/src/agents/auth.ts`
- `projects/sheaf-chat/src/agents/models.ts`
- `projects/sheaf-chat/src/agents/providerExtension.ts`
- `projects/sheaf-chat/src/server/config.ts`
- `projects/sheaf-chat/tests/agents/models/`
- `data/sheaf-chat/auth/` runtime path, created only at runtime/tests

## Existing APIs To Reuse

- Pi SDK `AuthStorage.create(customPath)`.
- Pi SDK `ModelRegistry.create(authStorage, modelsJsonPath)` and `ModelRegistry.inMemory(authStorage)` where appropriate.
- Pi extension/provider API `pi.registerProvider()` for the local provider.
- Pi model registry `find(provider, id)` and `getAvailable()`.

## APIs To Extend Or Modify

- Add `createSheafAuthStorage(config)` returning auth storage rooted in Sheaf Chat data.
- Add `createSheafModelRegistry(config, authStorage)` with a generated service-owned `models.json` path or in-memory registry plus provider extension.
- Add `listModels()` and `validateModelSelection({ provider, id })`.
- Add provider metadata shape that maps Pi models into browser-facing model records.

## Implementation Notes

- Do not read `~/.pi/agent/auth.json`, `~/.pi/agent/models.json`, or global Pi settings at runtime. Use a service `agentDir` under `data/sheaf-chat/pi-agent/` if Pi requires an agent directory.
- For local inference, register a provider named consistently with the protocol, preferably `local`, using Pi's OpenAI-compatible API setting. Include compatibility flags for endpoints that do not support developer role or reasoning effort if the config exposes them later.
- If the local inference endpoint exposes `/models`, fetch it for dynamic model list; otherwise allow configured fallback model IDs if the existing config shape adds them. Availability should be false with stable error metadata when endpoint/key is missing.
- OpenAI subscription/OAuth flow implementation may depend on Pi's SDK capabilities, but storage location and model-list plumbing must be completed in this slice.
- Avoid committing real tokens. Tests should use temp directories and fake endpoints/registries.

## Validation

- Unit tests for custom auth path creation, no global Pi path reads, local model list fetch success/failure, missing key/url availability handling, model metadata normalization, and model validation errors.
- Tests using fake `AuthStorage`/`ModelRegistry` or a fake HTTP model endpoint so no external network is required.
- `make sheaf-chat-test`
