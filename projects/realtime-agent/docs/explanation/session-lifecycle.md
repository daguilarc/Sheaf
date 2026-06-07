# Session Lifecycle

This document describes how realtime sessions start, run, and end for both the
CLI and the VS Code extension.

## Startup

### CLI

1. Parse arguments (`ParseCliArgs`).
2. Load `config/realtime-agent.json` and `config/api_keys.json`.
3. Resolve prompt file, model, tools, and paths.
4. Open SQLite at `data/realtime-agent/realtime-agent.sqlite`.
5. Create a session row.
6. Open the Realtime WebSocket with bearer authentication.
7. Send `session.update` with text output, 24 kHz PCM input, transcription, server VAD, and registered tools.
8. Send the system prompt and initial context as startup conversation items.
9. Send `response.create` (server VAD mode).
10. Start microphone capture and forward frames as `input_audio_buffer.append`.

### VS Code extension

1. Resolve API key (Secret Storage → `config/api_keys.json` → setting).
2. Open SQLite at `<extension global storage>/realtime-agent.sqlite3`.
3. Start `realtime-agent-lib` with manual turn mode, the `sheaf VS Code` tool set, and `responseAfterToolOutput: true`.
4. Start microphone capture and forward 24 kHz mono PCM frames through `sendAudioFrame()`.
5. Attach chat event listeners and freshness listeners.

## Active session

While connected:

- Audio frames stream continuously.
- Incoming events route through the event router for persistence and callbacks.
- Tool calls dispatch asynchronously without blocking event routing.
- The CLI prints non-audio events to stdout.
- The extension updates chat bubbles and may send freshness context pushes.

Turn boundaries differ by consumer. See [Turn model](turn-model.md).

## Shutdown

### Normal shutdown

**CLI**: `SIGINT` / `SIGTERM` stop microphone capture, close the realtime session, mark the session ended, close the database, and exit.

**Extension**: toggling the session off stops microphone capture before stopping the realtime session and closing the database.

### Audio failures

If microphone setup or capture fails:

- The CLI stops the session with an audio-related reason and exits nonzero.
- The extension shows an error, records a chat error bubble, and shuts the session down.

### Unexpected connection close

If the WebSocket closes unexpectedly:

- The session is marked ended with reason `connection_lost`.
- The agent does not resume or rejoin dropped sessions.
- The extension resets to idle and records that the connection was lost.

## Related docs

- [Architecture](architecture.md)
- [Persistence](persistence.md)
- [Run the CLI](../how-to/run-cli.md)
- [Launch the VS Code extension](../how-to/launch-vscode-extension.md)
