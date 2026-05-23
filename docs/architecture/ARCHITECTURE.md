# Architecture

## System Surfaces

This repository contains three active execution surfaces:

- Sheaf server:
  - FastAPI API and websocket transport in `src/sheaf/server`.
  - SQLite ledgers for chat turns, queues, request logs, vault state, and events.
  - Agent tool dispatch for filesystem and SQLite operations.
- Obsidian replica:
  - TypeScript plugin in `apps/obsidian-replica`.
  - Chat UI, replica synchronization, replay queue, and edit-protection flows.
- Realtime agent:
  - Node 20 TypeScript library and CLI in `apps/realtime-agent`.
  - Package name `realtime-agent-lib`.
  - CLI binary name `realtime-agent`.

The Sheaf server remains the primary local-first chat runtime. The realtime agent is a separate experimentation surface for OpenAI Realtime sessions with microphone input, text output, tool calls, stdout observability, and SQLite persistence.

## Sheaf Server Flow

1. A client creates or enters a thread.
2. The websocket connection receives a durable ledger snapshot.
3. User messages are committed to SQLite and queued for execution.
4. The worker claims runnable queue rows, invokes the model/tool loop, and streams tokens/events back to clients.
5. Finalized turns are persisted so reconnecting clients can rebuild state from the ledger.

## Realtime Agent Flow

1. The CLI reads a system prompt file and an initial context file.
2. The library creates a session row in SQLite and opens a WebSocket to the OpenAI Realtime API.
3. Startup events configure a text-only realtime session, inject the system prompt and initial context, and trigger an initial response.
4. The CLI captures 24 kHz, 16-bit, mono microphone frames and forwards them as `input_audio_buffer.append` events.
5. The event router persists incoming API events and outgoing non-audio events, classifies known event families, and forwards unknown event types without rejecting them.
6. Tool-call events are accumulated, dispatched through a FIFO queue, and returned to the model as `function_call_output` conversation items.
7. Non-audio events are printed to stdout as structured JSON lines for operator visibility.

## Realtime Agent Components

- `types.ts`: public contracts for events, sessions, tool definitions, callbacks, repositories, and WebSocket injection.
- `realtime_client.ts`: WebSocket transport, connection URL/header construction, JSON event parsing, and transport errors.
- `session_config.ts`: Realtime session configuration for text output, input audio transcription, and server VAD.
- `agent_loop.ts`: session orchestration, startup event sequence, audio forwarding, tool-call extraction, and session finalization.
- `event_router.ts`: incoming/outgoing event classification, persistence routing, and callback fan-out.
- `tooling.ts`: tool registry, duplicate-name validation, serial tool dispatch, lifecycle callbacks, and structured tool errors.
- `audio_input.ts`: local microphone device listing, device resolution, frame chunking, and fake capture support for tests.
- `persistence/*`: SQLite migrations plus session and event repositories.
- `stdout_logger.ts`: JSON-lines event printing with audio append filtering.
- `tool_sets.ts`: CLI-selected tool registry; currently includes the `echo` tool.

## Persistence

The Sheaf server stores chat and vault runtime state under `data/`.

The realtime agent stores durable session metadata and events in SQLite. The default database path is computed by the built package and ends in `apps/realtime-agent/data/realtime-agent.sqlite`.

## Failure Policy

Sheaf queue failures are retried for non-fatal errors and moved to error tables for fatal failures.

An unexpected Realtime WebSocket close marks the active realtime session ended with reason `connection_lost`. The implementation does not attempt protocol-level resume; operators start a new session.
