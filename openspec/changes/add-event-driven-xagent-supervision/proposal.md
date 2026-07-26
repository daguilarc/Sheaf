## Why

Long-running subagents currently force Codex leaders to choose between frequent status polling and losing visibility into a worker that may have stalled or lost task direction. In a measured 90-minute workflow, parent-side polling consumed millions of tokens even though ordinary completion, silence, and process failure are machine-detectable; xagent can replace that churn with event-driven suspension and reserve a small semantic watchdog for the one condition deterministic supervision cannot recognize: an agent that is still producing activity while descending into an unproductive loop.

## What Changes

- Add an event-driven xagent supervision lifecycle that lets a controller start or attach to a run, await completion or an attention event without consuming streamed progress, and resume supervision after handling that event.
- Add deterministic health detection for process exit, provider completion/failure, missing output, permission/input blocking, deadlines, and transport loss without invoking a model.
- Add a bounded Haiku watchdog that evaluates only recent, sanitized semantic progress when a live worker continues producing tokens or tool activity but may be looping, thrashing, contradicting the brief, or losing task direction.
- Make watchdog verdicts advisory and structured: xagent remains silent for healthy progress and wakes the leader for high-confidence semantic failure or unresolved uncertainty; it never autonomously edits, steers, kills, or restarts the worker.
- Add a Conductor-managed `xagent` service on loopback that owns supervised provider processes, exposes standard Sheaf health and shutdown endpoints, and serves the controller API as Streamable HTTP MCP.
- Make the Codex plugin a thin MCP discovery package that connects to the service instead of launching or owning the supervisor, with a quiet service-client CLI fallback while preserving the current interactive `xagent run` protocol.
- Deliver the subagent's complete sanitized final assistant report directly in the successful `xagent_await` tool result, together with compact lifecycle and cursor metadata but no intermediate transcript.
- Update Codex workflow guidance to use long event waits, avoid repeated `list_agents`/short terminal polls, and keep routine progress visible out of band rather than injecting it into the leader context.
- Add supervision telemetry and tests that make parent wake counts, watchdog invocations, time-to-detect, and false alerts measurable.

## Capabilities

### New Capabilities

- `xagent-supervision`: Event-driven run supervision, deterministic health classification, bounded semantic watchdog evaluation, attention delivery, and supervision telemetry for `projects/xagent`.
- `xagent-service`: Conductor-managed xagent service lifecycle, loopback Streamable HTTP MCP transport, durable controller attachment, and process ownership.

### Modified Capabilities

- `xagent-cli`: Add a controller-facing quiet service client and plugin HTTP MCP discovery contract without changing the existing interactive stdin/stdout run behavior.
- `agents-skill-distribution`: Teach Codex xagent and OpenSpec/Superpowers workflows to prefer event-driven waits and prohibit routine short-interval status polling.

## Impact

- Affected source: `projects/xagent/src/`, its adapters, event protocol, logs/metadata, and tests.
- Affected service infrastructure: `config/services.json`, the root and xagent Makefiles, and Conductor smoke/health coverage gain the `xagent` service at `127.0.0.1:9005`.
- Affected distribution: `plugins/xagent/` gains `.mcp.json` discovery for `http://127.0.0.1:9005/mcp` and corresponding skill guidance; it does not package a second supervisor process.
- Affected workflow guidance: canonical xagent and OpenSpec/Superpowers skills under `projects/agents/global/skills/`.
- External dependency: one-off Claude Code Haiku classification with tools disabled, bounded input/output, structured output, and an explicit per-run budget.
- Operational behavior: interactive xagent remains compatible; the Conductor-managed service survives controller disconnects and controller-facing workflows gain long-lived waits, direct final-report delivery, reattachment, structured attention events, cancellation, timeout, and failure handling.
- Security/privacy: watchdog input is sanitized and bounded, contains no secrets or unrestricted repository context, and cannot make tool calls.
