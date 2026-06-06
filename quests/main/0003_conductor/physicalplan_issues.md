# Issues

## Issue QP-0001

- status: completed
- owner_role: physical_plan_reviewer
- created_at: 2026-06-06T19:32:12Z
- updated_at: 2026-06-06T19:34:30Z
- title: Conductor backend does not plan its own POST /exit lifecycle endpoint
- details: |
    `structure/services.md` (which spec section "Quest Overview" line 16 declares
    is part of the pre-quest specification context) states under "Required
    Endpoints" that every registered service should expose both `GET /health` and
    `POST /exit`. Slice 0001's plan registers Conductor itself in
    `config/services.json` (name `conductor`, `0.0.0.0:9001`), and slice 0002's
    plan implements Conductor's own `GET /health`, but no slice plan implements a
    `POST /exit` endpoint on the Conductor backend.

    This is a problem for two reasons:
    1. Conductor is a registered service in its own registry, so by the structure
       rules it should expose the standard lifecycle endpoints, including
       `POST /exit`. The current plan leaves Conductor as the only registered
       service that cannot honor the lifecycle contract it enforces on others.
    2. Slice 0003's stop/restart design "prefers the registered service lifecycle
       endpoint `POST /exit` when reachable." If a user invokes
       `POST /api/services/conductor/stop` (the UI in slice 0005 exposes stop on
       every listed service, including Conductor), the request targets
       `http://127.0.0.1:9001/exit`, which no slice plans to serve. The result is
       a permanent `stop_requested: false` / structured-error path for Conductor,
       which is inconsistent with the spec's stated stop/restart behavior.

    The spec's REST API section enumerates management endpoints and omits
    `POST /exit`, so this may be a deliberate scope decision rather than an
    oversight. The plan should make that decision explicit rather than leaving it
    implicit.
- resolution_notes: |
    Resolved via option (a). Verified against the updated slice plans and
    `physicalplan_issue_responses.md` (planner outcome: Fixed):
    - Slice 0002 now plans Conductor's own `POST /exit` endpoint backed by an
      injectable shutdown controller (`shutdown.ts`), with validation covering the
      response shape, shutdown-controller invocation, poller-stop behavior, and the
      response being flushed before shutdown runs.
    - Slice 0003 now explicitly covers the registered `conductor` stop/restart path
      through the same injectable exit requester, with tests asserting the self-stop
      URL/result without terminating the test runner.
    - Slice 0005 documents `POST /exit` in `docs/reference/api.md` and explains in
      the operations doc that stopping/restarting Conductor interrupts its own
      process after the response is acknowledged.
    Conductor now honors the registered-service lifecycle contract it enforces, and
    the self-stop timing risk is consciously acknowledged in the UI/ops docs. The
    injected-fake test design appropriately avoids killing the test process.
    Resolution criteria (for reference): (a) add a `POST /exit` endpoint so
    Conductor honors the same registered-service lifecycle contract and cover the
    stop/restart-of-self path; or (b) explicitly scope it out with defined, tested
    stop/restart-of-self behavior.
