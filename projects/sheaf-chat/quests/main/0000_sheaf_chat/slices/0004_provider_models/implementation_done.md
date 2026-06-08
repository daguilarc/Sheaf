# Slice 0004 Implementation Complete

## Summary

Implemented Sheaf-scoped Pi auth storage, model registry, and local OpenAI-compatible provider plumbing under `projects/sheaf-chat/src/agents/`.

## Delivered

- **Auth storage** (`auth.ts`): `CreateSheafAuthStorage`, path helpers rooted at `data/sheaf-chat/pi-agent/auth.json`, OpenAI OAuth directory at `data/sheaf-chat/auth/openai/`, and guards against global `~/.pi` paths.
- **Local provider** (`localProvider.ts`): `local` provider registration, `/v1/models` discovery with injectable fetch, fallback unavailable models, OpenAI-completions compat flags, and stable unavailable-reason codes for missing url/key or fetch failure.
- **Model registry** (`models.ts`): `CreateSheafModelRegistry`, `ListModels`, `ValidateModelSelection`, and `MapPiModelToMetadata` merging Pi built-in/OpenAI models with local inference models.
- **Provider extension** (`providerExtension.ts`): `CreateSheafProviderExtension` for Pi agent sessions in later slices.
- **Config/types**: `openAiApiKey` bootstrap from `api_keys.json` and optional `unavailableReason` on `ModelMetadata`.

## Validation

- `make sheaf-chat-test` — 51 unit tests pass, including custom auth path creation, no global Pi path usage, local model fetch success/failure, missing url/key availability handling, metadata normalization, and model validation errors.
