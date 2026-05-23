# Realtime Agent Operations

## Purpose

The realtime agent is a Node 20 TypeScript library and CLI for experimenting with OpenAI Realtime sessions. It takes local microphone input, requests text output only, supports model tool calls, prints non-audio events to stdout, and stores durable session/event records in SQLite.

## Build

From the repository root:

```bash
make build-realtime-agent
```

From the package directory:

```bash
cd apps/realtime-agent
npm install
npm run build
```

## Run

The CLI requires `OPENAI_API_KEY`, a system prompt file, and an initial context file.

```bash
export OPENAI_API_KEY="your-key"
realtime-agent \
  --prompt-file prompts/system-prompts/basic_realtime_conversation_v1.md \
  --context-file data/initial-context.md \
  --model gpt-realtime-2
```

When running the built CLI directly from the package directory:

```bash
cd apps/realtime-agent
node dist/src/cli.js \
  --prompt-file ../../prompts/system-prompts/basic_realtime_conversation_v1.md \
  --context-file ../../data/initial-context.md
```

## CLI Options

- `--prompt-file <path>`: required system prompt file.
- `--context-file <path>`: required initial context file.
- `--model <model>`: optional model, default `gpt-realtime-2`.
- `--tool <name>`: optional repeatable tool selector; comma-separated names are accepted.
- `--input-device <id-or-name>`: optional microphone selector.
- `--list-input-devices`: print microphone input devices and exit.
- `--safety-identifier <id>`: optional value for the `OpenAI-Safety-Identifier` header.

The current built-in CLI tool registry contains `echo`.

## Microphone Selection

List available input devices:

```bash
realtime-agent --list-input-devices
```

Select a device by numeric id:

```bash
realtime-agent \
  --prompt-file prompts/system-prompts/basic_realtime_conversation_v1.md \
  --context-file data/initial-context.md \
  --input-device 2
```

Select a device by a unique case-insensitive name substring:

```bash
realtime-agent \
  --prompt-file prompts/system-prompts/basic_realtime_conversation_v1.md \
  --context-file data/initial-context.md \
  --input-device "Studio"
```

If no device is supplied, the PortAudio default input device is used. If the selector matches no devices or multiple devices, startup fails with an explicit error.

## Runtime Behavior

On startup the agent:

1. Creates a session row in SQLite.
2. Opens a WebSocket Realtime connection using bearer authentication.
3. Sends `session.update` with text output, 24 kHz PCM input, transcription, server VAD, and registered tools.
4. Sends the system prompt and initial context as startup conversation items.
5. Sends `response.create`.
6. Starts local microphone capture and forwards frames as `input_audio_buffer.append`.

The session configuration uses server VAD with a 500 ms silence threshold and automatic response creation. Audio output is not configured.

## Stdout

The CLI prints one JSON object per non-audio event:

```json
{"session_id":"...","direction":"incoming","event_type":"response.output_text.delta","event":{}}
```

Outgoing `input_audio_buffer.append` events are intentionally omitted from stdout because they are frequent and contain audio payloads.

## Persistence

SQLite migrations run when the database opens. The default database path is computed relative to the built package and ends in `data/realtime-agent.sqlite`.

Tables:

- `sessions`: one row per realtime session with prompt/context text, tool metadata, model, and session config JSON.
- `events`: incoming events and outgoing non-audio events ordered by timestamp and id.

Persistence policy:

- Incoming API events are always stored.
- Outgoing non-audio events are stored.
- Outgoing `input_audio_buffer.append` events are not stored.
- No retention or deletion policy is implemented.

## Tool Calls

Tools are TypeScript definitions with a unique name, optional description, JSON Schema parameters, and a callback. The agent rejects duplicate tool names before connecting.

Tool calls are processed asynchronously through a per-session FIFO queue with default concurrency of one. While a callback is running, incoming realtime events continue to route and persist.

Tool failures are returned to the model as structured output payloads:

- `tool_not_found`
- `invalid_arguments`
- `callback_failed`

These failures do not end the session.

## Shutdown And Failures

`SIGINT` and `SIGTERM` stop microphone capture, close the realtime session, mark the session ended, and close the database.

If the WebSocket closes unexpectedly, the session is marked ended with reason `connection_lost`. The agent does not resume or rejoin dropped realtime sessions.

If microphone setup or capture fails, the CLI stops the session with an audio-related reason and exits nonzero.

## Library Use

Consumers import public contracts from `realtime-agent-lib`:

```ts
import {
  DEFAULT_REALTIME_MODEL,
  RealtimeAgentDb,
  startAgentSession,
  type AgentStartConfig,
  type ToolDefinition,
} from "realtime-agent-lib";
```

`startAgentSession` requires an explicit database dependency and accepts injectable WebSocket and callback dependencies for tests or alternate runtimes.
