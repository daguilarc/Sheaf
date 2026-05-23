# Real Time Agent Spec (Node + TypeScript)

## Goal

Build a Node application (written in TypeScript) that wraps a reusable TypeScript library implementing a realtime agent loop with:

- audio input
- text output only
- model tool-calling support
- durable event/session persistence in SQLite

The app is intended for experimentation and operator visibility through stdout event printing.

## Scope

### In scope

- TypeScript library for realtime agent session orchestration.
- Tool abstraction and callback execution.
- Session and event persistence to SQLite in `data/`.
- Node CLI app that accepts prompt/context files.
- Voice activity detection (VAD) turn handling with 500ms pause threshold.
- Transcription enabled.

### Out of scope

- Audio output playback.
- UI beyond CLI/stdout.
- Distributed/multi-process coordination.
- Tool-call set naming registry implementation beyond minimal scaffolding.

## High-level architecture

Two deliverables:

1. **Library (`realtime-agent-lib`)**
   - Realtime API adapter
   - Tool registration and dispatch
   - Event routing and callback hooks
   - SQLite persistence layer

2. **CLI app (`realtime-agent`)**
   - Loads prompt and initial context from files
   - Selects tool call set
   - Connects to microphone input on the local machine
   - Captures audio frames and sends them to the agent loop
   - Starts and runs session loop
   - Prints events to stdout (excluding audio buffer append events)

## Transport decision

Use **WebSocket** for this app.

Rationale:

- The app is a Node CLI (not a browser/mobile runtime).
- OpenAI Realtime docs explicitly position WebSocket as the server-to-server transport.
- We need low-level control over event send/receive and audio chunk handling.

Connection target:

- `wss://api.openai.com/v1/realtime?model=gpt-realtime-2`

Authentication:

- `Authorization: Bearer <OPENAI_API_KEY>`
- Optional `OpenAI-Safety-Identifier` header when an end-user identifier is available.

## Core domain model

### Tool

A tool is a struct-like object with:

- `name`: unique tool identifier
- `inputSchema`: JSON Schema describing arguments
- `callback`: async/sync function invoked when model requests tool call
- optional `description`

Suggested TypeScript shape:

```ts
export interface ToolDefinition<TArgs = unknown, TResult = unknown>
{
  name: string;
  description?: string;
  inputSchema: Record<string, unknown>;
  callback: (args: TArgs, ctx: ToolRuntimeContext) => Promise<TResult> | TResult;
}
```

### Tool call set

A tool call set is a list of tools.  
Future extension: named tool call sets to reference by name.

```ts
export interface ToolCallSet
{
  name?: string;
  tools: ToolDefinition[];
}
```

### Agent start contract

The agent loop starts with:

- tool call set
- system prompt
- initial context

And callback hooks for:

- model conversation turns (default: log)
- tool call lifecycle events

```ts
export interface AgentStartConfig
{
  systemPrompt: string;
  initialContext: string;
  toolCallSet: ToolCallSet;
  model: string; // default gpt-realtime-2
}
```

## Realtime behavior

### Session initialization

On startup:

1. Create session UUID.
2. Persist session row in DB.
3. Open realtime connection.
4. Send session configuration:
   - `session.type = "realtime"`
   - audio input enabled
   - text output enabled
   - audio output disabled
   - transcription enabled
   - input audio format: `audio/pcm`, 24kHz
   - VAD enabled via `session.audio.input.turn_detection.type = "server_vad"`
   - `session.audio.input.turn_detection.silence_duration_ms = 500`
   - `session.audio.input.turn_detection.create_response = true`
   - `session.audio.input.turn_detection.interrupt_response = true`
   - output_modalities: ["text"]
5. Register tools in session/tooling config.
6. Inject initial prompt/context as startup conversation input.

### Main loop

- Forward structured outgoing events to API.
- Handle incoming events from API.
- Dispatch tool calls to matching callback.
- Send tool results back as structured tool-output events.
- Trigger conversation callback for non-tool conversational output.
- Accept and forward/persist unknown event types without rejecting by whitelist.

Default conversation callback logs event summary to stdout.

### Supported event surface policy

The implementation must support sending and receiving **any valid Realtime event** (not a fixed allowlist).  
In practice, the first implementation will be built around known GA events listed below while preserving generic pass-through handling.

#### Planned outgoing events

- `session.update`
- `conversation.item.create`
- `response.create`
- `input_audio_buffer.append`
- `conversation.item.create` with `item.type = "function_call_output"` for tool results
- Optional/manual mode support:
  - `input_audio_buffer.commit`
  - `input_audio_buffer.clear`

#### Planned incoming events

- Session lifecycle:
  - `session.created`
  - `session.updated`
- Input audio / turn boundaries:
  - `input_audio_buffer.speech_started`
  - `input_audio_buffer.speech_stopped`
  - `input_audio_buffer.committed`
- Conversation and response lifecycle:
  - `conversation.item.added`
  - `conversation.item.done`
  - `response.created`
  - `response.output_item.created`
  - `response.content_part.added`
  - `response.output_text.delta`
  - `response.output_text.done`
  - `response.content_part.done`
  - `response.output_item.done`
  - `response.done`
  - `rate_limits.updated`
- Tool-call related:
  - `response.function_call_arguments.delta`
  - function-call payloads in `response.done` output items (`type = "function_call"`)
- Input transcription:
  - `conversation.item.input_audio_transcription.delta`
  - `conversation.item.input_audio_transcription.completed`
- Errors:
  - `error`

Notes:

- With audio output disabled, `response.output_audio.*` events are not expected in normal operation.
- Completion ordering across different transcription items is not guaranteed; correlate using `item_id`.

## Persistence requirements

Database path:

- `data/realtime-agent.sqlite`

### Persistence policy

- Persist **all incoming API events**, including transcription events.
- Persist **outgoing non-audio events**.
- Do **not** persist outgoing `input_audio_buffer.append` events.
- Audio chunks are ephemeral transport only.

### Schema

#### `sessions`

- `id TEXT PRIMARY KEY` (UUID)
- `created_at TEXT NOT NULL`
- `ended_at TEXT`
- `ended_reason TEXT`
- `system_prompt TEXT NOT NULL`
- `initial_context TEXT NOT NULL`
- `tool_call_set_name TEXT`
- `tool_names_json TEXT NOT NULL` (JSON array of names)
- `model TEXT NOT NULL`
- `session_config_json TEXT NOT NULL`

#### `events`

- `id INTEGER PRIMARY KEY AUTOINCREMENT`
- `session_id TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE`
- `created_at TEXT NOT NULL`
- `direction TEXT NOT NULL` (`incoming` or `outgoing`)
- `event_type TEXT NOT NULL`
- `event_json TEXT NOT NULL`
- `is_audio_buffer_append INTEGER NOT NULL DEFAULT 0`

### Indexes

- `events(session_id, created_at)`
- `events(event_type)`

## Event classification

### Incoming event classes

- session lifecycle events
- transcription delta/final events
- model text output delta/final events
- tool call requests
- errors/warnings

### Outgoing event classes

- session configuration updates
- conversation input events
- tool output events
- response trigger events
- audio buffer append (forwarded but not persisted and not printed)

## Tool call flow

1. Receive model tool-call event.
2. Parse tool name and JSON args.
3. Resolve tool from active set.
4. Enqueue tool call onto a per-session FIFO queue.
5. Execute callbacks from queue with default concurrency of 1.
6. While a tool callback runs, continue processing incoming realtime events.
7. Emit tool result event to API.
8. Persist incoming tool-call + outgoing tool-result events.
9. Emit callback notifications for observability.

If tool is missing or callback fails:

- return structured tool error payload to model
- persist failure event details
- continue session unless fatal transport failure occurs

First-pass scheduling policy:

- Tool calls are asynchronous.
- Default execution is queued (serial), not concurrent.
- Concurrency can become configurable later, but initial implementation uses queue-first behavior for predictability.

## Connection loss policy

If the realtime socket disconnects unexpectedly:

- Treat the in-flight realtime session as terminal.
- Persist session `ended_at` and `ended_reason = "connection_lost"`.
- Do not attempt protocol-level resume/rejoin.
- Operator may start a new session.

Rationale:

- Current API guidance documents session creation and event streaming but does not define a resumable reconnect flow for restoring a dropped realtime session.

## CLI requirements

The Node app wraps the library and supports:

- prompt file input
- initial context file input
- selecting tool set (initially by explicit list; later by name)
- optional model selection
- microphone capture and local device selection
- forwarding captured audio frames to the agent loop for API forwarding

Example UX:

```bash
realtime-agent \
  --prompt-file prompts/system-prompts/basic_realtime_conversation_v1.md \
  --context-file data/initial-context.md \
  --model gpt-realtime-2
```

### Stdout behavior

- Print structured event lines for non-audio events.
- Skip printing `input_audio_buffer.append`.
- Include session id and event type in each line.

## Library module boundaries

Suggested modules:

- `types.ts` (public contracts)
- `tooling.ts` (tool set and dispatch)
- `realtime_client.ts` (transport/protocol)
- `agent_loop.ts` (session orchestration)
- `event_router.ts` (classification and callbacks)
- `persistence/db.ts` (SQLite init/migrations)
- `persistence/sessions_repo.ts`
- `persistence/events_repo.ts`
- `stdout_logger.ts`

## Non-functional requirements

- Strong typing for event and tool contracts.
- Graceful shutdown and session finalization (`ended_at` update).
- Idempotent DB migrations at startup.
- Clear errors for malformed tool args and transport failures.
- Keep implementation minimal and easy to iterate.

## Acceptance criteria

1. App can start a realtime session with VAD and transcription enabled.
2. App accepts prompt/context files and injects them at start.
3. CLI captures microphone audio and streams frames to the agent loop.
4. Session metadata is persisted in `sessions`.
5. Incoming events are persisted in `events`.
6. Outgoing non-audio events are persisted in `events`.
7. Outgoing audio buffer append events are not persisted.
8. Tool calls from model invoke callbacks and return outputs.
9. CLI prints non-audio events to stdout and skips audio append events.

## Open follow-up items

- Named tool call set registry design (`tool_call_sets` table vs static config).
- Optional replay/debug command for persisted sessions.

Retention note:

- No deletion/retention policy is implemented in this phase.
- All persisted records are kept until an explicit retention policy is specified later.
