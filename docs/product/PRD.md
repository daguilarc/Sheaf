# PRD: Sheaf

## Goal

Sheaf provides local-first chat workflows backed by durable SQLite state, websocket streaming, and agent tool execution. The realtime-agent path provides a Node/TypeScript experimentation tool for live OpenAI Realtime sessions with microphone input, text output, tool calls, and durable event inspection. The VS Code extension embeds that realtime-agent runtime in the editor and exposes VS Code-native read, navigation, and validated write tools for voice-driven coding.

## Product Surfaces

- Sheaf server: local API, websocket chat runtime, queue-backed worker, model/tool loop, and turn ledger.
- Obsidian replica: plugin client for chat and file-replica workflows.
- Realtime agent CLI: local microphone capture into the OpenAI Realtime API with stdout event visibility and SQLite persistence.
- Realtime agent library: reusable TypeScript contracts and orchestration primitives for embedding realtime sessions in other Node tools.
- VS Code extension: manual-turn voice coding workflow with Activity Bar chat, global session keybindings, editor context freshness notifications, and the `sheaf VS Code` tool call set.

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

## VS Code Extension User Flow

1. User opens a workspace in VS Code and starts an Extension Development Host for `apps/vscode-extension`.
2. User provides an OpenAI API key through Secret Storage, the `sheaf.realtime.openAiApiKey` setting, or `OPENAI_API_KEY`.
3. User presses `F16` or runs `Sheaf: Toggle Realtime Session` to start microphone capture and a manual-turn realtime session.
4. User speaks editor requests while audio streams into the active session.
5. User presses `F20` or runs `Sheaf: Commit Audio And Request Response` to commit buffered audio and request the model response.
6. The assistant uses the `sheaf VS Code` tools to read files, inspect visible editor context, move the cursor or viewport, search workspace files, and edit buffers with `modifyFile`.
7. The chat pane shows focused user, assistant, tool, context, and error bubbles while suppressing raw protocol noise.

## VS Code Extension Requirements

- VS Code 1.85 or newer.
- Node/Electron-compatible native dependencies for `better-sqlite3` and `naudiodon`.
- Local microphone permission for the VS Code process.
- An open workspace for workspace-scoped tools.
- OpenAI Realtime API access through the same key sources used by the realtime-agent library.

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

## Current VS Code Extension Capabilities

- Manual turn boundaries: the model responds only after an explicit commit-and-respond command.
- Default model `gpt-realtime-2`, configurable through `sheaf.realtime.model`.
- Built-in prompt for the `sheaf VS Code` tool set when `sheaf.realtime.systemPrompt` is empty.
- Activity Bar container `Sheaf`, webview `Realtime Chat`, status bar session control, and global `F16`/`F20` keybindings.
- Tool set name `sheaf VS Code` with stable tool names: `code_read`, `list_files`, `rgrep`, `read_visible_range`, `set_cursor_position`, `move_visible_range`, and `modifyFile`.
- Tool paths resolve inside open workspace folders and return normalized workspace-relative POSIX paths.
- Read and navigation tools operate through VS Code editor/workspace APIs so results reflect editor buffers and active viewport state.
- `modifyFile` applies edits through the VS Code text document API after exact target-text and surrounding-context validation.
- User, formatter, language-server, git, and other non-agent editor changes can trigger structured freshness notifications for previously observed files, cursor state, or viewport state.
- Agent-caused navigation and `modifyFile` mutations are suppressed from freshness notifications so the model is not warned about its own tool effects.

## Non-Goals

- Audio output playback.
- Browser or desktop UI for realtime sessions.
- Distributed or multi-process session coordination.
- Protocol-level session resume after connection loss.
- Retention or deletion policy for persisted realtime records.
- A full named tool-set registry beyond the current CLI-selected tool list.
- Direct shell, filesystem, or external patch writes from the VS Code tool set; editor writes go through VS Code buffer APIs.

## Success Criteria

- Sheaf server tests validate ledger, queue, websocket, model, vault, and tool behavior.
- Realtime sessions can be started from prompt/context files.
- Microphone audio is streamed as realtime input frames.
- Tool calls are observable, serial, and error-tolerant.
- Operators can inspect non-audio realtime behavior through stdout and SQLite.
- VS Code users can run a manual-turn voice session, inspect conversation/tool activity in the chat pane, and edit workspace buffers through validated `modifyFile` calls.
