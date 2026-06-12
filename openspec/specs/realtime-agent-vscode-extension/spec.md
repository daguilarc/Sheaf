# Capability: VS Code Extension

Project: `projects/realtime-agent`
ID prefix: `vsx` — requirement IDs are append-only; never renumber or reuse.

## Purpose

`sheaf-vscode-extension` (display name **Sheaf**) provides a voice-driven
editor workflow on top of `realtime-agent-lib`: manual-turn sessions toggled
from a status-bar item or `F16`, audio committed with `F20`, the
`sheaf VS Code` tool set ([editor-tools](../realtime-agent-editor-tools/spec.md)), a `Realtime
Chat` webview rendering the event stream as bubbles, and
[freshness](../realtime-agent-freshness/spec.md) context pushes. This file owns the manifest
surfaces, settings, API-key resolution, session-controller state machine,
chat pane, storage locations, and logging.

## Requirements

### Requirement: vsx-1 — Manifest surfaces: Extension manifest declaration
THE extension manifest SHALL declare publisher `sheaf`, name `sheaf-vscode-extension`, engine `vscode ^1.85.0`, main `out/extension.js`, and activation events `onCommand:sheaf.realtime.toggleSession`, `onCommand:sheaf.realtime.commitAndRespond`, `onView:sheaf.chatView`.

#### Scenario: Extension manifest declared
- **WHEN** the extension is installed in VS Code
- **THEN** the manifest declares publisher `sheaf`, name `sheaf-vscode-extension`, engine `vscode ^1.85.0`, main `out/extension.js`, and activation events `onCommand:sheaf.realtime.toggleSession`, `onCommand:sheaf.realtime.commitAndRespond`, `onView:sheaf.chatView`

### Requirement: vsx-2 — Manifest surfaces: Activity-bar container
THE extension SHALL contribute an activity-bar container `sheafContainer` titled `Sheaf` (icon `media/sheaf.svg`) holding one webview view `sheaf.chatView` named `Realtime Chat`.

#### Scenario: Activity-bar container contributed
- **WHEN** the extension activates
- **THEN** an activity-bar container `sheafContainer` titled `Sheaf` with icon `media/sheaf.svg` is present, holding one webview view `sheaf.chatView` named `Realtime Chat`

### Requirement: vsx-3 — Manifest surfaces: Commands and keybindings
THE extension SHALL contribute commands `sheaf.realtime.toggleSession` (**Sheaf: Toggle Realtime Session**, key `F16`) and `sheaf.realtime.commitAndRespond` (**Sheaf: Commit Audio And Request Response**, key `F20`); both are global commands requiring no webview focus.

#### Scenario: Commands and keybindings registered
- **WHEN** the extension activates
- **THEN** `sheaf.realtime.toggleSession` (key `F16`) and `sheaf.realtime.commitAndRespond` (key `F20`) are registered as global commands requiring no webview focus

### Requirement: vsx-4 — Manifest surfaces: Workspace settings
THE extension SHALL contribute the workspace settings in Contracts under `sheaf.realtime.*`, all string-typed, defaults as listed.

#### Scenario: Workspace settings contributed
- **WHEN** the extension is installed
- **THEN** all `sheaf.realtime.*` settings from Contracts are contributed, all string-typed, with defaults as listed

### Requirement: vsx-5 — Configuration resolution: API key resolution order
WHEN a session starts, THE extension SHALL resolve the OpenAI API key in this order, using the first non-blank trimmed value: (1) VS Code Secret Storage key `sheaf.realtime.openAiApiKey`, (2) `openai_api_key` from `<repo>/config/api_keys.json` when the workspace is a Sheaf repository (vsx-6), (3) the `sheaf.realtime.openAiApiKey` workspace setting. Environment variables are never read.

#### Scenario: Secret Storage key present
- **WHEN** a session starts and VS Code Secret Storage key `sheaf.realtime.openAiApiKey` has a non-blank trimmed value
- **THEN** that value is used as the API key

#### Scenario: Secret Storage absent, api_keys.json present in Sheaf repo
- **WHEN** a session starts and Secret Storage is blank, but `<repo>/config/api_keys.json` exists in a Sheaf repository workspace (vsx-6)
- **THEN** `openai_api_key` from that file is used as the API key

#### Scenario: Both absent, workspace setting present
- **WHEN** a session starts and Secret Storage and api_keys.json are both blank or unavailable
- **THEN** the `sheaf.realtime.openAiApiKey` workspace setting value is used

#### Scenario: Environment variables ignored
- **WHEN** a session starts
- **THEN** environment variables are never read for the API key

### Requirement: vsx-6 — Configuration resolution: Sheaf repository detection
THE extension SHALL treat a workspace folder as a Sheaf repository when `FindRepositoryRoot` ([config](../realtime-agent-config/spec.md) cfg-1) succeeds from it AND `<root>/projects/realtime-agent` exists; the first matching folder wins. IF `api_keys.json` exists but cannot be read/parsed, THEN the failure SHALL be logged as `config_lookup_failed` and resolution continues with the next source.

#### Scenario: Sheaf repository detected
- **WHEN** `FindRepositoryRoot` succeeds from a workspace folder and `<root>/projects/realtime-agent` exists
- **THEN** that workspace folder is treated as a Sheaf repository and the first such matching folder wins

#### Scenario: api_keys.json unreadable
- **WHEN** `api_keys.json` exists but cannot be read or parsed
- **THEN** the failure is logged as `config_lookup_failed` and resolution continues with the next source

### Requirement: vsx-7 — Configuration resolution: No API key error
IF no API key resolves, THEN THE extension SHALL stay idle and show the error message `Sheaf realtime: set an OpenAI API key (VS Code Secret Storage, config/api_keys.json, or sheaf.realtime.openAiApiKey setting).`

#### Scenario: No API key resolves
- **WHEN** no API key resolves from any source
- **THEN** the extension stays idle and shows the error message `Sheaf realtime: set an OpenAI API key (VS Code Secret Storage, config/api_keys.json, or sheaf.realtime.openAiApiKey setting).`

### Requirement: vsx-8 — Configuration resolution: SQLite database location
THE extension SHALL open its SQLite database at `<extension global storage>/realtime-agent.sqlite3` ([persistence](../realtime-agent-persistence/spec.md)), never under repository `data/realtime-agent/`.

#### Scenario: SQLite database opened
- **WHEN** the extension opens its SQLite database
- **THEN** it is opened at `<extension global storage>/realtime-agent.sqlite3` and never under repository `data/realtime-agent/`

### Requirement: vsx-9 — Configuration resolution: Session start parameters
THE extension SHALL start sessions with: turn mode `{type: "manual"}`, `responseAfterToolOutput: true`, `initialContext: ""`, the `sheaf VS Code` tool call set, model from `sheaf.realtime.model` (trimmed; blank → `gpt-realtime-2`), system prompt from `sheaf.realtime.systemPrompt` when non-blank else the built-in `BASELINE_VOICE_NAV_SYSTEM_PROMPT`, input device from `sheaf.realtime.inputDevice` (blank → undefined), and safety identifier from `sheaf.realtime.safetyIdentifier` (blank → undefined).

#### Scenario: Session started with configured parameters
- **WHEN** a session starts
- **THEN** it uses turn mode `{type: "manual"}`, `responseAfterToolOutput: true`, `initialContext: ""`, the `sheaf VS Code` tool call set, model from `sheaf.realtime.model` (trimmed; blank → `gpt-realtime-2`), system prompt from `sheaf.realtime.systemPrompt` when non-blank else `BASELINE_VOICE_NAV_SYSTEM_PROMPT`, input device from `sheaf.realtime.inputDevice` (blank → undefined), and safety identifier from `sheaf.realtime.safetyIdentifier` (blank → undefined)

### Requirement: vsx-10 — Session controller: State machine transitions
THE session controller SHALL move through states `idle → starting → active → stopping → idle`. Toggling SHALL start a session from `idle`, stop it (reason `user_stopped`) from `active`, and be ignored (with an output-channel line) while `starting` or `stopping`.

#### Scenario: Toggle from idle
- **WHEN** the session is toggled from `idle`
- **THEN** the controller transitions to `starting` and begins a new session

#### Scenario: Toggle from active
- **WHEN** the session is toggled from `active`
- **THEN** the controller stops the session with reason `user_stopped` and transitions toward `stopping → idle`

#### Scenario: Toggle while starting or stopping
- **WHEN** the session is toggled while `starting` or `stopping`
- **THEN** the toggle is ignored and an output-channel line is written

### Requirement: vsx-11 — Session controller: Status-bar item
THE status-bar item (right side, priority 100, click = toggle) SHALL show `$(circle-large-outline) Sheaf` when idle, `$(record) Sheaf Listening` when active, and `$(sync~spin) Sheaf` while starting/stopping, with the matching tooltips in `src/vscode-extension/src/statusBar.ts`.

#### Scenario: Status-bar idle state
- **WHEN** the session is idle
- **THEN** the status-bar item shows `$(circle-large-outline) Sheaf` with the matching idle tooltip

#### Scenario: Status-bar active state
- **WHEN** the session is active
- **THEN** the status-bar item shows `$(record) Sheaf Listening` with the matching active tooltip

#### Scenario: Status-bar starting or stopping state
- **WHEN** the session is starting or stopping
- **THEN** the status-bar item shows `$(sync~spin) Sheaf` with the matching tooltip

### Requirement: vsx-12 — Session controller: Commit-and-respond invocation
WHEN commit-and-respond is invoked while `active`, THE extension SHALL call `commitAudioAndCreateResponse()` ([turn-model](../realtime-agent-turn-model/spec.md) turn-6); on failure it SHALL record chat error bubble `Commit failed: <message>`. WHEN invoked in any other state, it SHALL show the transient (3 s) status-bar message `Sheaf: start a realtime session first (F16).` and do nothing else.

#### Scenario: Commit-and-respond while active
- **WHEN** commit-and-respond is invoked while the session is `active`
- **THEN** the extension calls `commitAudioAndCreateResponse()`

#### Scenario: Commit-and-respond failure while active
- **WHEN** `commitAudioAndCreateResponse()` fails
- **THEN** a chat error bubble `Commit failed: <message>` is recorded

#### Scenario: Commit-and-respond in non-active state
- **WHEN** commit-and-respond is invoked in any state other than `active`
- **THEN** the transient (3 s) status-bar message `Sheaf: start a realtime session first (F16).` is shown and nothing else is done

### Requirement: vsx-13 — Session controller: Session start failure cleanup
IF session start fails at any step (database open, connect, microphone), THEN THE extension SHALL undo what started (stop capture, stop the session with reason `start_failed`, close the database), return to `idle`, record chat error `Session start failed: <message>`, and show `Sheaf realtime: <message>`.

#### Scenario: Session start fails
- **WHEN** session start fails at any step (database open, connect, or microphone)
- **THEN** the extension stops capture, stops the session with reason `start_failed`, closes the database, returns to `idle`, records chat error `Session start failed: <message>`, and shows `Sheaf realtime: <message>`

### Requirement: vsx-14 — Session controller: Mid-session capture error
IF capture errors mid-session, THEN THE extension SHALL show `Sheaf realtime: microphone error — <message>`, stop the session with reason `audio_error`, and record chat error `Microphone error: <message>`.

#### Scenario: Capture errors mid-session
- **WHEN** a capture error occurs during an active session
- **THEN** the extension shows `Sheaf realtime: microphone error — <message>`, stops the session with reason `audio_error`, and records chat error `Microphone error: <message>`

### Requirement: vsx-15 — Session controller: Connection lost handling
IF the session ends with reason `connection_lost`, THEN THE extension SHALL show `Sheaf realtime: connection to OpenAI was lost.`, record chat error `Connection to OpenAI was lost.`, detach freshness, stop capture, close the database, and return to `idle` without auto-reconnecting.

#### Scenario: Session ends with connection_lost
- **WHEN** the session ends with reason `connection_lost`
- **THEN** the extension shows `Sheaf realtime: connection to OpenAI was lost.`, records chat error `Connection to OpenAI was lost.`, detaches freshness, stops capture, closes the database, and returns to `idle` without auto-reconnecting

### Requirement: vsx-16 — Session controller: Session stop and deactivation cleanup
WHEN a session stops for any reason, THE extension SHALL stop microphone capture and detach the freshness service before stopping the realtime session, then close the database. WHEN the extension deactivates, it SHALL wait up to 30 s for a `starting` session, stop an `active` one with reason `extension_deactivated`, and wait up to 10 s for `stopping` to finish.

#### Scenario: Session stops for any reason
- **WHEN** a session stops for any reason
- **THEN** the extension stops microphone capture and detaches the freshness service before stopping the realtime session, then closes the database

#### Scenario: Extension deactivates with starting session
- **WHEN** the extension deactivates while a session is `starting`
- **THEN** the extension waits up to 30 s for it to complete

#### Scenario: Extension deactivates with active session
- **WHEN** the extension deactivates while a session is `active`
- **THEN** the extension stops it with reason `extension_deactivated` and waits up to 10 s for `stopping` to finish

### Requirement: vsx-17 — Chat pane: Webview snapshot protocol
THE chat webview SHALL receive debounced (32 ms) snapshot messages `{type:"snapshot", bubbles, sessionState, sessionIdPrefix}` (full bubble array; `sessionIdPrefix` is the active session id or null) and SHALL send `{type:"command", id:"toggleSession"|"commitAndRespond"}`, which execute the corresponding VS Code commands. The header SHALL show `Session <first 8 chars>… · active` when active, `Session starting…` / `Session stopping…`, or `Session inactive — press F16 to start`; it SHALL render a Start/Stop toggle button (disabled while starting/stopping) and a `Commit / respond` button (enabled only when active).

#### Scenario: Webview receives snapshot
- **WHEN** the extension sends a debounced (32 ms) snapshot message `{type:"snapshot", bubbles, sessionState, sessionIdPrefix}`
- **THEN** the webview renders the full bubble array and updates the header and buttons per session state

#### Scenario: Webview sends command
- **WHEN** the webview sends `{type:"command", id:"toggleSession"|"commitAndRespond"}`
- **THEN** the corresponding VS Code command is executed

#### Scenario: Header shows active state
- **WHEN** the session is active
- **THEN** the header shows `Session <first 8 chars>… · active`, a Start/Stop toggle button (enabled), and `Commit / respond` (enabled)

#### Scenario: Header shows starting or stopping state
- **WHEN** the session is starting or stopping
- **THEN** the header shows `Session starting…` or `Session stopping…` and the Start/Stop button is disabled

#### Scenario: Header shows inactive state
- **WHEN** the session is inactive
- **THEN** the header shows `Session inactive — press F16 to start` and the `Commit / respond` button is disabled

### Requirement: vsx-18 — Chat pane: Bubble reduction model
THE chat model SHALL reduce incoming events into bubbles: user transcript bubbles streamed per `item_id` from transcription delta/completed events; assistant text bubbles streamed per `response_id` (falling back to `item_id`, then `"_unknown_response"`) from `response.output_text.delta`/`.done`; tool bubbles created at lifecycle phase `queued` with a per-tool summary (arguments captured from `response.function_call_arguments.done`) and updated through `started`/`succeeded`/`failed`; context-push bubbles (freshness pushes and other structured context, summary = envelope `summary` else `Context: <kind>`); error bubbles from incoming `error` events (`error.message` else `Realtime error`) and controller errors. Raw events, audio appends, and full tool payloads are never rendered.

#### Scenario: User transcript bubble streamed
- **WHEN** transcription delta or completed events arrive
- **THEN** user transcript bubbles are streamed per `item_id`

#### Scenario: Assistant text bubble streamed
- **WHEN** `response.output_text.delta` or `.done` events arrive
- **THEN** assistant text bubbles are streamed per `response_id` (falling back to `item_id`, then `"_unknown_response"`)

#### Scenario: Tool bubble lifecycle
- **WHEN** a tool call is detected at `queued` phase and progresses through `started`/`succeeded`/`failed`
- **THEN** a tool bubble is created at `queued` with a per-tool summary (arguments captured from `response.function_call_arguments.done`) and updated through each phase

#### Scenario: Context-push bubble
- **WHEN** a freshness push or other structured context arrives
- **THEN** a context-push bubble is created with summary = envelope `summary` else `Context: <kind>`

#### Scenario: Error bubble
- **WHEN** an incoming `error` event or controller error occurs
- **THEN** an error bubble is created with `error.message` else `Realtime error`

#### Scenario: Raw events never rendered
- **WHEN** raw events, audio appends, or full tool payloads are received
- **THEN** they are never rendered as bubbles

### Requirement: vsx-19 — Chat pane: Session start and end bubble clearing
WHEN a session starts, THE chat model SHALL clear; WHEN a session ends, it SHALL reset to a single context bubble `Session ended: <reason>`.

#### Scenario: Session starts
- **WHEN** a session starts
- **THEN** the chat model clears all bubbles

#### Scenario: Session ends
- **WHEN** a session ends
- **THEN** the chat model resets to a single context bubble `Session ended: <reason>`

### Requirement: vsx-20 — Logging: Output channel and structured event log
THE extension SHALL log lines and events to an output channel named `Sheaf Realtime`; WHERE the workspace is a Sheaf repository (vsx-6), structured events SHALL also append to `<repo>/logs/realtime-agent/vscode-extension.jsonl` in the runtime-log format ([config](../realtime-agent-config/spec.md) cfg-6/7). Event names include `extension_session_started`, `extension_session_stopped`, `extension_session_start_failed`, `extension_session_ended_unexpectedly`, `persistence_init_failed`, `tool_dispatch_failed`, `config_lookup_failed`.

#### Scenario: Output channel logging
- **WHEN** the extension produces log lines or events
- **THEN** they are written to the output channel named `Sheaf Realtime`

#### Scenario: Structured event log in Sheaf workspace
- **WHEN** the workspace is a Sheaf repository (vsx-6) and a structured event occurs
- **THEN** it is appended to `<repo>/logs/realtime-agent/vscode-extension.jsonl` in the runtime-log format, with event names including `extension_session_started`, `extension_session_stopped`, `extension_session_start_failed`, `extension_session_ended_unexpectedly`, `persistence_init_failed`, `tool_dispatch_failed`, `config_lookup_failed`

## Contracts

### Settings (`sheaf.realtime.*`)

| Setting | Default | Meaning |
|---|---|---|
| `openAiApiKey` | `""` | API key fallback (vsx-5 order; kept for explicit backwards compatibility) |
| `model` | `gpt-realtime-2` | Realtime model |
| `systemPrompt` | `""` | Overrides the built-in prompt when non-blank |
| `inputDevice` | `""` | Microphone id or unique name substring ([audio-capture](../realtime-agent-audio-capture/spec.md) aud-3) |
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
  `index.css` copied alongside. See [Operations](../../../projects/realtime-agent/docs/operations.md).
- Tests: `tests/vscode-extension/sessionController.test.ts`,
  `config.test.ts`, `repoConfig.test.ts`, `prompts.test.ts`, `log.test.ts`,
  `chat/*.test.ts`.

## Interactions

- [session-lifecycle](../realtime-agent-session-lifecycle/spec.md) — `startAgentSession` with the
  callbacks that feed the chat model and logs.
- [turn-model](../realtime-agent-turn-model/spec.md) — manual mode; F20 = commit+create unit.
- [editor-tools](../realtime-agent-editor-tools/spec.md) — the `sheaf VS Code` tool set.
- [freshness](../realtime-agent-freshness/spec.md) — service lifecycle bound to session
  start/stop; pushes render as context bubbles.
- [audio-capture](../realtime-agent-audio-capture/spec.md), [persistence](../realtime-agent-persistence/spec.md),
  [config](../realtime-agent-config/spec.md) — capture, storage, key/log plumbing.
