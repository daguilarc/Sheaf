# Test Strategy

## Objectives

- Preserve Sheaf server ledger, queue, websocket, model, vault, and tool behavior.
- Preserve realtime-agent public TypeScript contracts and session orchestration behavior.
- Validate persistence, event routing, tool dispatch, and transport error handling.
- Keep live-device behavior covered by manual smoke checks where automation cannot reliably exercise local permissions or hardware.

## Automated Test Layers

- Python unit tests: server runtime, migrations, queue behavior, model/tool dispatch, vault state, and API behavior.
- Obsidian replica TypeScript tests: chat API, service behavior, rendering, transport, replay, and sync behavior.
- Realtime TypeScript unit tests: session config, event classification, stdout filtering, tool registry/dispatch, and audio frame processing.
- Realtime persistence tests: SQLite migration idempotency, expected schema, session rows, event rows, indexes, and audio append persistence filtering.
- Realtime transport tests: WebSocket URL/header construction, JSON send/receive, invalid message handling, close handling, and fake socket integration.
- Realtime CLI tests: argument parsing, required prompt/context files, required `OPENAI_API_KEY`, unknown tool handling, signal-style shutdown, and dependency-injected runtime startup.

## Commands

From the repository root:

```bash
make test-server
make test-realtime-agent
```

From the realtime-agent package:

```bash
cd apps/realtime-agent
npm install
npm test
```

`npm test` builds the TypeScript package before running Node's built-in test runner against the compiled `dist/test` files.

## Minimum Checks Before Merging

- `PYTHONPATH=src .venv/bin/python -m pytest -q` for Sheaf server changes.
- `npm test` in `apps/realtime-agent` for realtime-agent changes.
- Obsidian replica tests for plugin/client changes.
- Relevant combinations for shared documentation or repository-level workflow changes.

## Manual Checks

- Realtime CLI microphone device listing with `realtime-agent --list-input-devices`.
- Live realtime session startup with a real `OPENAI_API_KEY`, prompt file, context file, and selected microphone.
- Confirmation that stdout omits `input_audio_buffer.append` while still showing session, transcription, text output, tool, and error events.
- Confirmation that SQLite contains session metadata, incoming events, and outgoing non-audio events after a live run.
