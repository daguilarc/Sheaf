# Issues

## Issue QP-0001

- status: open
- owner_role: physical_plan_reviewer
- created_at: 2026-06-06T19:32:12Z
- updated_at: 2026-06-06T19:32:12Z
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
    To resolve, the physical plan for the appropriate slice (most naturally slice
    0002, where Conductor's own server and `GET /health` are built, or slice 0003
    where lifecycle is added) must either:
    (a) add a `POST /exit` endpoint to the Conductor backend so Conductor honors
        the same registered-service lifecycle contract it enforces, and ensure the
        stop/restart-of-self path is covered; or
    (b) explicitly document in the relevant slice plan that Conductor's own
        `POST /exit` is intentionally out of scope for this quest per the spec's
        explicit endpoint enumeration, and describe the expected behavior when a
        user issues stop/restart against the `conductor` service so it is a
        deliberate, tested outcome rather than an accidental gap.
