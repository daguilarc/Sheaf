# PRD: Sheaf

## Goal

Sheaf provides local-first chat workflows backed by durable SQLite state, websocket streaming, and agent tool execution. The realtime-agent path adds a Node/TypeScript experimentation tool for live OpenAI Realtime sessions with microphone input, text output, tool calls, and durable event inspection.

## Product Surfaces

- Sheaf server: local API, websocket chat runtime, queue-backed worker, model/tool loop, and turn ledger.
- Obsidian replica: plugin client for chat and file-replica workflows.
- Realtime agent CLI: local microphone capture into the OpenAI Realtime API with stdout event visibility and SQLite persistence.
- Realtime agent library: reusable TypeScript contracts and orchestration primitives for embedding realtime sessions in other Node tools.

## Realtime Agent User Flow

1. Operator prepares a system prompt file and an initial context file.
2. Operator exports `OPENAI_API_KEY`.
3. Operator optionally lists microphone devices with `realtime-agent --list-input-devices`.
4. Operator starts `realtime-agent` with prompt/context paths, optional model, optional input device, optional safety identifier, and optional tools.
5. The app opens a realtime WebSocket session, configures transcription and VAD, and streams microphone frames.
6. The model responds with text-only output events.
7. Non-audio events are printed to stdout as JSON lines and stored in SQLite for later inspection.
8. Model tool calls execute registered callbacks and return structured function-call outputs.

## Realtime Agent Requirements

- Node 20 or newer.
- `OPENAI_API_KEY` for Realtime API access.
- Local microphone access when running live capture.
- Prompt and context files supplied with `--prompt-file` and `--context-file`.
- WebSocket transport to `wss://api.openai.com/v1/realtime` with a model query parameter.

## Current Realtime Agent Capabilities

- Default model `gpt-realtime-2`.
- Text output only.
- Input audio transcription enabled.
- Server VAD with a 500 ms silence threshold.
- 24 kHz PCM microphone frame forwarding.
- Structured stdout logging for every non-audio event.
- SQLite persistence for sessions, incoming events, and outgoing non-audio events.
- Generic event pass-through for unknown Realtime event types.
- Serial FIFO tool callback execution.
- Structured tool errors for unknown tools, invalid JSON arguments, and callback failures.
- Graceful session finalization on shutdown and `connection_lost` finalization on unexpected socket close.

## Non-Goals

- Audio output playback.
- Browser or desktop UI for realtime sessions.
- Distributed or multi-process session coordination.
- Protocol-level session resume after connection loss.
- Retention or deletion policy for persisted realtime records.
- A full named tool-set registry beyond the current CLI-selected tool list.

## Success Criteria

- Sheaf server tests validate ledger, queue, websocket, model, vault, and tool behavior.
- Realtime sessions can be started from prompt/context files.
- Microphone audio is streamed as realtime input frames.
- Tool calls are observable, serial, and error-tolerant.
- Operators can inspect non-audio realtime behavior through stdout and SQLite.
