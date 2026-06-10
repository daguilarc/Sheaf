# Capability: Service

ID prefix: `svc`

## Purpose

The long-running Sheaf Chat process: configuration loading, service-registry
boot, the two health endpoints, static and vendor asset serving for the
browser UI, and the REST dispatch/error conventions every API route shares.

## Requirements

- **[svc-1]** WHEN started, THE service SHALL discover the repository root by
  walking up from the working directory to the first directory containing
  both `config/services.json` and `structure/`, and SHALL fail startup with
  `repository root not found` if none exists.
- **[svc-2]** WHEN started, THE service SHALL read `config/services.json`
  (a JSON array of service definitions) and bind to the `host` and `port` of
  the entry named `sheaf-chat`; IF the entry is missing, THEN THE service
  SHALL fail startup with the message
  `sheaf-chat is not registered in config/services.json` and exit code 1.
- **[svc-3]** THE service SHALL read non-secret configuration from
  `config/global_config.json` and secrets from `config/api_keys.json`
  (see Contracts); both files are optional and missing or malformed-typed
  keys fall back to defaults rather than failing startup.
- **[svc-4]** THE service SHALL serve `GET /health` returning 200
  `{"healthy": true, "uptime": <seconds since start>}`; any other method on
  `/health` SHALL return 405 with the standard error body.
- **[svc-5]** THE service SHALL serve `GET /api/health` returning 200 with
  service name, version, status `ok`, and non-secret dependency status (see
  Contracts); the response SHALL never contain secret values.
- **[svc-6]** THE service SHALL serve the browser UI shell
  (`src/ui/index.html`) at `GET /` and `GET /index.html` as
  `text/html; charset=utf-8`.
- **[svc-7]** THE service SHALL serve static files under
  `/assets/sheaf-chat/*` from `projects/sheaf-chat/src/ui/` and under
  `/assets/web/*` from `projects/web/src/`, with content types limited to
  `.css`, `.js`, and `.html`; any other extension, a path containing `..` or
  `\`, or a resolved path outside the asset root SHALL return 404.
- **[svc-8]** THE service SHALL return every REST error as
  `{"error": {"code": "<code>", "message": "<message>"}}` with the status
  code mapped from the error catalogue (unknown codes map to 500).
- **[svc-9]** IF an `/api/` path matches no route, THEN THE service SHALL
  respond 404 `not_found` / `route not found`; IF a matched route does not
  support the method, THEN 405 `method_not_allowed` / `method not allowed`.
- **[svc-10]** IF a request body on a POST API route is not valid JSON, THEN
  THE service SHALL respond 400 `invalid_json` /
  `request body is not valid JSON` (an empty body parses as `null` and then
  fails the route's object validation).
- **[svc-11]** IF an unexpected error escapes a route handler, THEN THE
  service SHALL respond 500 with code `internal_error`.
- **[svc-12]** WHERE `SHEAF_CHAT_PROFILE_STREAM=1` is set in the
  environment, THE service SHALL emit single-line JSON profiling records
  (`{"profile":"sheaf-stream","tMs":…,"point":…,…}`) to stderr at stream
  checkpoints; otherwise it SHALL emit none.
- **[svc-13]** THE service SHALL serve vendor assets only from the explicit
  allowlist for Markdown-it, KaTeX JavaScript/CSS, and KaTeX font files
  under `/assets/vendor/`; any unlisted vendor path SHALL return 404.

## Contracts

### Configuration keys

`config/global_config.json`:

| Key | Type | Default | Meaning |
|---|---|---|---|
| `local_inference_url` | string | unset (`null`) | Base URL of an OpenAI-compatible inference endpoint; trimmed; empty string treated as unset. See [models](models.md). |
| `agent_idle_offload_seconds` | number > 0 | `300` | Seconds a session may sit with no connected clients before its Pi session is offloaded (floored to an integer). Non-positive/non-finite values fall back to the default. |

`config/api_keys.json` (operator-created; may be absent):

| Key | Type | Default | Meaning |
|---|---|---|---|
| `local_inference_api_key` | string | unset | Bearer key for the local inference endpoint. Both URL and key must be set for local inference to be "available". |
| `openai_api_key` | string | unset | Bootstrap OpenAI API key, installed as a runtime key in the service-local Pi auth storage. |

`config/services.json` entry (see
[Services](../../../../structure/services.md)):

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

### REST error catalogue (status mapping)

| Code | Status |
|---|---|
| `invalid_request`, `invalid_json`, `invalid_pile`, `invalid_session_id`, `invalid_name`, `invalid_manifest`, `invalid_history_request`, `invalid_sequence`, `model_unavailable`, `invalid_root_directory`, `unsupported_file`, `not_a_file`, `not_a_directory` | 400 |
| `path_escape` | 403 |
| `not_found`, `pile_not_found`, `manifest_not_found`, `model_not_found`, `session_not_found`, `file_not_found` | 404 |
| `method_not_allowed` | 405 |
| `internal_error` (and any unmapped code) | 500 |

## Design

- `src/server/main.ts` — boot sequence; logs
  `Sheaf Chat listening on <host>:<port>` to stderr.
- `src/server/config.ts` — `LoadSheafChatConfig`; `repo_paths.ts` —
  root discovery and default path set.
- `src/server/server.ts` — request dispatch order (`/health`, `/api/`,
  static) and upgrade handling; `http.ts` — `SendJson`/`ReadJsonBody`.
- `src/server/router.ts` — segment-based API route matching with
  `decodeURIComponent` on path parameters (a malformed escape is
  `invalid_request`).
- `src/server/errors.ts` — error-code → status table and the
  `StorageError`/`ModelValidationError`/`AgentManagerError` → REST mapping.
- `src/server/static.ts` — asset roots, traversal checks, content-type
  whitelist, and vendor allowlist for Markdown-it/KaTeX assets.
- `src/server/streamProfiler.ts` — profiling checkpoints; enabled once at
  module load from the environment.
- No graceful-shutdown or exit endpoint exists; `server.close()` is used by
  tests only.

## Interactions

- [piles-sessions](piles-sessions.md), [session-history](session-history.md),
  [models](models.md) — REST routes dispatched by this capability's router.
- [chat-protocol](chat-protocol.md) — WebSocket upgrades validated before
  `ws` handshake.
- [chat-ui](chat-ui.md) — consumes the static assets and index shell.
- [file-browser](file-browser.md) — adds session file REST routes and uses
  the vendor Markdown/KaTeX assets.
