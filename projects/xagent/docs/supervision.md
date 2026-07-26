# xagent Event-Driven Supervision — Operations and Rollback

## Service lifecycle

The `xagent` service is a long-lived, Conductor-managed process that owns worker runs over streamable HTTP MCP. It binds only to loopback.

### Start

```bash
make xagent-service-run
```

This runs `node dist/src/service_main.js` from `projects/xagent`. The service reads `config/services.json`, binds to `127.0.0.1:9005`, and serves MCP at `http://127.0.0.1:9005/mcp`.

### Health check

```bash
curl -s http://127.0.0.1:9005/health
```

Returns `200` with `{ "healthy": true, "uptime": <seconds> }` while the service is accepting connections.

### Stop (orderly shutdown)

```bash
curl -s -XPOST http://127.0.0.1:9005/exit
```

Returns `{ "exiting": true }`, stops accepting new connections, closes every owned session/process group, and exits `0`. A `SIGINT`/`SIGTERM` to the process triggers the same orderly path.

## Endpoint and tools

| Path | Method | Purpose |
| --- | --- | --- |
| `/health` | `GET` | Liveness and uptime |
| `/exit` | `POST` | Orderly shutdown |
| `/mcp` | `POST` | Streamable HTTP MCP |

The six MCP tools exposed by the service:

1. `xagent_start` — create a run from an absolute existing `cwd`, a `prompt`, a `harness`, and an optional `mode`/`policy`.
2. `xagent_submit` — send a new user message to a running worker.
3. `xagent_await` — block until the next deliverable event after `after_sequence` or until `deadline_seconds` elapses.
4. `xagent_inspect` — return the compact phase/sequence snapshot for a run without blocking.
5. `xagent_interrupt` — request a cooperative interrupt of the active turn.
6. `xagent_close` — close the run and release owned process resources.

## Final envelope

A successful `xagent_await` returns the complete sanitized final assistant report inline:

```json
{
  "run_id": "<id>",
  "event": "turn.completed",
  "sequence": <int>,
  "report": { "text": "<complete final assistant message>" }
}
```

Routine deltas, tools, raw events, status, and healthy watchdog verdicts never complete an await. Missing final text yields `missing_final_report`.

## Deterministic vs Haiku boundary

Mechanical states are classified deterministically and never invoke Haiku:

- process exit / spawn failure
- turn completion / failure
- transport failure
- exposed input / permission wait
- cancellation / close
- hard deadline
- silence timeout

Haiku is eligible only while a live worker is actively producing tokens, messages, or tools. It runs fresh with `--safe-mode`, `--tools ""`, `--strict-mcp-config`, an empty MCP config, `--no-session-persistence`, structured JSON output, bounded input/output, and no repository working directory.

## Watchdog defaults

| Knob | Default |
| --- | --- |
| Active-work cadence | 10 / 20 / 40 minutes |
| Minimum interval between checks | 5 minutes |
| Repeated tool fingerprint threshold | 3 identical in 10 minutes |
| Repeated failure fingerprint threshold | 2 identical in 10 minutes |
| Healthy confidence floor | `0.8` |
| Input bound | 64 KiB UTF-8 |
| Output bound | 2 KiB |
| Maximum calls per run | 8 |

Watchdog results are advisory only. `derailed`, `uncertain`, invalid, failed, over-budget, and low-confidence output emit one sequenced attention event but never message, interrupt, kill, restart, edit for, or otherwise steer the worker.

## Timeouts

| Setting | Value |
| --- | --- |
| `xagent_await` default deadline | 7000 seconds |
| `xagent_await` maximum deadline | 7000 seconds |
| Plugin MCP `tool_timeout_sec` | 7200 seconds |
| Service request timeout | 7,200,000 ms |
| Service headers timeout | 7,270,000 ms |

## Recovery behavior

- An MCP/client disconnect or cancelled await releases only request-local resources; the Conductor-managed service continues owning the worker.
- A controller can reconnect by `run_id` and call `xagent_inspect` / `xagent_await` to reattach.
- An orderly service exit closes every owned session and process group.
- On restart, reconciliation marks unattachable active runs `abandoned` and kills a process only when PID plus process-start identity matches persisted ownership.

## Central logs

Logs are written under the configured log root (resolved from `getDefaultLogRoot(repoRoot)`). Each run records its lifecycle phase transitions, attention events, and watchdog evidence for post-hoc review.

## Rollback to legacy CLI

If event-driven supervision must be bypassed, invoke the legacy in-process runner directly:

```bash
xagent run --subagent
```

or

```bash
xagent run --full
```

These keep the existing parsing, persistent stdin protocol, output filtering, and logs without starting or contacting the service.
