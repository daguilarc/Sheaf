# Conductor — Living Spec

Conductor is the command hub service manager. It is a single Node.js process
that reads the service registry (`config/services.json`, contract:
[Services](../../../structure/services.md)), polls every registered service's
`GET /health` on a fixed interval, exposes REST endpoints for service status
and start/stop/restart, streams service log files over WebSocket, and serves a
browser UI for observing and controlling services.

This directory is the project's living spec under the rules in
[Docs Structure](../../../structure/docs-structure.md): normative requirements
with stable IDs, held to the rebuild-test standard. Spec status and known gaps
are tracked in [coverage.md](coverage.md).

- [Architecture](architecture.md) — process model, modules, data flow.
- [Operations](operations.md) — build, run, test, and stop, from fresh
  checkout.
- [Coverage](coverage.md) — rebuild-test audit and gap register.

## Capability Map

| Capability | Prefix | What it specifies |
|---|---|---|
| [service-management](capabilities/service-management.md) | `svc` | Startup and registry loading, health polling, conductor's own `/health` and `/exit`, the `/api/services` REST surface, start/stop/restart lifecycle actions, the npm package surface |
| [log-access](capabilities/log-access.md) | `log` | Per-service log file listing and the WebSocket byte-range log streaming protocol (open/read_before/follow), including path-safety rules |
| [web-ui](capabilities/web-ui.md) | `ui` | The browser UI: main service table page, per-service log viewer page, and constrained static asset serving |

## Shared Contracts

None. Each schema is owned by exactly one capability and specified inline
there. The service registry format is repository-level, owned by
[structure/services.md](../../../structure/services.md), and is not restated
here.
