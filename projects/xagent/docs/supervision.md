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

Returns `{ "exiting": true }`, stops accepting new connections, closes every owned session/process group, and exits `0`. Conductor stops the service primarily via `POST /exit`; a direct `SIGINT`/`SIGTERM` to the process is not currently trapped and will terminate it without the orderly close path, so prefer `/exit` for clean shutdown.

## Endpoint and tools

| Path | Method | Purpose |
| --- | --- | --- |
| `/health` | `GET` | Liveness and uptime |
| `/exit` | `POST` | Orderly shutdown |
| `/mcp` | `POST` | Streamable HTTP MCP |

The six MCP tools exposed by the service:

1. `xagent_start` — create a run from an absolute existing `cwd`, a `prompt`, a `harness`, and an optional `mode`/`policy`.
2. `xagent_message` — send a new user message to a running worker.
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

### False-alert posture

The watchdog fixtures document the false-alert boundary for each scenario:

- **Healthy exploration**: a high-confidence healthy verdict (`confidence >= 0.8`) stays controller-silent. No attention is emitted. This is the primary false-alert guard: routine diverse work never wakes the controller.
- **Repeated tool / failure loops**: deterministic suspicion signals (`repeated_failure_fingerprint` at 2 occurrences, `repeated_tool_fingerprint` at 3) make the watchdog eligible early, but the classifier must still confirm `derailed`. A single suspicion signal alone never declares the worker derailed.
- **Task contradiction / insufficient evidence**: no deterministic signal fires; only the periodic Haiku check detects these. An `uncertain` verdict (e.g., from a single short delta) emits one advisory attention so the controller can decide — it is a true uncertain verdict, not a false alert.
- **Silence / crash**: zero classifier calls. These are deterministic and advisory; the controller decides whether to wait, interrupt, or close.

In all cases the worker is never auto-interrupted, auto-killed, or auto-restarted by the watchdog.

## Wake comparison

A 90-minute healthy run with sustained semantic progress (one delta per minute under the default 5-minute silence timeout) compares controller-visible wake counts as follows. The MCP await and quiet CLI rows are measured by `supervision_cost.test.ts`; the 30-second polling row is an analytic expectation for an alternative wait strategy.

| Wait mode | Wake count | Leader-visible progress in completion envelope |
| --- | --- | --- |
| 30-second terminal polling (`xagent_inspect` every 30 s) | 180 (analytic) | none — inspect snapshots are not completion envelopes |
| Quiet CLI fallback (one blocking await) | 1 (measured) | final report only — no deltas, tools, or progress fields |
| MCP await (`xagent_await`) | 1 (measured) | final report only — envelope shape asserts absence of deltas/tools/progress |

The MCP await and quiet CLI paths wake exactly once for the terminal `turn.completed` event. Routine deltas, tools, raw events, status, and healthy watchdog verdicts never complete an await. Parent-side token or byte totals are not measured here; the tests instead assert that completion envelopes omit non-terminal progress fields.

## Timeouts

| Setting | Value |
| --- | --- |
| `xagent_await` default deadline | 7000 seconds |
| `xagent_await` maximum deadline | 7000 seconds |
| Quiet-client MCP await HTTP chunk | 240 seconds (reissued until the application deadline; avoids ~300s fetch/undici body idle drops) |
| Plugin MCP `tool_timeout_sec` | 7200 seconds |
| Service request timeout | 7,200,000 ms |
| Service headers timeout | 7,270,000 ms |

## Recovery behavior

- An MCP/client disconnect or cancelled await releases only request-local resources; the Conductor-managed service continues owning the worker.
- A controller can reconnect by `run_id` and call `xagent_inspect` / `xagent_await` to reattach.
- An orderly service exit closes every owned session and process group.
- On restart, reconciliation marks unattachable active runs `abandoned` and kills a process only when PID plus process-start identity matches persisted ownership.

### Service-crash boundary

Provider reattachment across an xagent service crash is **out of scope**. If the service process itself crashes, owned worker processes are orphaned; the service does not reattach to them on restart. Restart reconciliation marks unattachable active runs `abandoned` and only kills a process when PID plus process-start identity matches persisted ownership. A controller that needs to survive a service crash should treat the run as terminated and start a new run.

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
