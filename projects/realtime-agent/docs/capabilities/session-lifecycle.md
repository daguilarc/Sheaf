# Capability: Session Lifecycle

ID prefix: `ses`

## Purpose

`startAgentSession(config, deps)` is the single entry point both the CLI and
the VS Code extension use to run an OpenAI Realtime session. This capability
specifies the connection and startup sequence, the `RealtimeAgentSession`
API a caller gets back, how every event is routed (persisted, classified,
fanned out to callbacks), the structured-context envelope, and how sessions
end — gracefully or on connection loss.

## Requirements

- **[ses-1]** WHEN `startAgentSession(config, deps)` is called with a valid
  tool call set and a database, THE library SHALL create a session row
  (see [persistence](persistence.md)), open a WebSocket to the Realtime API,
  and resolve to a `RealtimeAgentSession` whose `sessionId` equals the
  session row's UUID id.
- **[ses-2]** IF `deps.database` is `undefined`, THEN `startAgentSession`
  SHALL throw `Error("startAgentSession requires deps.database")` without
  connecting.
- **[ses-3]** IF `config.toolCallSet` contains two tools with the same
  `name`, THEN `startAgentSession` SHALL throw `DuplicateToolNameError`
  (message `Duplicate tool name in tool call set: <name>`) before creating a
  session row or connecting.
- **[ses-4]** THE library SHALL connect to
  `<baseUrl>?model=<urlencoded model>` where `baseUrl` defaults to
  `wss://api.openai.com/v1/realtime` (`DEFAULT_REALTIME_BASE_URL`); WHEN the
  base URL already contains `?`, the model parameter SHALL be appended with
  `&`. The model defaults to `DEFAULT_REALTIME_MODEL` = `gpt-realtime-2`
  when `config.model` is omitted.
- **[ses-5]** THE library SHALL send header
  `Authorization: Bearer <apiKey>` on the WebSocket connection, plus
  `OpenAI-Safety-Identifier: <value>` WHERE `deps.safetyIdentifier` is a
  non-empty string.
- **[ses-6]** WHEN the socket opens, THE library SHALL transmit, in order:
  (1) the `session.update` event built from the tool call set and resolved
  turn mode (shape: [turn-model](turn-model.md)); (2) a
  `conversation.item.create` with a `system`-role message whose single
  `input_text` part is `config.systemPrompt`; (3) a
  `conversation.item.create` with a `user`-role message whose single
  `input_text` part is `config.initialContext`; and (4) WHERE the resolved
  turn mode is `server_vad`, a bare `{"type": "response.create"}`. Manual
  mode sends no startup `response.create`.
- **[ses-7]** THE library SHALL route every incoming event and every
  transmitted outgoing event through the event router: persist it per the
  [persistence](persistence.md) write policy, classify it (see Contracts),
  and invoke `onEvent` and `onConversationEvent` with
  `(event, { sessionId, direction })`.
- **[ses-8]** WHERE `config.onConversationEvent` is not supplied, THE
  library SHALL log `[<sessionId>] <direction> <event.type>` to the console
  for every routed event except events classified `tool_call` and
  `input_audio_buffer.append` events.
- **[ses-9]** THE session's `sendAudioFrame(pcmBase64OrBuffer)` SHALL accept
  a base64 string or a `Buffer` (converted to base64) and transmit
  `{"type": "input_audio_buffer.append", "audio": <base64>}` immediately
  (never queued).
- **[ses-10]** THE session's `commitAudio()` SHALL transmit
  `{"type": "input_audio_buffer.commit"}` immediately — bypassing the
  response queue even while a response is active — and resolve to
  `{ status: "sent" }`. `clearAudioBuffer()` SHALL likewise transmit
  `{"type": "input_audio_buffer.clear"}` immediately.
- **[ses-11]** WHEN `sendTextMessage(text, options)` is called with
  non-empty text, THE session SHALL transmit a `user`-role
  `conversation.item.create` with one `input_text` part, including
  `previous_item_id` only when `options.previousItemId` is a non-empty
  string; IF `text` is empty, THEN it SHALL throw
  `TypeError("sendTextMessage requires non-empty text")`.
- **[ses-12]** WHERE `options.createResponse === true`,
  `sendTextMessage`/`sendStructuredContext` SHALL submit the conversation
  item and a `response.create` as one response-affecting unit on the
  response queue ([turn-model](turn-model.md)); otherwise the item is
  transmitted immediately and the call resolves `{ status: "sent" }`.
- **[ses-13]** WHEN `sendStructuredContext(message, options)` is called, THE
  session SHALL serialize the envelope (see Contracts) with
  `JSON.stringify` and send it as the text of a `user`-role `input_text`
  conversation item; the `summary` key SHALL be omitted entirely when
  `message.summary` is `undefined`.
- **[ses-14]** WHEN `sendRealtimeEvent(event, options)` is called, THE
  session SHALL require `event.type` to be a non-empty string (else
  `TypeError("sendRealtimeEvent requires event.type to be a non-empty string")`);
  `response.cancel` SHALL always transmit immediately; `response.create`
  SHALL go through the response queue with `options`; every other type SHALL
  transmit immediately and resolve `{ status: "sent" }`.
- **[ses-15]** WHEN `stop(reason)` is called, THE session SHALL close the
  socket, mark the session row ended with `ended_reason = <reason>` and an
  ISO-8601 `ended_at`, invoke `onSessionEnded({ sessionId, reason, session })`
  exactly once, and resolve to the final `SessionRow`. A second `stop`
  SHALL resolve to the already-ended row without re-ending or re-notifying.
- **[ses-16]** IF the WebSocket closes without a prior `stop()`, THEN THE
  session SHALL finalize itself with reason `connection_lost` (row ended,
  `onSessionEnded` invoked once).
- **[ses-17]** IF `RealtimeClient.connect()` is called while already
  connected or connecting, THEN it SHALL reject with
  `RealtimeTransportError("RealtimeClient is already connected or connecting")`;
  IF the socket errors or closes before opening, THEN `connect()` SHALL
  reject with a `RealtimeTransportError` (close case message:
  `WebSocket closed before connection opened (<code>: <reason>)`).
  `startAgentSession` propagates connect rejections after the session row
  has been created.
- **[ses-18]** IF `RealtimeClient.send` is called when the socket is absent
  or not open, or serialization/transmission throws, THEN the client SHALL
  NOT throw; it SHALL report a `RealtimeTransportError` to registered
  `onError` handlers (messages:
  `Cannot send event before connect() succeeds`,
  `Failed to serialize or send realtime event`).
- **[ses-19]** IF an incoming WebSocket message is not a JSON object or
  lacks a non-empty string `type`, THEN the client SHALL report a
  `RealtimeTransportError` to `onError` handlers and SHALL NOT invoke event
  handlers for it.
- **[ses-20]** THE package SHALL expose its public API from
  `realtime-agent-lib`'s root export exactly as enumerated in
  `src/agent/src/index.ts` (pinned by `tests/agent/exports.test.ts`):
  session control (`startAgentSession`, `DuplicateToolNameError`), config
  and paths ([config](config.md)), persistence ([persistence](persistence.md)),
  transport (`RealtimeClient`, `RealtimeTransportError`,
  `buildRealtimeConnectionUrl`, `buildRealtimeConnectionHeaders`,
  `DEFAULT_REALTIME_BASE_URL`), routing (`EventRouter`,
  `classifyIncomingEvent`, `classifyOutgoingEvent`), tooling
  ([tool-dispatch](tool-dispatch.md)), `buildSessionUpdateEvent`, audio
  capture ([audio-capture](audio-capture.md)), runtime logging
  ([config](config.md)), `DEFAULT_REALTIME_MODEL`, and the associated types.

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
semantics: [turn-model](turn-model.md).

### `AgentStartConfig` and `AgentSessionDeps`

| `AgentStartConfig` field | Meaning |
|---|---|
| `systemPrompt` (required) | Sent as the startup system message |
| `initialContext` (required) | Sent as the startup user message |
| `toolCallSet` (required) | `{ name?: string; tools: ToolDefinition[] }` |
| `model` | Default `gpt-realtime-2` |
| `turnMode` | Default server VAD; see [turn-model](turn-model.md) |
| `responseAfterToolOutput` | `true` ⇒ follow-up `response.create` after every tool output; see [tool-dispatch](tool-dispatch.md) |
| `onConversationEvent`, `onEvent` | Routed-event callbacks (`(event, {sessionId, direction})`) |
| `onToolLifecycle` | [tool-dispatch](tool-dispatch.md) phases |
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
kinds actually produced live in [freshness](freshness.md).

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
  errors are dropped silently (listed in [coverage](../coverage.md)).
- `src/agent/src/event_router.ts` — classification sets and fan-out;
  incoming events persist via `persistIncomingEvent` (throws if the insert
  fails), outgoing via `persistEvent` (returns `null` for audio appends).
- Tool-call extraction and the tool-output holds that interlock with the
  response queue are specified in [tool-dispatch](tool-dispatch.md) and
  [turn-model](turn-model.md); `agent_loop.ts` hosts both mechanisms.
- Tests: `tests/agent/realtime/client.test.ts`,
  `tests/agent/agent_loop/agent_loop.test.ts`,
  `tests/agent/agent_loop/session_api_and_turn_mode.test.ts`,
  `tests/agent/events/event_router.test.ts`, `tests/agent/exports.test.ts`.

## Interactions

- [turn-model](turn-model.md) — `session.update` shape, response queue
  semantics for the `createResponse` family.
- [tool-dispatch](tool-dispatch.md) — function-call extraction from routed
  events; tool outputs transmitted through the same outgoing path.
- [persistence](persistence.md) — session rows and event write policy.
- [cli](cli.md) and [vscode-extension](vscode-extension.md) — the two
  consumers; they own their `AgentStartConfig` values.
- [freshness](freshness.md) — produces structured-context messages.
