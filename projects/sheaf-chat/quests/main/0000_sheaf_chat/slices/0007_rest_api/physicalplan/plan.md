# Slice 7: REST API

## Objective

Expose the required HTTP APIs for health, piles, sessions, history fallback, and models, using the storage/model/agent foundations from earlier slices.

Expected outcome:

- The service listens on port `9004` through `make sheaf-chat-run`.
- All required REST endpoints exist with stable JSON error responses.
- Creating a session returns provisional metadata and a WebSocket URL without persisting a manifest.
- History fallback works for tests and recovery even though the UI will primarily use WebSocket history requests.

## Key Files And Systems

- `projects/sheaf-chat/src/server/http.ts`
- `projects/sheaf-chat/src/server/routes/*.ts`
- `projects/sheaf-chat/src/server/errors.ts`
- `projects/sheaf-chat/src/server/static.ts` only if serving UI shell here
- `projects/sheaf-chat/tests/server/rest/`

## Existing APIs To Reuse

- Node `http` server or a minimal established dependency if introduced in slice 1. Prefer not adding Express unless it clearly reduces complexity for routing/tests.
- Storage APIs from slice 2.
- Provider/model APIs from slice 4.
- Agent manager session shell creation from slice 5.
- AGUI snapshot/history APIs from slice 6.

## APIs To Extend Or Modify

- Add route handlers for:
  - `GET /api/health`
  - `GET /api/piles`
  - `POST /api/piles`
  - `GET /api/piles/:pile/sessions`
  - `GET /api/piles/:pile/sessions/:sessionId`
  - `POST /api/piles/:pile/sessions`
  - `GET /api/piles/:pile/sessions/:sessionId/history?before=<cursor>&limit=<n>`
  - `GET /api/models`
- Add URL builder for `/ws/chat?p=<pile>&session=<sessionId>&client=<clientId>&after=<sequence>`.

## Implementation Notes

- `GET /api/health` returns service name/version and dependency status that does not leak secrets.
- `GET /api/piles` returns pile names, session counts, and latest update time.
- `POST /api/piles` accepts `{ "pile": "name" }` and validates with storage rules.
- Session listing returns manifests newest first and excludes heavy message history.
- `POST /api/piles/:pile/sessions` accepts `{ rootDirectory, model }`, validates root/model, allocates a session shell through the agent/storage layer, and returns `sessionId`, provisional session metadata, and WebSocket URL. It must not write the manifest.
- History fallback should support `before`, `after`, no cursor latest page, and `limit` bounds.
- Every error response should be `{ "error": { "code": "...", "message": "..." } }` with appropriate HTTP status.

## Validation

- HTTP tests for every endpoint, including success and validation errors.
- Tests assert blank session creation does not write a manifest.
- Tests assert history fallback can return events or snapshots and does not require all history to load.
- Tests assert model API returns availability metadata and stable errors when config is missing.
- `make sheaf-chat-test`
