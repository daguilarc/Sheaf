# Capability: Session Lifecycle

Project: `projects/realtime-agent`
ID prefix: `ses` — requirement IDs are append-only; never renumber or reuse.

## Purpose

`startAgentSession(config, deps)` is the single entry point both the CLI and
the VS Code extension use to run an OpenAI Realtime session. This capability
specifies the connection and startup sequence, the `RealtimeAgentSession`
API a caller gets back, how every event is routed (persisted, classified,
fanned out to callbacks), the structured-context envelope, and how sessions
end — gracefully or on connection loss.

## Requirements

### Requirement: ses-1 — Session creation and connection

WHEN `startAgentSession(config, deps)` is called with a valid tool call set and a database, THE library SHALL create a session row (see [persistence](../realtime-agent-persistence/spec.md)), open a WebSocket to the Realtime API, and resolve to a `RealtimeAgentSession` whose `sessionId` equals the session row's UUID id.

#### Scenario: Valid call
- **WHEN** `startAgentSession(config, deps)` is called with a valid tool call set and a database
- **THEN** the library creates a session row, opens a WebSocket to the Realtime API, and resolves to a `RealtimeAgentSession` whose `sessionId` equals the session row's UUID id

### Requirement: ses-2 — Missing database throws

IF `deps.database` is `undefined`, THEN `startAgentSession` SHALL throw `Error("startAgentSession requires deps.database")` without connecting.

#### Scenario: Database absent
- **WHEN** `startAgentSession` is called with `deps.database` as `undefined`
- **THEN** it throws `Error("startAgentSession requires deps.database")` without connecting

### Requirement: ses-3 — Duplicate tool name throws

IF `config.toolCallSet` contains two tools with the same `name`, THEN `startAgentSession` SHALL throw `DuplicateToolNameError` (message `Duplicate tool name in tool call set: <name>`) before creating a session row or connecting.

#### Scenario: Duplicate tool names
- **WHEN** `config.toolCallSet` contains two tools with the same `name`
- **THEN** `startAgentSession` throws `DuplicateToolNameError` with message `Duplicate tool name in tool call set: <name>` before creating a session row or connecting

### Requirement: ses-4 — Connection URL and model

THE library SHALL connect to `<baseUrl>?model=<urlencoded model>` where `baseUrl` defaults to `wss://api.openai.com/v1/realtime` (`DEFAULT_REALTIME_BASE_URL`); WHEN the base URL already contains `?`, the model parameter SHALL be appended with `&`. The model defaults to `DEFAULT_REALTIME_MODEL` = `gpt-realtime-2` when `config.model` is omitted.

#### Scenario: Default base URL
- **WHEN** `config.baseUrl` is not provided
- **THEN** the library connects to `wss://api.openai.com/v1/realtime?model=<urlencoded model>`

#### Scenario: Base URL with existing query string
- **WHEN** the base URL already contains `?`
- **THEN** the model parameter is appended with `&`

#### Scenario: Model omitted
- **WHEN** `config.model` is omitted
- **THEN** the model defaults to `DEFAULT_REALTIME_MODEL` = `gpt-realtime-2`

### Requirement: ses-5 — Authorization headers

THE library SHALL send header `Authorization: Bearer <apiKey>` on the WebSocket connection, plus `OpenAI-Safety-Identifier: <value>` WHERE `deps.safetyIdentifier` is a non-empty string.

#### Scenario: Authorization header always sent
- **WHEN** the WebSocket connection is opened
- **THEN** the `Authorization: Bearer <apiKey>` header is sent

#### Scenario: Safety identifier present
- **WHEN** `deps.safetyIdentifier` is a non-empty string
- **THEN** the `OpenAI-Safety-Identifier: <value>` header is also sent

### Requirement: ses-6 — Startup sequence on socket open

WHEN the socket opens, THE library SHALL transmit, in order: (1) the `session.update` event built from the tool call set and resolved turn mode (shape: [turn-model](../realtime-agent-turn-model/spec.md)); (2) a `conversation.item.create` with a `system`-role message whose single `input_text` part is `config.systemPrompt`; (3) a `conversation.item.create` with a `user`-role message whose single `input_text` part is `config.initialContext`; and (4) WHERE the resolved turn mode is `server_vad`, a bare `{"type": "response.create"}`. Manual mode sends no startup `response.create`.

#### Scenario: Socket opens — server VAD
- **WHEN** the socket opens and the resolved turn mode is `server_vad`
- **THEN** the library transmits in order: `session.update`, system `conversation.item.create`, user `conversation.item.create`, and `{"type": "response.create"}`

#### Scenario: Socket opens — manual mode
- **WHEN** the socket opens and the resolved turn mode is `manual`
- **THEN** the library transmits in order: `session.update`, system `conversation.item.create`, user `conversation.item.create` — and no startup `response.create`

### Requirement: ses-7 — Event routing

THE library SHALL route every incoming event and every transmitted outgoing event through the event router: persist it per the [persistence](../realtime-agent-persistence/spec.md) write policy, classify it (see Contracts), and invoke `onEvent` and `onConversationEvent` with `(event, { sessionId, direction })`.

#### Scenario: Incoming event routed
- **WHEN** an incoming event is received
- **THEN** it is persisted per the persistence write policy, classified, and `onEvent` and `onConversationEvent` are invoked with `(event, { sessionId, direction })`

#### Scenario: Outgoing event routed
- **WHEN** an outgoing event is transmitted
- **THEN** it is persisted per the persistence write policy, classified, and `onEvent` and `onConversationEvent` are invoked with `(event, { sessionId, direction })`

### Requirement: ses-8 — Default console logging

WHERE `config.onConversationEvent` is not supplied, THE library SHALL log `[<sessionId>] <direction> <event.type>` to the console for every routed event except events classified `tool_call` and `input_audio_buffer.append` events.

#### Scenario: onConversationEvent not supplied
- **WHEN** `config.onConversationEvent` is not supplied and a routed event is not classified `tool_call` and is not an `input_audio_buffer.append` event
- **THEN** the library logs `[<sessionId>] <direction> <event.type>` to the console

### Requirement: ses-9 — sendAudioFrame

THE session's `sendAudioFrame(pcmBase64OrBuffer)` SHALL accept a base64 string or a `Buffer` (converted to base64) and transmit `{"type": "input_audio_buffer.append", "audio": <base64>}` immediately (never queued).

#### Scenario: Base64 string sent
- **WHEN** `sendAudioFrame` is called with a base64 string
- **THEN** `{"type": "input_audio_buffer.append", "audio": <base64>}` is transmitted immediately

#### Scenario: Buffer sent
- **WHEN** `sendAudioFrame` is called with a `Buffer`
- **THEN** the buffer is converted to base64 and `{"type": "input_audio_buffer.append", "audio": <base64>}` is transmitted immediately

### Requirement: ses-10 — commitAudio and clearAudioBuffer

THE session's `commitAudio()` SHALL transmit `{"type": "input_audio_buffer.commit"}` immediately — bypassing the response queue even while a response is active — and resolve to `{ status: "sent" }`. `clearAudioBuffer()` SHALL likewise transmit `{"type": "input_audio_buffer.clear"}` immediately.

#### Scenario: commitAudio called
- **WHEN** `commitAudio()` is called
- **THEN** `{"type": "input_audio_buffer.commit"}` is transmitted immediately, bypassing the response queue, and the call resolves to `{ status: "sent" }`

#### Scenario: clearAudioBuffer called
- **WHEN** `clearAudioBuffer()` is called
- **THEN** `{"type": "input_audio_buffer.clear"}` is transmitted immediately

### Requirement: ses-11 — sendTextMessage validation and transmission

WHEN `sendTextMessage(text, options)` is called with non-empty text, THE session SHALL transmit a `user`-role `conversation.item.create` with one `input_text` part, including `previous_item_id` only when `options.previousItemId` is a non-empty string; IF `text` is empty, THEN it SHALL throw `TypeError("sendTextMessage requires non-empty text")`.

#### Scenario: Non-empty text
- **WHEN** `sendTextMessage(text, options)` is called with non-empty text
- **THEN** the session transmits a `user`-role `conversation.item.create` with one `input_text` part, including `previous_item_id` only when `options.previousItemId` is a non-empty string

#### Scenario: Empty text
- **WHEN** `sendTextMessage` is called with empty text
- **THEN** it throws `TypeError("sendTextMessage requires non-empty text")`

### Requirement: ses-12 — createResponse option on text and context sends

WHERE `options.createResponse === true`, `sendTextMessage`/`sendStructuredContext` SHALL submit the conversation item and a `response.create` as one response-affecting unit on the response queue ([turn-model](../realtime-agent-turn-model/spec.md)); otherwise the item is transmitted immediately and the call resolves `{ status: "sent" }`.

#### Scenario: createResponse true
- **WHEN** `sendTextMessage` or `sendStructuredContext` is called with `options.createResponse === true`
- **THEN** the conversation item and a `response.create` are submitted as one response-affecting unit on the response queue

#### Scenario: createResponse not true
- **WHEN** `sendTextMessage` or `sendStructuredContext` is called without `options.createResponse === true`
- **THEN** the item is transmitted immediately and the call resolves `{ status: "sent" }`

### Requirement: ses-13 — sendStructuredContext serialization

WHEN `sendStructuredContext(message, options)` is called, THE session SHALL serialize the envelope (see Contracts) with `JSON.stringify` and send it as the text of a `user`-role `input_text` conversation item; the `summary` key SHALL be omitted entirely when `message.summary` is `undefined`.

#### Scenario: Structured context sent
- **WHEN** `sendStructuredContext(message, options)` is called
- **THEN** the session serializes the envelope with `JSON.stringify` and sends it as the text of a `user`-role `input_text` conversation item

#### Scenario: Summary undefined
- **WHEN** `sendStructuredContext` is called with `message.summary` as `undefined`
- **THEN** the `summary` key is omitted entirely from the serialized envelope

### Requirement: ses-14 — sendRealtimeEvent routing

WHEN `sendRealtimeEvent(event, options)` is called, THE session SHALL require `event.type` to be a non-empty string (else `TypeError("sendRealtimeEvent requires event.type to be a non-empty string")`); `response.cancel` SHALL always transmit immediately; `response.create` SHALL go through the response queue with `options`; every other type SHALL transmit immediately and resolve `{ status: "sent" }`.

#### Scenario: Empty event type
- **WHEN** `sendRealtimeEvent` is called with an empty `event.type`
- **THEN** it throws `TypeError("sendRealtimeEvent requires event.type to be a non-empty string")`

#### Scenario: response.cancel event
- **WHEN** `sendRealtimeEvent` is called with a `response.cancel` event
- **THEN** it is transmitted immediately

#### Scenario: response.create event
- **WHEN** `sendRealtimeEvent` is called with a `response.create` event
- **THEN** it goes through the response queue with `options`

#### Scenario: Other event type
- **WHEN** `sendRealtimeEvent` is called with any other event type
- **THEN** it is transmitted immediately and resolves `{ status: "sent" }`

### Requirement: ses-15 — stop and idempotent finalization

WHEN `stop(reason)` is called, THE session SHALL close the socket, mark the session row ended with `ended_reason = <reason>` and an ISO-8601 `ended_at`, invoke `onSessionEnded({ sessionId, reason, session })` exactly once, and resolve to the final `SessionRow`. A second `stop` SHALL resolve to the already-ended row without re-ending or re-notifying.

#### Scenario: First stop call
- **WHEN** `stop(reason)` is called for the first time
- **THEN** the socket is closed, the session row is marked ended with `ended_reason` and ISO-8601 `ended_at`, `onSessionEnded` is invoked once, and the call resolves to the final `SessionRow`

#### Scenario: Subsequent stop call
- **WHEN** `stop` is called again on an already-ended session
- **THEN** it resolves to the already-ended row without re-ending or re-notifying

### Requirement: ses-16 — Unexpected connection loss

IF the WebSocket closes without a prior `stop()`, THEN THE session SHALL finalize itself with reason `connection_lost` (row ended, `onSessionEnded` invoked once).

#### Scenario: WebSocket closes unexpectedly
- **WHEN** the WebSocket closes without a prior `stop()` call
- **THEN** the session finalizes itself with reason `connection_lost`, marks the row ended, and invokes `onSessionEnded` once

### Requirement: ses-17 — Transport connect errors

IF `RealtimeClient.connect()` is called while already connected or connecting, THEN it SHALL reject with `RealtimeTransportError("RealtimeClient is already connected or connecting")`; IF the socket errors or closes before opening, THEN `connect()` SHALL reject with a `RealtimeTransportError` (close case message: `WebSocket closed before connection opened (<code>: <reason>)`). `startAgentSession` propagates connect rejections after the session row has been created.

#### Scenario: Already connected or connecting
- **WHEN** `RealtimeClient.connect()` is called while already connected or connecting
- **THEN** it rejects with `RealtimeTransportError("RealtimeClient is already connected or connecting")`

#### Scenario: Socket closes before opening
- **WHEN** the socket closes before connection is established
- **THEN** `connect()` rejects with a `RealtimeTransportError` with message `WebSocket closed before connection opened (<code>: <reason>)`

#### Scenario: Connect rejection propagated
- **WHEN** `connect()` rejects after the session row has been created
- **THEN** `startAgentSession` propagates the rejection

### Requirement: ses-18 — Send errors reported to handlers

IF `RealtimeClient.send` is called when the socket is absent or not open, or serialization/transmission throws, THEN the client SHALL NOT throw; it SHALL report a `RealtimeTransportError` to registered `onError` handlers (messages: `Cannot send event before connect() succeeds`, `Failed to serialize or send realtime event`).

#### Scenario: Send before connect
- **WHEN** `RealtimeClient.send` is called before the socket is open
- **THEN** the client does not throw and reports `RealtimeTransportError("Cannot send event before connect() succeeds")` to `onError` handlers

#### Scenario: Serialization or transmission failure
- **WHEN** serialization or transmission throws during `RealtimeClient.send`
- **THEN** the client does not throw and reports `RealtimeTransportError("Failed to serialize or send realtime event")` to `onError` handlers

### Requirement: ses-19 — Invalid incoming messages

IF an incoming WebSocket message is not a JSON object or lacks a non-empty string `type`, THEN the client SHALL report a `RealtimeTransportError` to `onError` handlers and SHALL NOT invoke event handlers for it.

#### Scenario: Non-JSON-object message
- **WHEN** an incoming WebSocket message is not a JSON object
- **THEN** the client reports a `RealtimeTransportError` to `onError` handlers and does not invoke event handlers for it

#### Scenario: Message missing type
- **WHEN** an incoming WebSocket message lacks a non-empty string `type`
- **THEN** the client reports a `RealtimeTransportError` to `onError` handlers and does not invoke event handlers for it

### Requirement: ses-20 — Public API exports

THE package SHALL expose its public API from `realtime-agent-lib`'s root export exactly as enumerated in `src/agent/src/index.ts` (pinned by `tests/agent/exports.test.ts`): session control (`startAgentSession`, `DuplicateToolNameError`), config and paths ([config](../realtime-agent-config/spec.md)), persistence ([persistence](../realtime-agent-persistence/spec.md)), transport (`RealtimeClient`, `RealtimeTransportError`, `buildRealtimeConnectionUrl`, `buildRealtimeConnectionHeaders`, `DEFAULT_REALTIME_BASE_URL`), routing (`EventRouter`, `classifyIncomingEvent`, `classifyOutgoingEvent`), tooling ([tool-dispatch](../realtime-agent-tool-dispatch/spec.md)), `buildSessionUpdateEvent`, audio capture ([audio-capture](../realtime-agent-audio-capture/spec.md)), runtime logging ([config](../realtime-agent-config/spec.md)), `DEFAULT_REALTIME_MODEL`, and the associated types.

#### Scenario: Root export checked
- **WHEN** the package's root export is inspected
- **THEN** all enumerated symbols — session control, config, persistence, transport, routing, tooling, audio capture, runtime logging, and associated types — are present exactly as listed in `src/agent/src/index.ts`

## Contracts

### `RealtimeAgentSession`

```ts
interface RealtimeAgentSession {
  readonly sessionId: string;
  sendAudioFrame(pcmBase64OrBuffer: string | Buffer): void;
  commitAudio(options?: QueueRequestOptions): Promise<QueuedEventResult>;
  createResponse(options?: CreateResponseOptions): Promise<QueuedEventResult>;
  commitAudioAndCreateResponse(options?: CreateResponseOptions): Promise<QueuedEventResult>;
  sendTextMessage(text: string, options?: SendMessageOptions): Promise<QueuedEventResult>;
  sendStructuredContext(message: StructuredContextMessage, options?: SendMessageOptions): Promise<QueuedEventResult>;
  sendRealtimeEvent(event: RealtimeEvent, options?: QueueRequestOptions): Promise<QueuedEventResult>;
  clearAudioBuffer(options?: QueueRequestOptions): Promise<QueuedEventResult>;
  stop(reason: string): Promise<SessionRow>;
}
```

`RealtimeEvent` is `{ type: string; [key: string]: unknown }`.
`QueuedEventResult` is `{ status: "sent" | "queued" | "rejected" | "cancelled";
reason?: string }`. `createResponse` / `commitAudioAndCreateResponse`
semantics: [turn-model](../realtime-agent-turn-model/spec.md).

### `AgentStartConfig` and `AgentSessionDeps`

| `AgentStartConfig` field | Meaning |
|---|---|
| `systemPrompt` (required) | Sent as the startup system message |
| `initialContext` (required) | Sent as the startup user message |
| `toolCallSet` (required) | `{ name?: string; tools: ToolDefinition[] }` |
| `model` | Default `gpt-realtime-2` |
| `turnMode` | Default server VAD; see [turn-model](../realtime-agent-turn-model/spec.md) |
| `responseAfterToolOutput` | `true` ⇒ follow-up `response.create` after every tool output; see [tool-dispatch](../realtime-agent-tool-dispatch/spec.md) |
| `onConversationEvent`, `onEvent` | Routed-event callbacks (`(event, {sessionId, direction})`) |
| `onToolLifecycle` | [tool-dispatch](../realtime-agent-tool-dispatch/spec.md) phases |
| `onSessionEnded` | `({sessionId, reason, session: SessionRow})`, once per session |

| `AgentSessionDeps` field | Meaning |
|---|---|
| `apiKey` (required) | Bearer token |
| `safetyIdentifier` | `OpenAI-Safety-Identifier` header value |
| `baseUrl` | Override `wss://api.openai.com/v1/realtime` |
| `database` (required in practice) | `RealtimeAgentDb`; absence throws (ses-2) |
| `webSocketFactory` | `(url, {headers}) => RealtimeWebSocketLike` injection seam for tests |

### Startup transcript (server VAD, worked example)

```json
{"type":"session.update","session":{ "...": "see turn-model" }}
{"type":"conversation.item.create","item":{"type":"message","role":"system","content":[{"type":"input_text","text":"<systemPrompt>"}]}}
{"type":"conversation.item.create","item":{"type":"message","role":"user","content":[{"type":"input_text","text":"<initialContext>"}]}}
{"type":"response.create"}
```

### Structured-context envelope

`sendStructuredContext` serializes exactly:

```json
{
  "kind": "file_changed_since_last_read",
  "source": "vscode",
  "payload": { "file": "src/example.ts" },
  "summary": "src/example.ts changed since last read"
}
```

`kind` is a free string, `source` is one of
`"vscode" | "language_server" | "tool" | "system"`, `payload` is an
arbitrary JSON object, `summary` is optional (omitted when undefined). The
kinds actually produced live in [freshness](../realtime-agent-freshness/spec.md).

### Event classification

Incoming (`classifyIncomingEvent`):

| Class | Event types |
|---|---|
| `session_lifecycle` | `session.created`, `session.updated` |
| `input_audio_turn` | `input_audio_buffer.speech_started`, `.speech_stopped`, `.committed` |
| `transcription` | `conversation.item.input_audio_transcription.delta`, `.completed` |
| `text_output` | `response.output_text.delta`, `.done` |
| `tool_call` | `response.function_call_arguments.delta`, `.done`, or `response.done` whose `response.output` contains a `function_call` item |
| `error` | `error` |
| `unknown` | everything else |

Outgoing (`classifyOutgoingEvent`):

| Class | Event types |
|---|---|
| `audio_buffer_append` | `input_audio_buffer.append` |
| `session_config` | `session.update` |
| `response_trigger` | `response.create` |
| `tool_output` | `conversation.item.create` whose `item.type` is `function_call_output` |
| `conversation_input` | any other `conversation.item.create` |
| `unknown` | everything else |

`EventRouter` also supports per-class callbacks
(`onSessionLifecycle`, `onTranscription`, …, `onUnknownOutgoing`) invoked
after the general callbacks.

### Error catalogue

| Condition | Behavior | Message (exact) |
|---|---|---|
| Missing `deps.database` | throw `Error` | `startAgentSession requires deps.database` |
| Duplicate tool name | throw `DuplicateToolNameError` | `Duplicate tool name in tool call set: <name>` |
| Empty `sendTextMessage` text | throw `TypeError` | `sendTextMessage requires non-empty text` |
| Empty `sendRealtimeEvent` type | throw `TypeError` | `sendRealtimeEvent requires event.type to be a non-empty string` |
| `connect()` while connected | reject `RealtimeTransportError` | `RealtimeClient is already connected or connecting` |
| Socket closed before open | reject `RealtimeTransportError` | `WebSocket closed before connection opened (<code>: <reason>)` |
| `send` before/after open | `onError` handlers, no throw | `Cannot send event before connect() succeeds` |
| Send serialization failure | `onError` handlers | `Failed to serialize or send realtime event` |
| Non-object incoming message | `onError` handlers | `Realtime message must be a JSON object` |
| Incoming message without type | `onError` handlers | `Realtime message is missing event type` |
| Unexpected socket close | session finalized | reason `connection_lost` via `onSessionEnded` |

## Design

- `src/agent/src/agent_loop.ts` — `startAgentSession` builds the registry,
  resolves the turn mode, creates the session row, wires
  `RealtimeAgentSessionImpl` (transmit path = client send + outgoing route +
  queue notification), connects, then transmits the startup sequence.
  `FinalizeSession` is idempotent via an `m_ended` flag; `stop()` sets a
  graceful flag so the close handler does not double-finalize.
- `src/agent/src/realtime_client.ts` — transport, URL/header builders,
  handler registries returning unsubscribe functions. Note: the session impl
  registers `onEvent`/`onClose` but no `onError` handler, so post-close send
  errors are dropped silently (listed in [coverage](../../../projects/realtime-agent/docs/coverage.md)).
- `src/agent/src/event_router.ts` — classification sets and fan-out;
  incoming events persist via `persistIncomingEvent` (throws if the insert
  fails), outgoing via `persistEvent` (returns `null` for audio appends).
- Tool-call extraction and the tool-output holds that interlock with the
  response queue are specified in [tool-dispatch](../realtime-agent-tool-dispatch/spec.md) and
  [turn-model](../realtime-agent-turn-model/spec.md); `agent_loop.ts` hosts both mechanisms.
- Tests: `tests/agent/realtime/client.test.ts`,
  `tests/agent/agent_loop/agent_loop.test.ts`,
  `tests/agent/agent_loop/session_api_and_turn_mode.test.ts`,
  `tests/agent/events/event_router.test.ts`, `tests/agent/exports.test.ts`.

## Interactions

- [turn-model](../realtime-agent-turn-model/spec.md) — `session.update` shape, response queue
  semantics for the `createResponse` family.
- [tool-dispatch](../realtime-agent-tool-dispatch/spec.md) — function-call extraction from routed
  events; tool outputs transmitted through the same outgoing path.
- [persistence](../realtime-agent-persistence/spec.md) — session rows and event write policy.
- [cli](../realtime-agent-cli/spec.md) and [vscode-extension](../realtime-agent-vscode-extension/spec.md) — the two
  consumers; they own their `AgentStartConfig` values.
- [freshness](../realtime-agent-freshness/spec.md) — produces structured-context messages.
