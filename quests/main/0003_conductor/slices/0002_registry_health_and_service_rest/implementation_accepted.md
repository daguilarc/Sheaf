# Implementation Accepted

Slice `0002_registry_health_and_service_rest` is accepted by the polisher reviewer.

## Scope reviewed

Registry loading/validation, 30s health polling with in-memory heartbeat state,
Conductor `GET /health` and `POST /exit`, and the read-only service REST APIs
(`GET /api/services`, `/api/services/{name}`, `/api/services/{name}/health`).
Lifecycle controls, logs, WebSocket, and UI are out of scope for this slice.

## Verification

- Physical plan APIs implemented as specified: registry validation, loopback
  resolution for `0.0.0.0` polling, healthy = 2xx + valid JSON + `healthy:true`
  + numeric uptime, all failure modes treated as unhealthy with preserved
  timestamps, no service lifecycle actions from the poll loop.
- `POST /exit` sends `{ exiting: true }` before running shutdown work; order
  (poller stop -> server close) asserted via the injectable shutdown controller
  without terminating the test runner.
- Presenter merges heartbeat state and derives `home_url` from the configured host.
- `main.ts` binds the conductor entry (`0.0.0.0:9001`); `config/services.json`
  registers conductor with `home_path`.
- Test coverage matches the plan's validation checklist: registry (malformed JSON,
  non-array, invalid entries, duplicates, optional home_path), `/health` shape with
  increasing uptime, `/exit` shape and ordering, all six poller health cases, and
  REST list/detail/health/home_url/404 cases.

## Notes (non-blocking)

- `presentAllServices` throws if a server-listed service has no poller heartbeat;
  this cannot occur with the current construction (poller initializes state for all
  registered services). Worth keeping in mind if the two service lists ever diverge.
- Failed polls retain the previous `uptime`/`warning` as last-known values; this is
  acceptable per the spec's "latest response fields when available".

No open polishing issues.
