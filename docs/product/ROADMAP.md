# Roadmap

## Current Foundation

The repository supports three tracks:

- Sheaf server for local-first chat workflows.
- Obsidian replica tooling for vault/client workflows.
- Node TypeScript realtime-agent tooling for OpenAI Realtime experimentation.

The realtime-agent foundation is usable as both a CLI and a library. It starts WebSocket Realtime sessions, streams microphone input, requests text output only, dispatches model tool calls, prints non-audio events, and persists durable session/event records.

## Realtime Agent: Current Capabilities

- Library entry point: `apps/realtime-agent/src/index.ts`, published as `realtime-agent-lib`.
- CLI entry point: `apps/realtime-agent/src/cli.ts`, published as `realtime-agent`.
- Session model: prompt file, initial context file, model, tool call set, session config, lifecycle callbacks.
- Transport: WebSocket connection to the OpenAI Realtime API with bearer auth and optional `OpenAI-Safety-Identifier`.
- Audio input: local microphone device listing, device selection by id or name substring, 24 kHz mono PCM frame forwarding.
- Realtime config: text-only output, transcription, server VAD, 500 ms silence threshold, automatic response creation.
- Event handling: typed classification for known event families and generic handling for unknown Realtime event types.
- Persistence: SQLite sessions and events with idempotent migrations.
- Tooling: duplicate-name validation, serial FIFO callback execution, function-call output events, structured error payloads.
- Operator visibility: stdout JSON-lines output for non-audio events.
- Test support: fake microphone capture, fake WebSocket transport, dependency injection for CLI/session tests.

## Realtime Agent: Next Product Work

- Add a named tool-call-set registry so operators can choose reusable tool bundles by stable names.
- Add replay and inspection commands for persisted SQLite sessions.
- Add explicit retention controls for realtime session/event data.
- Add richer built-in tools beyond the current `echo` example.
- Add optional manual turn controls for commit/clear flows when server VAD is not desired.
- Clarify packaging behavior for the default SQLite path in installed versus local builds.
- Add manual smoke guidance for live Realtime API sessions and microphone device behavior.

## Sheaf Server: Ongoing Work

- Continue hardening queue recovery, websocket reconnect behavior, and turn-ledger invariants.
- Keep runtime configuration and prompt selection documented against current server config files.
- Preserve unit coverage around model dispatch, tool execution, vault repair, and replica workflows.

## Engineering Constraints

- Keep behavior documented in present tense and tied to code in the repository.
- Preserve clear boundaries between Sheaf server behavior, Obsidian replica behavior, and realtime-agent behavior.
- Prefer focused vertical changes with corresponding tests.
- Do not persist or print raw outgoing realtime audio append payloads.
- Treat unexpected realtime socket close as terminal for the current session.
