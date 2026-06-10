# Capability: VS Code Extension

ID prefix: `vsx`

## Purpose

`sheaf-vscode-extension` (display name **Sheaf**) provides a voice-driven
editor workflow on top of `realtime-agent-lib`: manual-turn sessions toggled
from a status-bar item or `F16`, audio committed with `F20`, the
`sheaf VS Code` tool set ([editor-tools](editor-tools.md)), a `Realtime
Chat` webview rendering the event stream as bubbles, and
[freshness](freshness.md) context pushes. This file owns the manifest
surfaces, settings, API-key resolution, session-controller state machine,
chat pane, storage locations, and logging.

## Requirements

### Manifest surfaces

- **[vsx-1]** THE extension manifest SHALL declare publisher `sheaf`, name
  `sheaf-vscode-extension`, engine `vscode ^1.85.0`, main `out/extension.js`,
  and activation events `onCommand:sheaf.realtime.toggleSession`,
  `onCommand:sheaf.realtime.commitAndRespond`, `onView:sheaf.chatView`.
- **[vsx-2]** THE extension SHALL contribute an activity-bar container
  `sheafContainer` titled `Sheaf` (icon `media/sheaf.svg`) holding one
  webview view `sheaf.chatView` named `Realtime Chat`.
- **[vsx-3]** THE extension SHALL contribute commands
  `sheaf.realtime.toggleSession` (**Sheaf: Toggle Realtime Session**, key
  `F16`) and `sheaf.realtime.commitAndRespond` (**Sheaf: Commit Audio And
  Request Response**, key `F20`); both are global commands requiring no
  webview focus.
- **[vsx-4]** THE extension SHALL contribute the workspace settings in
  Contracts under `sheaf.realtime.*`, all string-typed, defaults as listed.

### Configuration resolution

- **[vsx-5]** WHEN a session starts, THE extension SHALL resolve the OpenAI
  API key in this order, using the first non-blank trimmed value:
  (1) VS Code Secret Storage key `sheaf.realtime.openAiApiKey`,
  (2) `openai_api_key` from `<repo>/config/api_keys.json` when the
  workspace is a Sheaf repository (vsx-6), (3) the
  `sheaf.realtime.openAiApiKey` workspace setting. Environment variables
  are never read.
- **[vsx-6]** THE extension SHALL treat a workspace folder as a Sheaf
  repository when `FindRepositoryRoot` ([config](config.md) cfg-1) succeeds
  from it AND `<root>/projects/realtime-agent` exists; the first matching
  folder wins. IF `api_keys.json` exists but cannot be read/parsed, THEN
  the failure SHALL be logged as `config_lookup_failed` and resolution
  continues with the next source.
- **[vsx-7]** IF no API key resolves, THEN THE extension SHALL stay idle
  and show the error message
  `Sheaf realtime: set an OpenAI API key (VS Code Secret Storage, config/api_keys.json, or sheaf.realtime.openAiApiKey setting).`
- **[vsx-8]** THE extension SHALL open its SQLite database at
  `<extension global storage>/realtime-agent.sqlite3`
  ([persistence](persistence.md)), never under repository
  `data/realtime-agent/`.
- **[vsx-9]** THE extension SHALL start sessions with: turn mode
  `{type: "manual"}`, `responseAfterToolOutput: true`, `initialContext: ""`,
  the `sheaf VS Code` tool call set, model from `sheaf.realtime.model`
  (trimmed; blank → `gpt-realtime-2`), system prompt from
  `sheaf.realtime.systemPrompt` when non-blank else the built-in
  `BASELINE_VOICE_NAV_SYSTEM_PROMPT`, input device from
  `sheaf.realtime.inputDevice` (blank → undefined), and safety identifier
  from `sheaf.realtime.safetyIdentifier` (blank → undefined).

### Session controller

- **[vsx-10]** THE session controller SHALL move through states
  `idle → starting → active → stopping → idle`. Toggling SHALL start a
  session from `idle`, stop it (reason `user_stopped`) from `active`, and
  be ignored (with an output-channel line) while `starting` or `stopping`.
- **[vsx-11]** THE status-bar item (right side, priority 100, click =
  toggle) SHALL show `$(circle-large-outline) Sheaf` when idle,
  `$(record) Sheaf Listening` when active, and `$(sync~spin) Sheaf` while
  starting/stopping, with the matching tooltips in
  `src/vscode-extension/src/statusBar.ts`.
- **[vsx-12]** WHEN commit-and-respond is invoked while `active`, THE
  extension SHALL call `commitAudioAndCreateResponse()`
  ([turn-model](turn-model.md) turn-6); on failure it SHALL record chat
  error bubble `Commit failed: <message>`. WHEN invoked in any other state,
  it SHALL show the transient (3 s) status-bar message
  `Sheaf: start a realtime session first (F16).` and do nothing else.
- **[vsx-13]** IF session start fails at any step (database open, connect,
  microphone), THEN THE extension SHALL undo what started (stop capture,
  stop the session with reason `start_failed`, close the database), return
  to `idle`, record chat error `Session start failed: <message>`, and show
  `Sheaf realtime: <message>`.
- **[vsx-14]** IF capture errors mid-session, THEN THE extension SHALL show
  `Sheaf realtime: microphone error — <message>`, stop the session with
  reason `audio_error`, and record chat error
  `Microphone error: <message>`.
- **[vsx-15]** IF the session ends with reason `connection_lost`, THEN THE
  extension SHALL show
  `Sheaf realtime: connection to OpenAI was lost.`, record chat error
  `Connection to OpenAI was lost.`, detach freshness, stop capture, close
  the database, and return to `idle` without auto-reconnecting.
- **[vsx-16]** WHEN a session stops for any reason, THE extension SHALL
  stop microphone capture and detach the freshness service before stopping
  the realtime session, then close the database. WHEN the extension
  deactivates, it SHALL wait up to 30 s for a `starting` session, stop an
  `active` one with reason `extension_deactivated`, and wait up to 10 s for
  `stopping` to finish.

### Chat pane

- **[vsx-17]** THE chat webview SHALL receive debounced (32 ms) snapshot
  messages `{type:"snapshot", bubbles, sessionState, sessionIdPrefix}`
  (full bubble array; `sessionIdPrefix` is the active session id or null)
  and SHALL send `{type:"command", id:"toggleSession"|"commitAndRespond"}`,
  which execute the corresponding VS Code commands. The header SHALL show
  `Session <first 8 chars>… · active` when active, `Session starting…` /
  `Session stopping…`, or `Session inactive — press F16 to start`; it SHALL
  render a Start/Stop toggle button (disabled while starting/stopping) and
  a `Commit / respond` button (enabled only when active).
- **[vsx-18]** THE chat model SHALL reduce incoming events into bubbles:
  user transcript bubbles streamed per `item_id` from transcription
  delta/completed events; assistant text bubbles streamed per
  `response_id` (falling back to `item_id`, then `"_unknown_response"`)
  from `response.output_text.delta`/`.done`; tool bubbles created at
  lifecycle phase `queued` with a per-tool summary (arguments captured from
  `response.function_call_arguments.done`) and updated through
  `started`/`succeeded`/`failed`; context-push bubbles (freshness pushes
  and other structured context, summary = envelope `summary` else
  `Context: <kind>`); error bubbles from incoming `error` events
  (`error.message` else `Realtime error`) and controller errors. Raw
  events, audio appends, and full tool payloads are never rendered.
- **[vsx-19]** WHEN a session starts, THE chat model SHALL clear; WHEN a
  session ends, it SHALL reset to a single context bubble
  `Session ended: <reason>`.

### Logging

- **[vsx-20]** THE extension SHALL log lines and events to an output
  channel named `Sheaf Realtime`; WHERE the workspace is a Sheaf repository
  (vsx-6), structured events SHALL also append to
  `<repo>/logs/realtime-agent/vscode-extension.jsonl` in the runtime-log
  format ([config](config.md) cfg-6/7). Event names include
  `extension_session_started`, `extension_session_stopped`,
  `extension_session_start_failed`, `extension_session_ended_unexpectedly`,
  `persistence_init_failed`, `tool_dispatch_failed`, `config_lookup_failed`.

## Contracts

### Settings (`sheaf.realtime.*`)

| Setting | Default | Meaning |
|---|---|---|
| `openAiApiKey` | `""` | API key fallback (vsx-5 order; kept for explicit backwards compatibility) |
| `model` | `gpt-realtime-2` | Realtime model |
| `systemPrompt` | `""` | Overrides the built-in prompt when non-blank |
| `inputDevice` | `""` | Microphone id or unique name substring ([audio-capture](audio-capture.md) aud-3) |
| `safetyIdentifier` | `""` | `OpenAI-Safety-Identifier` header value |

### Built-in system prompt

`BASELINE_VOICE_NAV_SYSTEM_PROMPT`
(`src/vscode-extension/src/prompts.ts`): a single space-joined string
instructing the model to act as a voice-driven VS Code assistant, use the
`sheaf VS Code` tools instead of guessing editor state, follow the
`modifyFile` exact-text/context rules, and expect freshness notifications.
The exact wording is normative only insofar as `prompts.test.ts` pins its
presence; treat the source constant as canonical.

### Storage exception

Session SQLite data lives in VS Code extension global storage
(`context.globalStorageUri`), not repository `data/realtime-agent/`:
session state is editor-host state scoped by extension identity, survives
workspace-folder changes without writing into arbitrary user workspaces,
and leaves the repository data directory reserved for the CLI. Config and
JSONL logs still use repository paths when a Sheaf workspace is open.

### Webview snapshot bubble shapes

`ChatBubble` (`src/vscode-extension/src/chat/bubbleTypes.ts`) is a tagged
union on `kind`: `user_transcript` `{id,itemId,text,complete,createdAt}`,
`assistant_text` `{id,responseId,text,complete,createdAt}`, `tool_call`
`{id,toolCallId,toolName,summary,phase,createdAt}`, `context_push`
`{id,summary,createdAt}`, `error` `{id,message,createdAt}`.

## Design

- `src/vscode-extension/src/extension.ts` — activation: output channel,
  repo-root detection, status bar, chat model + view provider, freshness
  coordinator, tool call set, `SessionController`, command registration.
- `src/vscode-extension/src/sessionController.ts` — state machine with
  injectable deps (`startSession`, `createDatabase`,
  `createMicrophoneCapture`, tool set builder) used by
  `tests/vscode-extension/sessionController.test.ts`; listener registries
  for state/started/stopped.
- `src/vscode-extension/src/config.ts` + `configCore.ts` + `repoConfig.ts`
  — settings access, pure key-resolution (`ResolveOpenAiApiKey`), repo
  detection, log-path resolution.
- `src/vscode-extension/src/chat/` — `chatModel.ts` (bubble reduction),
  `toolSummary.ts` (per-tool human summaries), `contextSummary.ts`,
  `chatViewProvider.ts` (CSP'd HTML shell, debounce, message bridge),
  `webview/index.ts` (browser bundle, no framework).
- Build: esbuild bundles `extension.ts` (cjs, externals `vscode`,
  `better-sqlite3`, `naudiodon`) and the webview (iife) into `out/`;
  `index.css` copied alongside. See [Operations](../operations.md).
- Tests: `tests/vscode-extension/sessionController.test.ts`,
  `config.test.ts`, `repoConfig.test.ts`, `prompts.test.ts`, `log.test.ts`,
  `chat/*.test.ts`.

## Interactions

- [session-lifecycle](session-lifecycle.md) — `startAgentSession` with the
  callbacks that feed the chat model and logs.
- [turn-model](turn-model.md) — manual mode; F20 = commit+create unit.
- [editor-tools](editor-tools.md) — the `sheaf VS Code` tool set.
- [freshness](freshness.md) — service lifecycle bound to session
  start/stop; pushes render as context bubbles.
- [audio-capture](audio-capture.md), [persistence](persistence.md),
  [config](config.md) — capture, storage, key/log plumbing.
