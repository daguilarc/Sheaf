# Slice 0007: REST API — Implementation Complete

## Summary

Implemented the full Sheaf Chat REST API on the existing Node `http` server, wired through `AgentManager` and earlier storage/model/AGUI foundations.

## Delivered

- `src/server/http.ts` — JSON request/response helpers
- `src/server/errors.ts` — stable `{ error: { code, message } }` mapping to HTTP status codes
- `src/server/websockets.ts` — `BuildChatWebSocketUrl` for `/ws/chat?...`
- `src/server/router.ts` — route matching and dispatch
- `src/server/routes/` — handlers for health, piles, sessions, history, and models
- `src/server/server.ts` and `src/server/main.ts` — server boot with `AgentManager`
- `src/agents/manager.ts` — `listModels()` for the models endpoint
- `tests/server/rest/` — HTTP integration tests for all endpoints

## Endpoints

- `GET /api/health`
- `GET /api/piles` / `POST /api/piles`
- `GET /api/piles/:pile/sessions` / `POST /api/piles/:pile/sessions`
- `GET /api/piles/:pile/sessions/:sessionId`
- `GET /api/piles/:pile/sessions/:sessionId/history`
- `GET /api/models`

Blank session creation returns `sessionId`, provisional metadata, and a WebSocket URL without writing a manifest. History fallback supports `before`, `after`, latest paging, `limit` bounds, and `prefer=events|snapshots`.

## Validation

`make sheaf-chat-test` passes (94 tests).
