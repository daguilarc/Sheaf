# Slice 0007: REST API — Implementation Accepted

## Acceptance Summary

The REST API slice is implemented correctly and completely against the slice spec and physical plan. All required endpoints exist with stable `{ error: { code, message } }` JSON responses and appropriate HTTP status codes:

- `GET /api/health` (service metadata + dependency status, no secrets leaked)
- `GET /api/piles`, `POST /api/piles`
- `GET /api/piles/:pile/sessions`, `POST /api/piles/:pile/sessions`
- `GET /api/piles/:pile/sessions/:sessionId`
- `GET /api/piles/:pile/sessions/:sessionId/history` (before/after/latest paging, `limit` bounds, `prefer=events|snapshots`)
- `GET /api/models`
- `BuildChatWebSocketUrl` for `/ws/chat?...`

Spec-critical behaviors are verified by tests: blank session creation returns `sessionId`, provisional metadata, and a WebSocket URL without writing a manifest; history fallback returns events or snapshots without loading all history; models endpoint returns availability metadata.

## Review Cycles

- **Cycle 1:** Filed PL-0001 — a 3-segment `/api/piles/:pile` path was resolved by `ResolveApiEndpoint` to an endpoint key (`"pile"`) that `DispatchApiRoute` had no branch for, causing the request to fall through the `try` block without sending any response (hung connection / leaked `ServerResponse`) instead of returning a clean 404.
- **Cycle 2:** Verified the fix. The unsupported `"pile"` resolution was removed (3-segment paths now resolve to `null` → 404), a default `404 not_found` fall-through was added at the end of the dispatcher's `if`-chain so every resolved route always sends a response, and regression tests assert `404 not_found` for both `GET` and `POST /api/piles/work` using `AbortSignal.timeout(1000)` to catch hangs. PL-0001 closed as completed.

No open issues remain.
