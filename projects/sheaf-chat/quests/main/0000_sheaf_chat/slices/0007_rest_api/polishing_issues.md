# Issues

## Issue PL-0001

- status: open
- owner_role: polisher_reviewer
- created_at: 2026-06-08T22:40:48Z
- updated_at: 2026-06-08T22:40:48Z
- title: Resolved-but-undispatched /api/piles/:pile route hangs the connection
- details: In `src/server/router.ts`, `ResolveApiEndpoint()` returns the endpoint key `"pile"` for a 3-segment path `/api/piles/:pile` (lines 110-114), and `MatchApiRoute()` returns `{ pile }` for the same path (lines 66-69). However, `DispatchApiRoute()` has no branch that handles `endpoint === "pile"` — the only handled keys are `health`, `models`, `piles`, `pile_sessions`, `pile_session`, and `pile_session_history`.

## Consequence

A request such as `GET /api/piles/work` passes both the `endpoint !== null` and `route !== null` guards, enters the `try` block, matches none of the `if` branches, and reaches the end of the `try` **without** ever calling `SendJson`/`SendRestError` and **without** throwing. No response is ever written, so the HTTP connection hangs until the client/socket times out. This is a silent dead route plus a per-request resource leak (a hung `ServerResponse`), not a clean 404.

## Why it is a problem

- The slice spec does not define a bare `GET /api/piles/:pile` endpoint, so correct behavior is a stable `404 not_found` JSON error consistent with the rest of the API. Instead the server hangs.
- It is reachable from any client that requests a single pile by name (a natural guess given `/api/piles` exists). Non-GET methods on the same path hang identically.
- It is completely untested: `tests/server/rest/rest.test.ts` never issues a request to `/api/piles/:pile` (only `/api/piles`, `/api/piles/:pile/sessions`, etc.). The helper `RequestJson` uses `fetch().json()`, which would never resolve on this path, so the gap is invisible to the current suite.

## What must be true to close this issue

1. A request to `GET /api/piles/:pile` (e.g. `/api/piles/work`) returns a deterministic JSON response (a `404 not_found` error is the expected choice) and never hangs. The same must hold for non-GET methods on that path.
2. `router.ts` no longer exposes an endpoint key that `ResolveApiEndpoint` can return but `DispatchApiRoute` cannot dispatch — i.e. either remove the `"pile"` resolution, or add an explicit dispatch branch, or add a default fall-through at the end of the dispatch `if`-chain that always sends a response.
3. A regression test in `tests/server/rest/` asserts the chosen status/error code for `GET /api/piles/:pile` so the dead route cannot silently return.
- resolution_notes: none
