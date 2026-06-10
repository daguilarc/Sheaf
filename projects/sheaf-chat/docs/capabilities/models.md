# Capability: Models

ID prefix: `mdl`

## Purpose

Provider and model discovery: the service-local Pi auth storage and model
registry, the OpenAI-compatible `local` provider fetched from a configured
inference endpoint, model availability rules, selection validation, and the
`GET /api/models` endpoint.

## Requirements

- **[mdl-1]** THE service SHALL keep all Pi auth and model state
  service-local: auth storage at `data/sheaf-chat/pi-agent/auth.json` and
  the model registry's catalogue at `data/sheaf-chat/pi-agent/models.json`.
  IF an auth path contains a `/.pi/` segment (or ends with `/.pi`), THEN THE
  service SHALL refuse it (`refusing to use global Pi path: <path>`).
- **[mdl-2]** WHEN configured secrets exist, THE service SHALL install them
  as runtime API keys at startup: `openai_api_key` for provider `openai`
  and `local_inference_api_key` for provider `local`
  ([config keys](service.md)).
- **[mdl-3]** THE service SHALL expose only models from provider `local`
  and provider `openai`; models from any other built-in Pi provider SHALL
  be excluded from listings and selection.
- **[mdl-4]** WHEN local inference is configured (URL and key both set),
  THE service SHALL fetch the model list once at startup from the endpoint:
  trailing slashes stripped; `<base>/models` when the base ends with `/v1`,
  otherwise `<base>/v1/models`; with header
  `Authorization: Bearer <local_inference_api_key>`. Entries are mapped
  from the OpenAI `{data: [{id, name?, context_window?}]}` shape.
- **[mdl-5]** IF local inference is unconfigured, the fetch fails, returns
  non-OK, or returns zero models, THEN THE service SHALL register the single
  placeholder model `local-default` with `available: false` and
  `unavailableReason` of `local_inference_url_missing`,
  `local_inference_api_key_missing`, or `local_models_fetch_failed`
  respectively, and SHALL NOT fail startup.
- **[mdl-6]** THE service SHALL register the `local` provider on the model
  registry (and as a per-session Pi extension) with API type
  `openai-completions`, display name `Local Inference`, bearer auth, and
  per-model defaults `contextWindow` = fetched `context_window` or 128000
  and `maxTokens` = 16384.
- **[mdl-7]** WHEN it receives `GET /api/models`, THE service SHALL respond
  200 with `{"models": [...]}` deduplicated by `provider:id` and sorted by
  provider then id, each entry carrying `provider`, `id`, `displayName`,
  optional `contextTokens`, `available`, and — for unavailable local
  models — `unavailableReason`.
- **[mdl-8]** THE service SHALL compute availability as: for `local`
  models, local inference configured *and* the fetch succeeded *and* the id
  is in the fetched list; for `openai` models, the registry has configured
  auth for the provider (runtime key, stored auth, or environment).
- **[mdl-9]** WHEN a model selection is validated (session creation,
  `client.model_select`), THE service SHALL fail unknown or
  excluded-provider models with `model_not_found`
  (`model not found: <provider>/<id>`) and known-but-unavailable models
  with `model_unavailable` (`model unavailable: <unavailableReason>` for
  local, `model unavailable: <provider>/<id>` otherwise).

## Contracts

### `GET /api/models`

```json
{
  "models": [
    {
      "provider": "local",
      "id": "qwen3-coder",
      "displayName": "qwen3-coder",
      "contextTokens": 128000,
      "available": true
    },
    {
      "provider": "local",
      "id": "local-default",
      "displayName": "local-default",
      "contextTokens": 128000,
      "available": false,
      "unavailableReason": "local_inference_url_missing"
    }
  ]
}
```

### Local models endpoint exchange

Request: `GET <normalized-base>/models` (or `/v1/models`) with
`Authorization: Bearer <key>`. Accepted response shape:

```json
{ "data": [ { "id": "qwen3-coder", "name": "Qwen3 Coder", "context_window": 128000 } ] }
```

Entries without a non-empty string `id` are dropped; `name` defaults to the
id; non-finite `context_window` is ignored.

### Unavailable reasons

| Reason | Condition |
|---|---|
| `local_inference_url_missing` | `local_inference_url` unset/empty |
| `local_inference_api_key_missing` | URL set but `local_inference_api_key` unset |
| `local_models_fetch_failed` | fetch threw, non-OK status, or empty model list |

### Service-local Pi state files

```text
data/sheaf-chat/pi-agent/auth.json     # Pi AuthStorage
data/sheaf-chat/pi-agent/models.json   # Pi ModelRegistry catalogue
data/sheaf-chat/auth/openai/           # reserved for OpenAI OAuth material
```

## Design

- `src/agents/auth.ts` — path resolvers, the `/.pi/` guard
  (`AssertNotGlobalPiPath`), `CreateSheafAuthStorage`.
- `src/agents/localProvider.ts` — endpoint URL building, `FetchLocalModels`
  (returning a `LocalProviderState` of `{models, fetchError,
  unavailableReason}`), provider registration
  (`BuildLocalProviderRegistration`), `IsLocalModelAvailable`.
- `src/agents/models.ts` — `CreateSheafModelRegistry` (one fetch at
  `AgentManager.Create` time), `ListModels` (filter → map → dedupe → sort),
  `ValidateModelSelection`, the `openai`-only built-in whitelist
  (`x_supportedBuiltInProviders`).
- `src/agents/providerExtension.ts` — registers the same provider config
  inside each Pi session so Pi can stream against the local endpoint.
- `src/server/routes/models.ts` — the REST route delegates to
  `AgentManager.listModels()`.
- The local model list is fetched once per process; there is no refresh
  endpoint or timer. `data/sheaf-chat/auth/openai/` is resolved by code but
  no current runtime path writes it.

## Interactions

- [service](service.md) — configuration keys and `/api/health` dependency
  flags derived from the same config.
- [piles-sessions](piles-sessions.md) — session creation validates against
  this registry.
- [chat-protocol](chat-protocol.md) — `client.model_select` validation;
  `server.hello` carries `models` from `ListModels`.
- [agent-runtime](agent-runtime.md) — Pi sessions are created with this
  registry bundle.
