# Capability: Service

Project: `projects/sheaf-chat`
ID prefix: `svc` — requirement IDs are append-only; never renumber or reuse.

## Purpose

The long-running Sheaf Chat process: configuration loading, service-registry
boot, the two health endpoints, static and vendor asset serving for the
browser UI, and the REST dispatch/error conventions every API route shares.
## Requirements
### Requirement: svc-1 — Root discovery and fail on missing

WHEN started, THE service SHALL discover the repository root by walking up from the working directory to the first directory containing both `config/services.json` and `structure/`, and SHALL fail startup with `repository root not found` if none exists.

#### Scenario: Repository root found
- **WHEN** the service starts and finds a directory containing both `config/services.json` and `structure/` while walking up from the working directory
- **THEN** the service uses that directory as the repository root

#### Scenario: Repository root not found
- **WHEN** the service starts and no ancestor directory contains both `config/services.json` and `structure/`
- **THEN** the service fails startup with `repository root not found`

### Requirement: svc-2 — Services config bind and missing-entry failure

WHEN started, THE service SHALL read `config/services.json` (a JSON array of service definitions) and bind to the `host` and `port` of the entry named `sheaf-chat`; IF the entry is missing, THEN THE service SHALL fail startup with the message `sheaf-chat is not registered in config/services.json` and exit code 1.

#### Scenario: sheaf-chat entry present
- **WHEN** the service starts and `config/services.json` contains an entry named `sheaf-chat`
- **THEN** the service binds to the `host` and `port` from that entry

#### Scenario: sheaf-chat entry missing
- **WHEN** the service starts and `config/services.json` has no entry named `sheaf-chat`
- **THEN** the service fails startup with the message `sheaf-chat is not registered in config/services.json` and exit code 1

### Requirement: svc-3 — Non-secret and secret configuration loading

THE service SHALL read non-secret configuration from `config/global_config.json` and secrets from `config/api_keys.json` (see Contracts); both files are optional and missing or malformed-typed keys fall back to defaults rather than failing startup.

#### Scenario: Config files present with valid keys
- **WHEN** the service loads and both `config/global_config.json` and `config/api_keys.json` are present with valid keys
- **THEN** the service uses the values from those files

#### Scenario: Config files absent or keys malformed
- **WHEN** either config file is absent or a key has an unexpected type
- **THEN** the service falls back to defaults without failing startup

### Requirement: svc-4 — GET /health endpoint

THE service SHALL serve `GET /health` returning 200 `{"healthy": true, "uptime": <seconds since start>}`; any other method on `/health` SHALL return 405 with the standard error body.

#### Scenario: GET /health
- **WHEN** a `GET /health` request is received
- **THEN** the service returns 200 with body `{"healthy": true, "uptime": <seconds since start>}`

#### Scenario: Non-GET method on /health
- **WHEN** a request with any method other than GET is received for `/health`
- **THEN** the service returns 405 with the standard error body

### Requirement: svc-5 — GET /api/health endpoint

THE service SHALL serve `GET /api/health` returning 200 with service name, version, status `ok`, and non-secret dependency status (see Contracts); the response SHALL never contain secret values.

#### Scenario: GET /api/health response
- **WHEN** a `GET /api/health` request is received
- **THEN** the service returns 200 with service name, version, status `ok`, and non-secret dependency status

#### Scenario: No secrets in /api/health response
- **WHEN** the `/api/health` response is generated
- **THEN** the response contains no secret values

### Requirement: svc-6 — Browser UI shell serving

THE service SHALL serve the browser UI shell (`src/ui/index.html`) at `GET /` and `GET /index.html` as `text/html; charset=utf-8`.

#### Scenario: GET / or GET /index.html
- **WHEN** a `GET /` or `GET /index.html` request is received
- **THEN** the service returns `src/ui/index.html` with content type `text/html; charset=utf-8`

### Requirement: svc-7 — Static asset serving and path validation

THE service SHALL serve static files under `/assets/sheaf-chat/*` from `projects/sheaf-chat/src/ui/` and under `/assets/web/*` from `projects/web/src/`, with content types limited to `.css`, `.js`, and `.html`; any other extension, a path containing `..` or `\`, or a resolved path outside the asset root SHALL return 404.

#### Scenario: Valid static asset request
- **WHEN** a request is received for a path under `/assets/sheaf-chat/*` or `/assets/web/*` with a `.css`, `.js`, or `.html` extension and no path traversal
- **THEN** the service returns the corresponding file from the appropriate asset root

#### Scenario: Disallowed extension
- **WHEN** a request is received for a static asset path with an extension other than `.css`, `.js`, or `.html`
- **THEN** the service returns 404

#### Scenario: Path traversal attempt
- **WHEN** a request is received for a static asset path containing `..` or `\`, or whose resolved path falls outside the asset root
- **THEN** the service returns 404

### Requirement: svc-8 — Standard REST error format

THE service SHALL return every REST error as `{"error": {"code": "<code>", "message": "<message>"}}` with the status code mapped from the error catalogue (unknown codes map to 500).

#### Scenario: Known error code
- **WHEN** a REST error with a known code is returned
- **THEN** the response body is `{"error": {"code": "<code>", "message": "<message>"}}` with the status code from the error catalogue

#### Scenario: Unknown error code
- **WHEN** a REST error with an unknown code is returned
- **THEN** the response uses status 500 and the standard error body format

### Requirement: svc-9 — API route not found and method not allowed

IF an `/api/` path matches no route, THEN THE service SHALL respond 404 `not_found` / `route not found`; IF a matched route does not support the method, THEN 405 `method_not_allowed` / `method not allowed`.

#### Scenario: No matching API route
- **WHEN** a request is received for an `/api/` path that matches no route
- **THEN** the service responds 404 with code `not_found` and message `route not found`

#### Scenario: Method not supported on matched route
- **WHEN** a request is received for an `/api/` path that matches a route but the method is not supported
- **THEN** the service responds 405 with code `method_not_allowed` and message `method not allowed`

### Requirement: svc-10 — Invalid JSON request body

IF a request body on a POST API route is not valid JSON, THEN THE service SHALL respond 400 `invalid_json` / `request body is not valid JSON` (an empty body parses as `null` and then fails the route's object validation).

#### Scenario: Invalid JSON body on POST route
- **WHEN** a POST API route receives a body that is not valid JSON
- **THEN** the service responds 400 with code `invalid_json` and message `request body is not valid JSON`

### Requirement: svc-11 — Unexpected error handler

IF an unexpected error escapes a route handler, THEN THE service SHALL respond 500 with code `internal_error`.

#### Scenario: Unhandled error in route handler
- **WHEN** an unexpected error escapes a route handler
- **THEN** the service responds 500 with code `internal_error`

### Requirement: svc-12 — Stream profiling emission

WHERE `SHEAF_CHAT_PROFILE_STREAM=1` is set in the environment, THE service SHALL emit single-line JSON profiling records (`{"profile":"sheaf-stream","tMs":…,"point":…,…}`) to stderr at stream checkpoints; otherwise it SHALL emit none.

#### Scenario: Profiling enabled
- **WHEN** `SHEAF_CHAT_PROFILE_STREAM=1` is set in the environment and a stream checkpoint is reached
- **THEN** the service emits a single-line JSON profiling record (`{"profile":"sheaf-stream","tMs":…,"point":…,…}`) to stderr

#### Scenario: Profiling disabled
- **WHEN** `SHEAF_CHAT_PROFILE_STREAM=1` is not set in the environment
- **THEN** the service emits no profiling records

### Requirement: svc-13 — Vendor asset allowlist

THE service SHALL serve vendor assets only from the explicit allowlist for Markdown-it, KaTeX JavaScript/CSS, KaTeX font files, Highlight.js JavaScript, and Highlight.js theme CSS under `/assets/vendor/`; any unlisted vendor path SHALL return 404.

#### Scenario: Allowlisted vendor asset
- **WHEN** a request is received for a vendor path in the explicit allowlist (Markdown-it, KaTeX JS/CSS, KaTeX font files, Highlight.js JavaScript, or Highlight.js theme CSS)
- **THEN** the service serves the corresponding file

#### Scenario: Unlisted vendor path
- **WHEN** a request is received for a `/assets/vendor/` path not in the explicit allowlist
- **THEN** the service returns 404

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

### Requirement: svc-15 — Standard service endpoints: POST /exit shutdown

WHEN the service receives `POST /exit`, THE service SHALL respond 200 with `{"exiting": true}`, flush that response before starting shutdown, then stop accepting new work, close the HTTP server, close the chat and Agent Review WebSocket servers, dispose server registries and Agent Review resources, and let the production process exit with code 0. WHILE shutdown is in progress, THE service SHALL reject WebSocket upgrades with HTTP 404 and answer non-exit HTTP requests with the standard 404 REST error body. Repeated shutdown requests SHALL be idempotent.

#### Scenario: Exit request received

- **WHEN** the service receives `POST /exit`
- **THEN** it responds 200 with `{"exiting": true}`
- **AND** after that response is flushed, it closes the HTTP server, chat WebSocket server, Agent Review WebSocket server, registries, and Agent Review resources
- **AND** the production process exits with code 0

#### Scenario: Repeated exit request

- **WHEN** `POST /exit` is received while shutdown is already in progress and the HTTP server can still respond
- **THEN** the service responds 200 with `{"exiting": true}`
- **AND** it does not run cleanup more than once

#### Scenario: Request during shutdown

- **WHEN** shutdown is in progress and a non-exit HTTP request arrives before the HTTP server closes
- **THEN** the service responds 404 with the standard REST error body

#### Scenario: WebSocket upgrade during shutdown

- **WHEN** shutdown is in progress and a WebSocket upgrade request arrives before the HTTP server closes
- **THEN** the service rejects the upgrade with HTTP 404

#### Scenario: Non-POST method on /exit

- **WHEN** a request with any method other than POST is received for `/exit`
- **THEN** the service returns 405 with the standard REST error body

## Contracts

### Configuration keys

`config/global_config.json`:

| Key | Type | Default | Meaning |
|---|---|---|---|
| `local_inference_url` | string | unset (`null`) | Base URL of an OpenAI-compatible inference endpoint; trimmed; empty string treated as unset. See [models](../sheaf-chat-models/spec.md). |
| `agent_idle_offload_seconds` | number > 0 | `300` | Seconds a session may sit with no connected clients before its Pi session is offloaded (floored to an integer). Non-positive/non-finite values fall back to the default. |

`config/api_keys.json` (operator-created; may be absent):

| Key | Type | Default | Meaning |
|---|---|---|---|
| `local_inference_api_key` | string | unset | Bearer key for the local inference endpoint. Both URL and key must be set for local inference to be "available". |
| `openai_api_key` | string | unset | Bootstrap OpenAI API key, installed as a runtime key in the service-local Pi auth storage. |

`config/services.json` entry (see
[Services](../../../structure/services.md)):

```json
{
  "name": "sheaf-chat",
  "host": "0.0.0.0",
  "port": 9004,
  "home_path": "/",
  "command": "make sheaf-chat-run"
}
```

### `GET /health`

```json
{ "healthy": true, "uptime": 12.345 }
```

### `POST /exit`

```json
{ "exiting": true }
```

### `GET /api/health`

```json
{
  "service": "sheaf-chat",
  "version": "0.1.0",
  "status": "ok",
  "dependencies": {
    "localInference": { "configured": true, "available": true },
    "openAi": { "configured": true }
  }
}
```

`localInference.configured` is true when both URL and key are set;
`available` mirrors the same condition at config-load time (it does not probe
the endpoint). `openAi.configured` is true when `openai_api_key` is set.

### Static asset URLs

| URL | File |
|---|---|
| `/`, `/index.html` | `projects/sheaf-chat/src/ui/index.html` |
| `/assets/sheaf-chat/sheaf-chat.js`, `.css` | `projects/sheaf-chat/src/ui/` |
| `/assets/sheaf-chat/sheaf-markdown.js` | `projects/sheaf-chat/src/ui/sheaf-markdown.js` |
| `/assets/web/agui-chat.js`, `.css` | `projects/web/src/` |
| `/assets/vendor/markdown-it.min.js` | `projects/sheaf-chat/node_modules/markdown-it/dist/markdown-it.min.js` |
| `/assets/vendor/katex.min.js`, `/assets/vendor/katex.min.css` | `projects/sheaf-chat/node_modules/katex/dist/` |
| `/assets/vendor/fonts/<font>.woff`, `.woff2`, `.ttf` | KaTeX font files discovered in `projects/sheaf-chat/node_modules/katex/dist/fonts/` |
| `/assets/vendor/highlight.min.js` | `projects/sheaf-chat/node_modules/@highlightjs/cdn-assets/highlight.min.js` |
| `/assets/vendor/highlight-github-dark-dimmed.min.css` | `projects/sheaf-chat/node_modules/@highlightjs/cdn-assets/styles/github-dark-dimmed.min.css` |

### REST error catalogue (status mapping)

| Code | Status |
|---|---|
| `invalid_request`, `invalid_json`, `invalid_id`, `invalid_name`, `invalid_manifest`, `invalid_history_request`, `invalid_sequence`, `model_unavailable`, `invalid_root_directory`, `unsupported_file`, `not_a_file`, `not_a_directory` | 400 |
| `path_escape` | 403 |
| `not_found`, `manifest_not_found`, `model_not_found`, `chat_not_found`, `file_not_found` | 404 |
| `method_not_allowed` | 405 |
| `internal_error` (and any unmapped code) | 500 |

## Design

- `src/server/main.ts` — boot sequence; logs
  `Sheaf Chat listening on <host>:<port>` to stderr and exits with code 0
  after `/exit` cleanup completes.
- `src/server/config.ts` — `LoadSheafChatConfig`; `repo_paths.ts` —
  root discovery and default path set.
- `src/server/server.ts` — request dispatch order (`/exit`, `/health`,
  `/api/`, static), upgrade handling, and idempotent resource cleanup;
  `http.ts` — `SendJson`/`ReadJsonBody`.
- `src/server/router.ts` — segment-based API route matching with
  `decodeURIComponent` on path parameters (a malformed escape is
  `invalid_request`).
- `src/server/errors.ts` — error-code → status table and the
  `StorageError`/`ModelValidationError`/`AgentManagerError` → REST mapping.
- `src/server/static.ts` — asset roots, traversal checks, content-type
  whitelist, and vendor allowlist for Markdown-it/KaTeX assets.
- `src/server/streamProfiler.ts` — profiling checkpoints; enabled once at
  module load from the environment.
- `server.close()` is shared by tests and the `/exit` shutdown path.

## Interactions

- [workspace-chats](../sheaf-chat-workspace-chats/spec.md), [session-history](../sheaf-chat-session-history/spec.md),
  [models](../sheaf-chat-models/spec.md) — REST routes dispatched by this capability's router.
- [chat-protocol](../sheaf-chat-chat-protocol/spec.md) — WebSocket upgrades validated before
  `ws` handshake.
- [chat-ui](../sheaf-chat-chat-ui/spec.md) — consumes the static assets and index shell.
- [file-browser](../sheaf-chat-file-browser/spec.md) — adds session file REST routes and uses
  the vendor Markdown/KaTeX assets.
