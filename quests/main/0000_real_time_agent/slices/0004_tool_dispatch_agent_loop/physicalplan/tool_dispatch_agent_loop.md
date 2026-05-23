# Physical Plan: Tool Dispatch and Agent Loop

## Objective

Implement the reusable realtime agent session orchestration layer, including startup sequencing, initial prompt/context injection, serial tool callback execution, tool result emission, conversation callbacks, and session finalization.

Expected outcome:

- Library callers can start an agent session from `AgentStartConfig`.
- Startup creates and persists a session row before connecting.
- The agent sends session configuration, startup conversation input, and response trigger events.
- Model tool calls invoke matching callbacks through a per-session FIFO queue with default concurrency 1.
- Tool success and failure results are returned to the model as structured `function_call_output` events.
- Connection loss marks the session ended with `connection_lost`.
- Graceful shutdown marks the session ended with an appropriate non-error reason.

## Key Files and Systems

- Add `apps/realtime-agent/src/tooling.ts`.
- Add `apps/realtime-agent/src/agent_loop.ts`.
- Extend `apps/realtime-agent/src/event_router.ts` for tool-call extraction callbacks if needed.
- Extend `apps/realtime-agent/src/types.ts` with agent runtime, tool lifecycle, and shutdown result types.
- Add tests under `apps/realtime-agent/test/tooling/` and `apps/realtime-agent/test/agent_loop/`.
- Export the agent-loop public entry point from `apps/realtime-agent/src/index.ts`.

## Existing APIs to Reuse As-Is

- Reuse `ToolDefinition`, `ToolCallSet`, `AgentStartConfig`, and callback hook types from slice 0001.
- Reuse session and event repositories from slice 0002.
- Reuse `RealtimeClient`, event router, and session config builder from slice 0003.
- Reuse Node `AbortController` for cancellation/shutdown where helpful.

## APIs to Define or Extend

Define `ToolRegistry` or equivalent:

- Validates unique tool names within a `ToolCallSet`.
- Resolves a tool by name.
- Produces Realtime-compatible tool descriptors from `ToolDefinition` values.

Define `ToolDispatcher`:

- Accepts extracted tool calls with `callId`, `name`, raw argument JSON, and optional response/item metadata.
- Parses JSON arguments and returns a structured tool error payload on malformed JSON.
- Enqueues work in FIFO order.
- Runs callbacks serially by default.
- Continues allowing incoming realtime events to be processed while callbacks run.
- Emits lifecycle callbacks for queued, started, succeeded, and failed states.

Define tool result event construction:

- Emits `conversation.item.create` with `item.type = "function_call_output"`.
- Includes `item.call_id` using the `call_id` received from the completed model function-call item.
- Serializes successful callback results into `item.output` as a JSON string.
- Serializes missing-tool, malformed-args, and thrown-callback failures as structured error payloads rather than throwing out of the session loop.

Define `RealtimeAgentSession` or `startAgentSession(config, deps)`:

- Creates a UUID session ID.
- Builds the session config JSON and persists `sessions` with prompts, context, tool set name, tool names JSON, model, and session config JSON.
- Connects to the realtime socket.
- Sends `session.update`.
- Sends startup `conversation.item.create` containing system prompt and initial context as conversation input.
- Sends `response.create` when needed to trigger the initial model turn.
- Routes all incoming events through the event router.
- Detects tool calls from `response.function_call_arguments.delta` plus completed function-call payloads in `response.done` output items. If incremental argument deltas require accumulation, keep that accumulation scoped by call/item ID in this module.
- Invokes default conversation callback for non-tool model output events when the caller does not provide one.
- Exposes `sendAudioFrame(pcmBase64OrBuffer)` for the CLI slice to call; this method sends `input_audio_buffer.append` with a base64 `audio` field using the transport and existing persistence policy.
- Exposes `stop(reason)` for graceful shutdown.

## Enabling Refactor

If slice 0003 embedded too much startup behavior in the transport, move orchestration-only logic into `agent_loop.ts` here. Keep `RealtimeClient` transport-focused and keep persistence policy in the event router/repositories.

## Validation

- Unit tests verify duplicate tool names are rejected before connecting.
- Unit tests verify startup order: session row persisted, socket connected, `session.update` sent, initial conversation item sent, response trigger sent.
- Unit tests verify session metadata fields match prompts, context, model, tool set name, tool names, and session config JSON.
- Unit tests verify FIFO tool execution with two async callbacks where the second starts only after the first completes.
- Unit tests verify incoming events continue to route while a tool callback is pending by using a fake client and delayed callback.
- Unit tests verify successful tool callback result emits and persists a `function_call_output` event.
- Unit tests verify missing tool, malformed args, and thrown callback each emit structured error output and do not terminate the session.
- Unit tests verify unexpected socket close ends the session with `ended_reason = "connection_lost"`.
- Unit tests verify `stop("operator_shutdown")` or equivalent marks `ended_at` and the supplied reason.
- `npm run build` and `npm test` pass in `apps/realtime-agent`.

## Sequencing Notes

This slice depends on slices 0001 through 0003. It should be completed before CLI audio work so the CLI can be a thin wrapper over stable library APIs.
