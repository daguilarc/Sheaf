# Architecture

Scope: cross-capability design of the realtime-agent project. Normative
behavior lives in the capability files under
[capabilities/](README.md#capability-map); this page is prose.

## Surfaces

One project, three execution surfaces:

| Surface | Package | Role |
|---|---|---|
| Library | `realtime-agent-lib` (`src/agent/`) | OpenAI Realtime WebSocket sessions: startup, turn handling, tool dispatch, SQLite persistence, microphone capture, config/paths, JSONL logging |
| CLI | `realtime-agent` bin published by `realtime-agent-lib` | Unattended microphone session with server VAD, text output, JSON event lines on stdout |
| VS Code extension | `sheaf-vscode-extension` (`src/vscode-extension/`) | Editor voice workflow: manual turns, VS Code-native tools, chat webview, freshness pushes |

The extension is built on `realtime-agent-lib` through the project-local npm
workspace; there is exactly one Realtime client/session implementation.
Neither surface is registered as a long-running service in
`config/services.json` (see [Services](../../../structure/services.md)) —
both are interactive processes started by a human.

## Package Layout

```text
projects/realtime-agent/
  Makefile               # install/build/test/clean/run-cli entry point
  package.json           # npm workspace root (src/agent, src/vscode-extension)
  prompts/system-prompts/basic_realtime_conversation_v1.md
  src/
    agent/               # realtime-agent-lib; tsc → src/agent/dist/
    vscode-extension/    # sheaf-vscode-extension; esbuild → out/
  tests/
    agent/               # node:test suites for the library and CLI
    vscode-extension/    # node:test suites for extension-host logic
  docs/                  # this living spec
```

Both packages compile the shared `tests/` tree: the agent package's tsconfig
includes `../../tests/agent/**`, the extension's test tsconfig includes
`../../tests/vscode-extension/**` (compiled to `.test-dist/`). Extension
tests exercise deterministic logic against fakes (`tests/vscode-extension/helpers/`)
without launching a VS Code UI process.

Native dependencies (`better-sqlite3` for SQLite, `naudiodon` for PortAudio
capture) are declared in both packages and loaded lazily via
`createRequire`, so the CLI runs under system Node while the extension can
rebuild them against VS Code's Electron ABI
(procedures: [Operations](operations.md#rebuild-native-modules)). The
extension bundle marks `vscode`, `better-sqlite3`, and `naudiodon` external.

## Session Data Flow

1. A consumer (CLI or extension) assembles an `AgentStartConfig` — system
   prompt, initial context, tool call set, model, turn mode, callbacks — and
   `AgentSessionDeps` — API key, database, optional base URL / safety
   identifier / WebSocket factory.
2. [session-lifecycle](capabilities/session-lifecycle.md) creates a session
   row in SQLite, opens the WebSocket, and transmits the startup sequence:
   `session.update` (shape owned by
   [turn-model](capabilities/turn-model.md)), the system prompt and initial
   context as conversation items, and — in server-VAD mode only — an initial
   `response.create`.
3. Microphone frames from [audio-capture](capabilities/audio-capture.md)
   stream out as `input_audio_buffer.append` events.
4. Every event in both directions passes through the event router: persisted
   by [persistence](capabilities/persistence.md) (audio appends excluded
   outgoing), classified, and fanned out to consumer callbacks.
5. Model function calls are extracted (streaming deltas or `response.done`
   output) and run through [tool-dispatch](capabilities/tool-dispatch.md)'s
   per-session FIFO queue; outputs return as `function_call_output` items.
6. Response-affecting operations (`response.create`, commit+create units,
   tool follow-ups) serialize through the response queue in
   [turn-model](capabilities/turn-model.md) so they never interleave with an
   active model response or a pending tool output.
7. The CLI prints non-audio events as JSON lines; the extension reduces the
   same stream into chat bubbles and adds
   [freshness](capabilities/freshness.md) context pushes.

## Key Decisions

- **Manual turns in the editor, server VAD in the CLI.** The CLI infers turn
  boundaries from 500 ms of silence; the extension streams audio
  continuously and only commits + requests a response on an explicit user
  action (F20). This keeps editor sessions cheap and intentional.
- **Text-only output.** `session.update` requests `output_modalities:
  ["text"]` in all modes; there is no audio playback path.
- **The response queue is the concurrency backbone.** Anything that could
  start a model response is funneled through one FIFO with explicit
  policies, and the queue additionally holds external units while a tool
  output the model is waiting for has not yet been transmitted.
- **Extension database lives in VS Code global storage.** Session SQLite
  state is editor-host state scoped by extension identity
  (`<globalStorage>/realtime-agent.sqlite3`); repository
  `data/realtime-agent/` stays reserved for the CLI. Config and JSONL logs
  still use repository paths when the workspace is a Sheaf checkout.
- **No reconnection.** An unexpected WebSocket close finalizes the session
  with reason `connection_lost`; both surfaces surface the error and require
  the operator to start a new session.
- **Tools return structured errors instead of throwing.** Editor tools
  return `ToolError` objects with stable codes; a thrown error would be
  flattened into a generic `callback_failed` payload by the dispatcher.
- **Freshness suppresses self-inflicted noise.** Editor mutations caused by
  the agent's own tools run inside a mutation guard so the model is only
  told about user-driven changes to state it has observed.

## Module Index

Library (`src/agent/src/`): `types.ts` (public contracts),
`realtime_client.ts` (transport), `session_config.ts` (`session.update`),
`agent_loop.ts` (orchestration), `event_router.ts` (classify/persist/fan-out),
`response_queue.ts`, `tooling.ts` (registry + dispatcher), `tool_sets.ts`
(CLI `echo` tool), `audio_input.ts`, `persistence/` (db, sessions, events),
`config.ts` / `repo_paths.ts` / `runtime_log.ts`, `stdout_logger.ts`,
`cli.ts`, `index.ts` (export surface).

Extension (`src/vscode-extension/src/`): `extension.ts` (activation wiring),
`sessionController.ts` (state machine), `sessionWiring.ts` / `sessionTypes.ts`
(host/secrets/prefs/UI seams), `commands.ts`, `statusBar.ts`, `config.ts` /
`configCore.ts` / `repoConfig.ts` (settings + key resolution), `prompts.ts`
(baseline system prompt), `log.ts`, `chat/` (model, summaries, webview
provider, browser bundle), `tools/` (seven tools + path policy + editor
access), `freshness/` (service, coordinator, context builders, host seam).
