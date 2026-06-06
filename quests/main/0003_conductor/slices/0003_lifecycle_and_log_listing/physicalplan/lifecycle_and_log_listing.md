# Physical Plan: Lifecycle APIs And Log Listing

## Objective

Add user-initiated service lifecycle controls and safe REST log listing to the Conductor backend while keeping polling separate from service management.

Expected outcome:

- `POST /api/services/{service_name}/start` runs the service's configured command from the repository root and returns structured process/start information plus current heartbeat state.
- `POST /api/services/{service_name}/stop` prefers the service's `POST /exit` lifecycle endpoint and returns structured stop request information plus current heartbeat state.
- `POST /api/services/{service_name}/restart` requests a clean stop and then starts the configured command.
- Stop and restart work for the registered `conductor` service by calling Conductor's own `POST /exit` endpoint from slice 0002; tests cover this self-management path with injected fakes so the test process is not terminated.
- `GET /api/services/{service_name}/logs` lists files under `logs/<service_name>/` only, with path, size, and modified timestamp.
- Lifecycle APIs return `404` for unknown services and structured errors for invalid or unusable commands.
- Log listing rejects path traversal and never exposes files outside the resolved service log root.

## Key Files And Systems

- Add `projects/conductor/src/lifecycle.ts` for start/stop/restart orchestration.
- Add `projects/conductor/src/process_runner.ts` or equivalent injectable wrapper around `child_process.spawn`.
- Add `projects/conductor/src/logs.ts` for log root resolution and listing.
- Extend `projects/conductor/src/server.ts` routing for lifecycle and log listing endpoints.
- Extend `projects/conductor/src/service_presenter.ts` or response helpers for lifecycle result shapes.
- Add tests under `projects/conductor/tests/lifecycle*.ts` and `projects/conductor/tests/logs*.ts`.

## Existing APIs To Reuse As-Is

- Reuse `LoadServiceRegistry` and service lookup from slice 0002.
- Reuse heartbeat state/presenter from slice 0002 so lifecycle responses include the current or most recent heartbeat state without forcing a live health check.
- Reuse repo-root path helpers from slice 0001 for command working directory and log root resolution.
- Reuse Node's `child_process.spawn` through an injectable process runner for production, and fake process runners in tests.
- Reuse Node `fetch` with timeout for `POST /exit`.
- Reuse Conductor's own `POST /exit` endpoint from slice 0002 for `POST /api/services/conductor/stop` and as the stop phase of `POST /api/services/conductor/restart`.

## APIs To Define Or Extend

Define lifecycle service:

- `StartService(service)`:
  - Validate `command` is a non-empty string from the registry.
  - Run it from the repository root.
  - Use shell execution only if needed to honor the registry's repo-root-relative command string; otherwise parse with a clear command-splitting helper and document the chosen behavior.
  - Detach or keep process handles in memory only as needed to report process information; do not create persistent desired state or supervisor policy.
  - Return `{ name, action: "start", started, process, heartbeat }`.
- `StopService(service)`:
  - Send `POST /exit` to the service origin, using `127.0.0.1` or `localhost` for outbound requests when the configured host is `0.0.0.0`.
  - Return `{ name, action: "stop", stop_requested, heartbeat }`.
  - For `service.name === "conductor"`, this request targets the same running server's `/exit` route. Implement it through the same injectable exit requester used for other services so tests can verify the self-stop URL and result without terminating Conductor.
  - If `/exit` is unreachable, return a structured error or `stop_requested: false`; do not silently kill arbitrary processes unless an in-memory process handle from a prior Conductor start is available and the implementation documents that fallback.
- `RestartService(service)`:
  - Request stop first, then start with the configured command.
  - For `service.name === "conductor"`, make the response explicit that restart was requested after self-stop and that the new process start uses the registry command. Because the current HTTP process may exit after `/exit`, tests should use injected exit/start fakes rather than relying on a live in-process restart.
  - Return `{ name, action: "restart", restart_requested, process, heartbeat }`.
  - Keep behavior user-initiated; do not add automatic retries or desired-state reconciliation.

Define command validation:

- Unknown service returns `404`.
- Missing, empty, or non-string `command` returns a structured JSON error with an appropriate 4xx status.
- Spawn failures return a structured JSON error with process details when available.

Define log listing:

- Service log root is `logs/<service_name>/`, matching the structure-level convention and the spec's initial log directory convention.
- If the log root does not exist, return `{ name, log_root, files: [] }`.
- Recursively list regular files under the service log root unless the implementation chooses a simpler top-level-only listing; if top-level-only is chosen, document it in the API docs in slice 0005. The safer and more useful default is recursive relative paths.
- File entries include:
  - `path` relative to `log_root` using `/` separators
  - `size` in bytes
  - last modified timestamp in ISO-8601 UTC
- Use resolved absolute paths and relative-path checks to ensure every listed file is inside the resolved log root.
- Do not accept a client-provided file path on this REST endpoint; the WebSocket slice will validate selected files separately.

## Enabling Refactor

If route matching from slice 0002 is becoming repetitive, introduce a small explicit route table in `server.ts`. Keep it local to Conductor; do not build a generic framework abstraction for the repo.

## Validation

- Lifecycle tests use fake process runners and fake exit fetchers rather than launching arbitrary long-running processes.
- Tests cover start success, invalid command, spawn failure, unknown service `404`, and response heartbeat inclusion.
- Tests cover stop success through `POST /exit`, unreachable `/exit`, unknown service `404`, the `conductor` self-stop URL/path, and no automatic process killing unless the implementation explicitly owns a process handle.
- Tests cover restart ordering: stop is attempted before start, including the registered `conductor` service path with injected fakes.
- Log listing tests cover missing log directory, normal file listing, nested file relative paths if recursive listing is implemented, file size and modified timestamp, and unknown service `404`.
- Path traversal tests verify helpers reject absolute paths and `..` segments for any reusable log path resolver.
- `npm run build` and `npm test` pass in `projects/conductor`.

## Sequencing Notes

This slice depends on slice 0002. Slice 0004 should reuse the log root/path validation helpers introduced here for WebSocket file selection.
