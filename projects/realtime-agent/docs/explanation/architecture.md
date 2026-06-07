# Architecture

## System surfaces

Realtime Agent contains two execution surfaces in one project:

| Surface | Package | Role |
|---|---|---|
| Library and CLI | `realtime-agent-lib` / `realtime-agent` | OpenAI Realtime sessions with microphone input, tool calls, persistence, and structured stdout logging. |
| VS Code extension | `sheaf-vscode-extension` | Editor-facing voice workflow with manual turns, VS Code-native tools, chat pane, and freshness pushes. |

The VS Code extension is built on `realtime-agent-lib`. It reuses the shared
Realtime WebSocket and session implementation instead of maintaining a second
client stack in the extension host.

Neither surface is registered as a long-running Sheaf service in
`config/services.json`.

## Project layout

```text
projects/realtime-agent/
  README.md
  Makefile
  package.json
  prompts/
  src/
    agent/           # realtime-agent-lib and CLI
    vscode-extension/  # sheaf-vscode-extension
  tests/
  docs/
```

Shared repository paths used at runtime:

- `config/realtime-agent.json` — project config
- `config/api_keys.json` — OpenAI API key
- `data/realtime-agent/` — CLI SQLite data
- `logs/realtime-agent/` — structured JSONL runtime logs

## Realtime agent flow

1. The CLI or extension supplies a system prompt, initial context, tool call set, and turn mode.
2. The library creates a session row in SQLite and opens a WebSocket to the OpenAI Realtime API.
3. Startup sends `session.update` for text output, 24 kHz PCM input, transcription, and the chosen turn detection mode.
4. The library injects the system prompt and initial context, then either sends an initial `response.create` (server VAD) or waits for manual commit (extension).
5. Microphone frames stream as `input_audio_buffer.append` events.
6. The event router persists events, classifies known families, and fans out callbacks.
7. Tool calls dispatch through a FIFO queue and return `function_call_output` items to the model.
8. The CLI prints non-audio events to stdout; the extension reduces events into chat bubbles.

## Agent components

| Module | Responsibility |
|---|---|
| `types.ts` | Public contracts for events, sessions, tools, and injection seams. |
| `realtime_client.ts` | WebSocket transport, URL/header construction, parsing, transport errors. |
| `session_config.ts` | `session.update` payload for text output, transcription, server VAD, manual mode. |
| `agent_loop.ts` | Session orchestration, startup sequence, audio forwarding, manual APIs, tool extraction, finalization. |
| `event_router.ts` | Event classification, persistence routing, callback fan-out. |
| `tooling.ts` | Tool registry, dispatch queue, structured errors, follow-up responses. |
| `response_queue.ts` | Queue policies for response-affecting operations. |
| `audio_input.ts` | Microphone listing, device resolution, frame capture. |
| `persistence/*` | SQLite migrations, session and event repositories. |
| `stdout_logger.ts` | JSON-lines stdout with audio append filtering. |
| `tool_sets.ts` | CLI tool registry (`echo`). |
| `config.ts`, `repo_paths.ts`, `runtime_log.ts` | Repository config, path resolution, JSONL logging. |
| `cli.ts` | `ParseCliArgs`, `RunCli`, `StartCliRuntime`. |

## VS Code extension components

| Module | Responsibility |
|---|---|
| `extension.ts` | Activation wiring for session controller, chat, status bar, tools, freshness. |
| `sessionController.ts` | Lifecycle, microphone, API key validation, manual commit/respond. |
| `chat/*` | Bubble model, summaries, `sheaf.chatView` webview. |
| `tools/*` | VS Code-native read, navigation, and `modifyFile` tools. |
| `freshness/*` | Stale-state tracking and agent-mutation suppression. |
| `statusBar.ts`, `commands.ts` | Global commands and status bar UX. |
| `config.ts`, `repoConfig.ts` | API key resolution and repository path integration. |

## Failure policy

An unexpected Realtime WebSocket close marks the active session ended with reason
`connection_lost`. Neither the CLI nor the extension attempts protocol-level
resume. Operators start a new session.

## Related docs

- [Session lifecycle](session-lifecycle.md)
- [Turn model](turn-model.md)
- [Library API reference](../reference/api.md)
- [VS Code extension reference](../reference/vscode-extension.md)
