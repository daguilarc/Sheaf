# Physical Plan: Realtime Transport and Event Routing

## Objective

Implement the WebSocket realtime transport adapter, session configuration event construction, generic event send/receive handling, and event routing callbacks. This slice should support fake WebSocket tests and should not require microphone capture or real OpenAI credentials for validation.

Expected outcome:

- The library can build the required `session.update` payload for `gpt-realtime-2` with audio input, text output, transcription, and server VAD at 500ms.
- The transport connects to `wss://api.openai.com/v1/realtime?model=<model>` with the required authorization header and optional safety identifier.
- Incoming and outgoing non-audio events are routed to persistence and callbacks.
- Unknown event types are accepted and forwarded through generic handling.
- Outgoing audio buffer append events can be sent but are neither persisted nor printed by later stdout wiring.

## Key Files and Systems

- Add `apps/realtime-agent/src/realtime_client.ts`.
- Add `apps/realtime-agent/src/event_router.ts`.
- Add `apps/realtime-agent/src/session_config.ts` or keep the builder in `agent_loop.ts` later if the codebase stays simpler; choose the smaller API during implementation.
- Add tests under `apps/realtime-agent/test/realtime/` and `apps/realtime-agent/test/events/`.
- Extend `apps/realtime-agent/src/types.ts` with transport options, event callback hooks, and session config types.
- Extend `apps/realtime-agent/src/index.ts` exports.

## Existing APIs to Reuse As-Is

- Reuse persistence repository APIs from slice 0002 for event persistence.
- Reuse public event types from slice 0001, preserving generic arbitrary fields.
- Reuse the selected package's WebSocket client rather than implementing WebSocket framing.
- Reuse Node's standard `EventEmitter` only if it simplifies local fake tests; avoid exposing `EventEmitter` as the primary public API unless it is clearly the package pattern.

## APIs to Define or Extend

Define `RealtimeClient`:

- Constructor accepts `apiKey`, `model`, optional `safetyIdentifier`, optional `baseUrl`, and optional injectable WebSocket factory for tests.
- `connect()` opens the socket and resolves when open.
- `send(event: RealtimeEvent)` serializes structured events as JSON.
- `onEvent(handler)`, `onError(handler)`, and `onClose(handler)` or equivalent callback registration.
- `close()` performs graceful socket close.

Define event routing:

- `routeIncomingEvent(event)` persists the incoming event and emits typed/generic callback hooks.
- `routeOutgoingEvent(event)` persists outgoing events according to policy before or after transport send; the implementation should avoid claiming persistence for a send that synchronously fails.
- Classification helpers for known event classes listed in the spec:
  - session lifecycle
  - input audio/turn boundary
  - transcription delta/final
  - text output delta/final
  - tool-call related
  - error
  - unknown
- Classification must not reject unknown `event.type` values.

Define session configuration builder:

- Produces a `session.update` event with `session.type = "realtime"`.
- Enables audio input.
- Sets output modalities to `["text"]`.
- Requests text-only model output with `output_modalities: ["text"]` and does not configure `audio.output` fields.
- Enables transcription.
- Sets input audio format to PCM at 24kHz.
- Sets server VAD with `silence_duration_ms = 500`, `create_response = true`, and `interrupt_response = true`.
- Includes tool definitions from the active `ToolCallSet` in `session.tools`, mapping each tool to `{ type: "function", name, description, parameters: inputSchema }`.

## Enabling Refactor

If persistence APIs from slice 0002 are synchronous, introduce a minimal async facade here only if required to keep transport code uniform. Do not replace the repository layer or add a message bus.

## Validation

- Unit tests assert the connection URL and headers for model, API key, and optional `OpenAI-Safety-Identifier`.
- Unit tests assert the `session.update` payload includes VAD, transcription, text-only output, 24kHz PCM input, and tools.
- Fake WebSocket tests verify structured outgoing events are serialized and sent.
- Fake WebSocket tests verify incoming JSON messages are parsed, persisted, and routed.
- Tests verify unknown event types are persisted and surfaced through generic callbacks.
- Tests verify invalid incoming JSON is reported as a transport/protocol error without crashing the test process.
- Tests verify outgoing `input_audio_buffer.append` is sent but not persisted.
- `npm run build` and `npm test` pass in `apps/realtime-agent`.

## Sequencing Notes

This slice depends on slices 0001 and 0002. It should be completed before tool execution and CLI integration so later slices can rely on a stable transport and event router.
