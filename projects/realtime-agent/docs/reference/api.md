# Library API Reference

Package name: `realtime-agent-lib`

Source entry: `src/agent/src/index.ts`

## Public exports

### Session control

- `startAgentSession(config, deps)` — create and start a `RealtimeAgentSession`.
- `DuplicateToolNameError` — thrown when a tool call set contains duplicate names.

### Configuration and repository paths

- `LoadRealtimeAgentConfig`, `LoadOpenAiApiKey`, `ConfigLoadError`
- `RealtimeAgentConfig`, `ResolvedRealtimeAgentConfig`
- `FindRepositoryRoot`, `GetDefaultRealtimeAgentPaths`, `ResolveRepositoryPath`, `RealtimeAgentPaths`

### Persistence

- `RealtimeAgentDb`, `resolveDatabasePath`, `runMigrations`, `DEFAULT_DATABASE_PATH`
- `SessionsRepo`, `EventsRepo`, `shouldPersistOutgoingEvent`

### Realtime transport

- `RealtimeClient`, `RealtimeTransportError`
- `buildRealtimeConnectionUrl`, `buildRealtimeConnectionHeaders`, `DEFAULT_REALTIME_BASE_URL`

### Event routing

- `EventRouter`, `classifyIncomingEvent`, `classifyOutgoingEvent`

### Tooling

- `ToolRegistry`, `ToolDispatcher`
- `buildFunctionCallOutputEvent`, `buildToolErrorPayload`
- `ExtractedToolCall`, `ToolDispatcherOptions`, `ToolDispatcherSendContext`, `ToolErrorCode`, `ToolErrorPayload`

### Session configuration

- `buildSessionUpdateEvent`

### Audio input

- `CreateMicrophoneCapture`, `CreateSoxMicrophoneCapture`, `REALTIME_PCM_SAMPLE_RATE`
- `MicrophoneCapture`, `MicrophoneCaptureOptions`

### Runtime logging

- `CreateRuntimeLogger`, `RuntimeLogger`, `RuntimeLoggerOptions`, `RuntimeLogEntry`

### Types and constants

- `DEFAULT_REALTIME_MODEL`
- Session types: `RealtimeAgentSession`, `AgentStartConfig`, `AgentSessionDeps`, `RealtimeAgentTurnMode`
- Event types: `RealtimeEvent`, `EventDirection`, `ConversationEventCallback`, `AgentEventCallback`, `ConversationEventInfo`
- Tool types: `ToolDefinition`, `ToolCallSet`, `ToolRuntimeContext`, `ToolLifecycleCallback`, `ToolLifecycleNotification`, `ToolLifecyclePhase`
- Queue types: `ResponseQueuePolicy`, `QueueRequestOptions`, `CreateResponseOptions`, `SendMessageOptions`, `QueuedEventResult`
- Persistence types: `SessionRow`, `EventRow`, `CreateSessionInput`, `PersistEventInput`, `DatabaseConfig`
- Classification types: `IncomingEventClass`, `OutgoingEventClass`, `ClassifiedIncomingEvent`, `ClassifiedOutgoingEvent`
- Structured context: `StructuredContextMessage`
- WebSocket injection: `RealtimeWebSocketLike`, `WebSocketFactory`, `WebSocketConnectOptions`, `RealtimeClientOptions`
- Callbacks: `SessionEndedCallback`, `EventRouterCallbacks`, `EventRouterOptions`

## Session start configuration

`AgentStartConfig` fields:

| Field | Description |
|---|---|
| `systemPrompt` | System instructions sent at startup. |
| `initialContext` | Initial user/context text sent at startup. |
| `toolCallSet` | Named tool set with `ToolDefinition[]`. |
| `model` | Optional model override. Default `gpt-realtime-2`. |
| `turnMode` | `server_vad` or `manual`. See [Turn model](../explanation/turn-model.md). |
| `responseAfterToolOutput` | When true, successful tool output and structured tool errors schedule follow-up `response.create`. |
| `onConversationEvent` | Callback for all routed conversation events. |
| `onEvent` | General agent event callback. |
| `onToolLifecycle` | Tool queue lifecycle notifications. |
| `onSessionEnded` | Called when the session ends. |

## Dependency injection seams

`AgentSessionDeps`:

| Field | Description |
|---|---|
| `apiKey` | Required OpenAI API key. |
| `safetyIdentifier` | Optional safety header value. |
| `baseUrl` | Optional Realtime API base URL override. |
| `database` | Optional `RealtimeAgentDb` instance. Callers must supply a database for production use. |
| `webSocketFactory` | Injectable WebSocket factory for tests or alternate runtimes. |

## Realtime event callback shape

Conversation and agent callbacks receive:

```ts
(event: RealtimeEvent, info: { sessionId: string; direction: "incoming" | "outgoing" }) => void
```

`RealtimeEvent` is `{ type: string; [key: string]: unknown }`.

## Manual turn APIs

`RealtimeAgentSession` methods:

| Method | Description |
|---|---|
| `sendAudioFrame(pcmBase64OrBuffer)` | Append 24 kHz mono PCM to the input buffer. |
| `commitAudio(options?)` | Send `input_audio_buffer.commit`. |
| `createResponse(options?)` | Send `response.create`. |
| `commitAudioAndCreateResponse(options?)` | Commit and create response as one queued unit. |
| `sendTextMessage(text, options?)` | Send a user text conversation item. |
| `sendStructuredContext(message, options?)` | Send structured JSON context as user `input_text`. |
| `sendRealtimeEvent(event, options?)` | Send a raw outgoing Realtime event. |
| `clearAudioBuffer(options?)` | Clear the input audio buffer. |
| `stop(reason)` | End the session and return the final `SessionRow`. |

`QueueRequestOptions` supports `queuePolicy`: `enqueue`, `reject`, or `cancel_current`.

## Tool registry and dispatch contracts

`ToolDefinition`:

- `name` — unique within the tool call set.
- `description` — optional model-facing description.
- `inputSchema` — JSON Schema object for arguments.
- `callback(args, ctx)` — async or sync handler; `ctx` includes `sessionId`, `toolCallId`, optional `metadata` and `log`.

`ToolDispatcher` processes tool calls through a per-session FIFO queue with
default concurrency of one. Structured tool errors use codes such as
`tool_not_found`, `invalid_arguments`, and `callback_failed`.

See [Tool dispatch](../explanation/tool-dispatch.md).

## Structured context envelope

`sendStructuredContext` serializes messages like:

```json
{
  "kind": "file_changed_since_last_read",
  "source": "vscode",
  "payload": { "file": "src/example.ts" },
  "summary": "src/example.ts changed since last read"
}
```

The `summary` field is included only when the caller provides one.
