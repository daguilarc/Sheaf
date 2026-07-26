## Context

xagent currently provides a long-lived stdin/stdout session. `--subagent` filters raw provider details, but it still emits assistant deltas as often as every 1500 ms and returns to `session.ready` after each turn so a controller can send follow-ups. That is useful for interactive work, but it is a poor wait interface for Codex: terminal output and short polling timeouts repeatedly wake the leader model, causing it to reprocess the full parent context merely to learn that the child is still running.

Native Codex subagents demonstrate the intended separation. A child runs in its own context, the parent blocks on a mailbox-style wait, and only completion or a genuine attention event needs to re-enter the parent model. xagent already persists normalized and raw provider events, so it has the evidence needed to supervise external harnesses without streaming that evidence into the leader context.

Most worker health states are deterministic. Process exit, terminal provider events, transport loss, lack of output, explicit input/permission requests, cancellation, and deadlines do not need an LLM. The only model-worthy state is a live worker that is still generating tokens or tool activity but appears to be looping, thrashing, contradicting its task, or losing direction.

The primary consumer is the Codex xagent plugin and the OpenSpec/Superpowers workflow. The long-lived owner is a proper Sheaf `xagent` service registered with and launched by Conductor; controller processes and MCP connections are disposable clients. The supervision core must remain transport-independent and testable with the fake adapter. Existing `xagent run --subagent|--full` behavior must remain compatible.

## Goals / Non-Goals

**Goals:**

- Suspend a Codex leader while an xagent worker is healthy, with no model-visible progress polling.
- Wake the leader exactly for completion, failure, deterministic attention, semantic watchdog attention, cancellation, or the caller's explicit await deadline.
- Detect silence, crashes, blocked input, and transport failures without an LLM.
- Use a small one-off Haiku only for bounded semantic assessment of an active transcript.
- Preserve a complete sanitized audit trail while returning compact, cursor-based events and the complete final assistant report to the controller.
- Run supervision as a loopback Sheaf service managed by Conductor, with standard health and orderly-exit behavior.
- Expose that service directly to Codex as Streamable HTTP MCP through plugin discovery, with a quiet service-client CLI fallback.
- Preserve active runs across controller, Codex, plugin-client, and individual await-request disconnects.
- Keep persistent follow-ups, interruption, and explicit close under controller control.
- Measure wake count, deterministic alerts, watchdog count/cost, verdicts, and time-to-detect.

**Non-Goals:**

- Automatically kill, restart, steer, edit for, or otherwise remediate a worker based on a watchdog verdict.
- Ask Haiku to call tools, read repository files, inspect processes, or determine ordinary liveness.
- Replace existing interactive `xagent run` output modes.
- Guarantee that an arbitrary provider session can survive an xagent service process or machine crash.
- Add a general-purpose job scheduler or remote execution service.
- Change Codex's native subagent implementation.

## Decisions

### 1. Separate supervision core from controller transports

Add a `Supervisor` layer around one active xagent session. It owns the run state machine, deterministic timers, semantic evidence window, attention queue, and telemetry. A long-lived `XagentService` owns supervisors and provider child processes. The Streamable HTTP MCP handlers and quiet CLI client call the service; neither controller transport owns the worker.

```text
Codex plugin `.mcp.json` ──HTTP /mcp──┐
                                      ├──> XagentService ──> Supervisor ──> provider
quiet `xagent supervise` client ──────┘          │               │
                                                 │               ├── deterministic classifier
Conductor ──start/health/exit────────────────────┘               ├── semantic evidence window
                                                                 ├── sparse Haiku classifier
                                                                 └── persisted event queue/logs
```

This avoids embedding Codex-specific behavior in adapters, makes the fake adapter sufficient for lifecycle tests, and ensures a controller disconnect cannot terminate a healthy run. A transport-only filter was rejected because it would hide output but could not classify health, retain attention state, or support cursor-based waits. A plugin-local stdio supervisor was rejected because its lifetime and process ownership would remain coupled to the boss session.

### 2. Use an explicit supervision state machine

Each supervised run has one lifecycle phase:

- `starting`
- `running`
- `ready` (a persistent session finished its current turn and can accept a follow-up)
- `completed` (a configured one-shot run, or an explicitly closed persistent session, ended successfully)
- `failed`
- `cancelled`
- `abandoned` (the owning supervisor disappeared and the run cannot be safely reattached)

State transitions append a `supervision.*` event with a monotonically increasing sequence. Attention is an orthogonal durable event queue rather than a lifecycle phase: an attention event records the phase in which it occurred, while the worker remains `running` or `ready`. Attention events are identified by sequence so repeated awaits with an `after_sequence` cursor do not redeliver the same event.

An attention transition does not stop the provider. The leader decides whether to continue waiting, interrupt, send a later follow-up, or close the run. This preserves the user's rule that the watchdog reports madness but never acts on it.

### 3. Make deterministic classification authoritative for mechanical states

The supervisor handles these conditions without Haiku:

- child process exit or spawn failure;
- provider `turn.completed`, `turn.failed`, or session termination;
- permission/input-required provider events when exposed by an adapter;
- transport read/write failure;
- explicit cancel or close;
- configured hard deadline;
- configured silence timeout while the process remains alive.

Any provider event or raw byte progress updates transport liveness. Meaningful normalized events additionally update the semantic evidence window. A silence timeout defaults to five minutes and is configurable per run. It emits deterministic `attention` rather than invoking Haiku.

Mechanical suspicion signals such as repeated identical tool fingerprints, repeated error/retry cycles, or sustained token production without a new semantic event may request an earlier semantic check, but they never independently declare the agent derailed.

### 4. Invoke Haiku only for active semantic health

The semantic watchdog is eligible only while the worker is alive and continuing to emit tokens, messages, or tool activity. It receives:

- the sanitized original task prompt, bounded by the watchdog input limit;
- the bounded recent semantic event window;
- compact counts and fingerprints for repeated tools/errors;
- elapsed time and the previous watchdog verdict, if any.

It receives no repository filesystem, MCP servers, built-in tools, session persistence, or prior Claude conversation. Claude Code is launched one-off with Haiku, safe customizations, tools disabled, structured JSON output, and explicit input/output and per-run invocation budgets.

The verdict schema is:

```json
{
  "verdict": "healthy | derailed | uncertain",
  "confidence": 0.0,
  "reason_code": "short_machine_readable_code",
  "evidence": ["bounded factual observation"]
}
```

The supervisor remains silent only for a `healthy` verdict meeting the configured confidence floor. `derailed` and `uncertain` both produce `supervision.attention`; low-confidence or invalid output is normalized to `uncertain`. Haiku output cannot contain executable controller instructions.

The default periodic schedule is 10 minutes of active work, then 20 minutes, then 40-minute intervals, reset when a new user turn starts. The minimum semantic-check interval is five minutes. Default suspicion signals are three identical normalized tool fingerprints or two identical failure fingerprints in a rolling ten-minute window. The healthy confidence floor is `0.8`; the watchdog input is capped at 64 KiB of UTF-8 text and the classifier verdict output at 2 KiB. The 2 KiB bound is applied to the normalized structured output (the schema-valid verdict with evidence truncated to a per-item UTF-8 byte bound), not the surrounding Claude Code JSON envelope, whose `result` field duplicates the structured output as a string and adds transport metadata (`session_id`, `usage`, `duration_ms`, ...) that the classifier did not author; counting those against the verdict bound would force every schema-valid maximal verdict into `classifier_output_too_large` and wake the controller once per checkpoint. JSON Schema `maxLength` is character-based, so the schema sent to Claude Code bounds each evidence item at 192 characters; because 192 non-ASCII characters (e.g. CJK at 3 bytes per character) serialize to 576 bytes per item, normalization additionally truncates each evidence item to 192 UTF-8 bytes so a maximal schema-valid verdict fits within the 2 KiB output cap regardless of encoding. The default hard cap is eight watchdog calls per run. These defaults are configuration, not provider-adapter policy.

Using Haiku as the polling loop was rejected: timers and process events are cheaper and more reliable, and repeated LLM checks would merely move the busy wait.

### 5. Make xagent a Conductor-managed Sheaf service

Register `xagent` in `config/services.json` at `127.0.0.1:9005` with command `make xagent-service-run`. Binding to loopback is deliberate: the controller API can launch privileged local agent processes and is not a LAN-facing interface. The service reads its bind address from the registry, exposes the standard cheap deterministic `GET /health` and orderly idempotent `POST /exit` endpoints, and writes operational logs to stdout/stderr for Conductor while retaining run records under the central xagent log root.

The service owns every supervised provider process independently of any client connection. Closing an MCP connection, cancelling an individual await, compacting or restarting a Codex thread, or exiting the plugin client leaves the run active. An orderly service exit closes owned sessions and process groups. After an unclean service restart, stale active metadata is reconciled to `abandoned` and any provably owned stale process is cleaned up using persisted PID/start-time identity; provider reattachment across an xagent service crash remains out of scope.

Conductor supplies lifecycle and observability only: it starts, stops, health-checks, and captures logs for xagent under the existing explicit service-management contract. It does not classify worker health, poll run progress, or restart xagent automatically.

### 6. Expose the service directly as Streamable HTTP MCP

The xagent service exposes Streamable HTTP MCP at `http://127.0.0.1:9005/mcp`. The installed plugin adds `.mcp.json` with an HTTP server entry pointing to that URL, `tool_timeout_sec: 7200`, and the manifest's `mcpServers` reference. Codex supports Streamable HTTP MCP and per-server `tool_timeout_sec`; setting it in the bundled connection avoids the normal 60-second default. The plugin does not launch a stdio proxy or package a second supervisor runtime.

The server exposes a small controller API:

- `xagent_start`: validate the requested existing working directory, create a supervised persistent session, submit the initial prompt, and return `run_id` plus the first event cursor.
- `xagent_await`: block on `run_id` after a cursor until turn completion, failure, attention, cancellation, abandonment, or the explicit await deadline.
- `xagent_inspect`: return compact persisted phase/cursor metadata for explicit recovery or user-requested status inspection without returning transcript progress.
- `xagent_message`: submit a follow-up when the session is `ready`.
- `xagent_interrupt`: stop the active provider turn without interpreting watchdog advice; preserve the provider session when the adapter can do so.
- `xagent_close`: close the session and owned child processes.

`xagent_await` returns no routine progress and does not use MCP progress notifications that become model-visible. The plugin configures a 7200-second MCP tool timeout. Await defaults to 7000 seconds and rejects larger requested deadlines, leaving transport cleanup margin while allowing a 90-minute healthy run to complete in a single boss sleep. A caller resumes after attention using the returned cursor so the same event is not redelivered.

On successful turn completion, `xagent_await` returns the complete sanitized final assistant report—not a summary and not a transcript pointer—in this versioned envelope:

```json
{
  "schema_version": 1,
  "event": "turn.completed",
  "run_id": "run_...",
  "sequence": 42,
  "phase": "ready",
  "report": {
    "text": "complete final assistant message"
  },
  "elapsed_ms": 123456,
  "usage": {}
}
```

`phase` is `ready` for a persistent session and `completed` for a one-shot run. `usage` is present only when the provider reports it. xagent does not include intermediate assistant deltas, tool events, raw provider events, watchdog evidence, or prior turns in this result. Failure, attention, abandonment, cancellation, and deadline results use the same outer fields with an event-specific compact payload and no invented report. If a provider reports successful completion without a final assistant message, xagent returns a deterministic `missing_final_report` failure rather than making the boss search logs.

One monolithic `run_and_wait` tool was rejected because attention handling, controller reattachment, and same-session follow-ups require a stable run handle across multiple controller turns.

### 7. Provide a quiet service-client CLI fallback without changing interactive run

Add `xagent supervise` with the existing harness/model/thinking/permission options and an initial prompt. It is a client of the Conductor-managed xagent service and emits only:

- startup failure;
- `supervision.attention`;
- terminal completion/failure/cancellation;
- final session close.

All deltas, tools, raw provider events, and healthy watchdog results stay out of the leader context. On the supervised path the service does not persist routine provider output to the run logs; it persists only lifecycle phase transitions, attention events, and watchdog telemetry (see decision 8). The legacy `xagent run` runtime continues to persist normalized and raw provider events to the same log root. When an attention event is emitted, the process and provider remain service-owned so a later CLI invocation or MCP controller can reattach using `run_id`. The xagent skill treats the CLI as a fallback when MCP discovery is unavailable but the xagent service is healthy, uses one service-side blocking await, and never polls `xagent list` for routine progress.

The quiet CLI exposes explicit follow-up, interrupt, inspect, await, and close operations against an existing `run_id`. A follow-up is accepted only in `ready`; interrupt is accepted only in `running`; close ends the session from any non-terminal phase. Invalid state/command combinations emit one compact error without changing the worker.

Changing `--subagent` to become silent was rejected because it would break existing callers that depend on final/delta output and persistent stdin.

### 8. Persist supervision evidence and reconcile crashes

Run metadata gains supervisor state, last event sequence, child ownership information, last progress timestamps, and aggregate watchdog telemetry. A separate sanitized watchdog JSONL log records inputs by hash/size, verdicts, usage, and attention sequence without duplicating unrestricted prompts.

On orderly xagent service shutdown, xagent closes owned children. On startup, the service binds its listener BEFORE running reconciliation, so a duplicate start against an already-occupied port exits on `EADDRINUSE` without touching any run owned by the running instance. Once the bind succeeds, metadata still marked `starting`, `running`, or `ready` is reconciled. If the new service cannot prove ownership and safely reattach, the run becomes `abandoned` and inspection reports deterministic attention; it is never reported as healthy. Cross-service-restart provider reattachment is deferred until every adapter exposes a reliable contract.

Controller delivery is cursor-based rather than destructive dequeue. Therefore a replacement boss that knows the `run_id` can call `xagent_inspect` and then await from a retained cursor, or from sequence zero when recovering without one, and receive a durable completion or attention event. Routine progress remains excluded.

### 9. Keep progress observable outside the leader context

The supervised path persists only lifecycle phase transitions, attention events, and watchdog telemetry (decision 8); it does not persist a provider transcript. `xagent inspect`, persisted metadata, `xagent logs` (which on the supervised path surfaces only the lifecycle/attention/watchdog records above), and the Codex subagent/activity UI remain the post-hoc surfaces. They are not part of the wait loop. The controller may inspect them after an attention event, a long await deadline, or an explicit user status request — but on the supervised path there is no provider transcript to inspect; remediation that needs the worker's intermediate output must request it from the worker or rely on the legacy `xagent run` runtime, which continues to persist normalized and raw provider events.

Skill guidance for both native and xagent workers will require:

- one long event wait after independent controller work is exhausted;
- no routine `list_agents`, `xagent list`, or short `write_stdin` polling;
- child-to-parent messages only for blockers, required input, and completion;
- progress commentary through UI/log surfaces rather than leader model turns.

The `asd-23` MODIFIED block retires the prior *Skill explains invocation and
harness permission failures* scenario deliberately. Sandboxed Codex agents can
still invoke xagent, but real runs that lack write, network, auth, or process
permissions now surface through the general "broken agentic infrastructure"
escalation guidance rather than a dedicated `log_root_unavailable` paragraph.
The runtime still emits `log_root_unavailable` (`xa-13` is unchanged); only the
skill-level paragraph and its spec scenario were retired, so the skill and the
live spec remain aligned after archiving.

## Risks / Trade-offs

- **[Long HTTP MCP calls may hit client, server, or intermediary timeouts]** → Bind directly on loopback without a reverse proxy, configure a 7200-second client and server request timeout, cap await at 7000 seconds, test a synthetic 90-minute wait, and document the quiet service-client CLI fallback.
- **[The xagent service is unavailable when a plugin tool is called]** → Return a structured infrastructure failure, direct the controller to inspect Conductor health, and never silently start an unmanaged second supervisor.
- **[A loopback controller API can launch powerful local agents]** → Bind only to `127.0.0.1`, reject non-loopback listener configuration in the shipped service entry, validate working directories, and do not advertise a LAN URL.
- **[Haiku confidently misclassifies healthy exploration]** → Treat verdicts as advisory, never auto-remediate, include factual evidence, use a healthy confidence floor, and measure false alerts.
- **[Haiku misses requirements because watchdog input is bounded]** → Include the original prompt when it fits; otherwise record truncation and force `uncertain` when the supplied evidence is insufficient.
- **[Provider event schemas do not expose permission/input waits uniformly]** → Keep classification adapter-specific behind normalized supervisor signals and treat unsupported cases as silence/uncertainty rather than inventing state.
- **[Attention returns while the worker continues spending tokens]** → Make this explicit; the controller can immediately interrupt or continue. Automatic interruption remains out of scope.
- **[xagent service crash leaves a provider process behind]** → Persist PID/start-time ownership, close process groups on orderly shutdown, reconcile state to `abandoned`, and clean up only a process whose identity is proven.
- **[Extra supervisor state complicates the current small runtime]** → Isolate the state machine, clock, classifier, and transport adapters behind narrow interfaces with fake clocks/processes.
- **[Controller skills regress to polling]** → Add exact skill assertions and transcript-level tests that bound model-visible wake counts for a long fake run.

## Migration Plan

1. Add the supervisor state machine, deterministic classifier, evidence window, telemetry, and fake-clock tests without changing existing CLI behavior.
2. Add the Haiku classifier behind an injected interface; validate no-tools invocation and structured-output failure handling with fakes before any live smoke test. The optional live smoke (`tests/claude_watchdog_live.test.ts`, gated on `XAGENT_RUN_LIVE_WATCHDOG_SMOKE=1` and `claude` on `PATH`) exercises the real spawn path against `claude` but is not part of default `npm test`; run it manually before relying on the watchdog in production.
3. Add the xagent HTTP service, register it at `127.0.0.1:9005`, add standard health/exit behavior, and validate Conductor start/stop/log ownership and controller-disconnect survival.
4. Add Streamable HTTP MCP and the exact final-report envelope; configure 7200-second transport timeouts and validate start/await/inspect/attention/follow-up/close plus a synthetic 90-minute wait. The 90-minute wait is verified at the run-manager layer with a fake clock; the primary Codex MCP path's 90-minute single-POST transport assumption is not verified in this branch (see "Transport provenance" in `docs/supervision.md`).
5. Convert `xagent supervise` into a quiet service client and verify terminal-only output without creating a second supervisor.
6. Add plugin `.mcp.json` discovery for the service and validate it from a temporary non-Sheaf repository.
7. Update xagent and OpenSpec/Superpowers skills only after installed MCP discovery and blocking-wait tests pass.
8. Run a controlled comparison that records leader wake count and processed tokens for interactive polling versus service-backed await.

Rollback consists of removing or stopping the registered xagent service, disabling the plugin MCP entry, and reverting skill routing to the existing `xagent run --subagent` commands. Existing interactive commands and logs remain compatible throughout migration.

## Open Questions

None require a product decision before implementation. The fixed defaults may later be changed through a separate measured change, but this implementation does not tune them opportunistically while coding.
