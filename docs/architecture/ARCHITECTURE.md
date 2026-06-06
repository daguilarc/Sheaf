# Architecture

## System Surfaces

This repository now contains two active execution surfaces:

- Realtime agent:
  - Node 20 TypeScript library and CLI in `apps/realtime-agent`.
  - Package name `realtime-agent-lib`.
  - CLI binary name `realtime-agent`.
- VS Code extension:
  - TypeScript extension in `apps/vscode-extension`.
  - Manual-turn voice session controller, VS Code-native `sheaf VS Code` tools, chat pane, status bar controls, and context freshness pushes.

The VS Code extension is the editor-facing voice workflow built on top of the realtime agent library. It reuses the shared Realtime websocket/session implementation instead of maintaining a second client stack inside the extension host.

## Realtime Agent Flow

1. The CLI reads a system prompt file and an initial context file.
2. The library creates a session row in SQLite and opens a WebSocket to the OpenAI Realtime API.
3. Startup events configure a text-only realtime session, inject the system prompt and initial context, and trigger an initial response when server VAD turn detection is enabled.
4. The CLI captures 24 kHz, 16-bit, mono microphone frames and forwards them as `input_audio_buffer.append` events.
5. The event router persists incoming API events and outgoing non-audio events, classifies known event families, and forwards unknown Realtime event types without rejecting them.
6. Tool-call events are accumulated, dispatched through a FIFO queue, and returned to the model as `function_call_output` conversation items.
7. Non-audio events are printed to stdout as structured JSON lines for operator visibility.

## VS Code Extension Flow

1. Activation constructs the session controller, chat model, freshness coordinator, status bar item, webview chat provider, and VS Code tool call set.
2. `F16`, the status bar item, or the `Sheaf: Toggle Realtime Session` command starts a realtime-agent session in manual turn mode.
3. The extension host opens microphone capture, streams 24 kHz PCM frames through `sendAudioFrame()`, and stores session data in a per-extension SQLite database under the extension global storage directory.
4. `F20`, the chat pane button, or the `Sheaf: Commit Audio And Request Response` command calls `commitAudioAndCreateResponse()` on the active session.
5. The shared realtime-agent library handles WebSocket traffic, response queueing, tool dispatch, persistence, and tool-follow-up `response.create` scheduling.
6. Incoming transcription, assistant text, tool lifecycle, and error events are reduced into a focused chat-bubble model for the `sheaf.chatView` webview.
7. VS Code document, editor, viewport, and selection changes feed the freshness service, which sends structured context messages when previously observed file, viewport, or cursor state becomes stale.

## Realtime Agent Components

- `types.ts`: public contracts for events, sessions, tool definitions, callbacks, repositories, and WebSocket injection.
- `realtime_client.ts`: WebSocket transport, connection URL/header construction, JSON event parsing, and transport errors.
- `session_config.ts`: Realtime session configuration for text output, input audio transcription, server VAD, and manual turn mode.
- `agent_loop.ts`: session orchestration, startup event sequence, audio forwarding, manual-turn session APIs, structured context emission, response queue integration, tool-call extraction, and session finalization.
- `event_router.ts`: incoming/outgoing event classification, persistence routing, and callback fan-out.
- `tooling.ts`: tool registry, duplicate-name validation, serial tool dispatch, lifecycle callbacks, structured tool errors, and optional follow-up response scheduling after tool output.
- `response_queue.ts`: queue policy handling for response-affecting events such as audio commits, explicit response requests, and tool-triggered follow-up responses.
- `audio_input.ts`: local microphone device listing, device resolution, frame chunking, and fake capture support for tests.
- `persistence/*`: SQLite migrations plus session and event repositories.
- `stdout_logger.ts`: JSON-lines event printing with audio append filtering.
- `tool_sets.ts`: CLI-selected tool registry; currently includes the `echo` tool.

## VS Code Extension Components

- `extension.ts`: activation wiring for the session controller, chat pane, status bar, tool set, and freshness coordinator.
- `sessionController.ts`: session lifecycle, microphone startup/shutdown, API key validation, realtime-agent startup, error handling, and manual commit/respond behavior.
- `chat/*`: bubble model, tool/context summaries, and the `sheaf.chatView` Activity Bar webview.
- `tools/*`: VS Code-native read, navigation, and `modifyFile` tools backed by editor and workspace APIs rather than direct shell or filesystem access.
- `freshness/*`: change tracking for file reads, viewport observations, cursor observations, and suppression of agent-caused mutation notifications.
- `statusBar.ts` and `commands.ts`: global VS Code command surface and stateful status bar UX.

## Persistence

The realtime agent CLI stores durable session metadata and events in SQLite. The default database path is computed by the built package and ends in `apps/realtime-agent/data/realtime-agent.sqlite`.

The VS Code extension stores realtime-agent session data in its extension global storage directory as `realtime-agent.sqlite3`.

## Failure Policy

An unexpected Realtime WebSocket close marks the active realtime session ended with reason `connection_lost`. Neither the CLI nor the VS Code extension attempts protocol-level resume; operators start a new session.
