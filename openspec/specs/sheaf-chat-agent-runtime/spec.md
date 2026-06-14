# Capability: Agent Runtime

Project: `projects/sheaf-chat`
ID prefix: `ar` — requirement IDs are append-only; never renumber or reuse.

## Purpose

The in-memory runtime that owns one embedded Pi agent session per chat
session: lifecycle states, attach/detach reference counting, idle offload,
hot and cold resume, user-message delivery (prompt vs steer), cancellation,
model switching, and the deferred initial-manifest write with its summarizer.
## Requirements
### Requirement: ar-1 — Lifecycle: lifecycle states and status events

THE service SHALL report agent lifecycle states `cold`, `starting`, `active`, `idle`, `stopping`, `failed`, and SHALL emit a status event (persisted/broadcast as `agent.status`, [chat-protocol](../sheaf-chat-chat-protocol/spec.md)) on every state change, with `previousState` included.

#### Scenario: State change emits status event
- **WHEN** the agent transitions between any two lifecycle states
- **THEN** a status event is emitted with the new state, persisted/broadcast as `agent.status`, and `previousState` is included

### Requirement: ar-2 — Lifecycle: cold-attach startup and failure

WHEN a client attaches to a session with no live Pi session, THE service SHALL transition `cold → starting`, create the Pi session, and transition to `active`; IF creation fails, THEN it SHALL transition to `failed`, emit a fatal `session_start_failed` error, and surface the failure to the attaching client.

#### Scenario: Successful cold attach
- **WHEN** a client attaches to a session with no live Pi session
- **THEN** the service transitions `cold → starting`, creates the Pi session, and transitions to `active`

#### Scenario: Pi session creation fails
- **WHEN** a client attaches to a session with no live Pi session and creation fails
- **THEN** the service transitions to `failed`, emits a fatal `session_start_failed` error, and surfaces the failure to the attaching client

### Requirement: ar-3 — Lifecycle: serialized startup and hot resume

THE service SHALL serialize startup per session: concurrent attaches to the same session SHALL share one startup and one runtime, and an attach while a Pi session is already live SHALL reuse it (hot resume).

#### Scenario: Concurrent attaches
- **WHEN** multiple clients attach to the same session concurrently before startup completes
- **THEN** all attaches share one startup and one runtime

#### Scenario: Attach to live session
- **WHEN** a client attaches while a Pi session is already live
- **THEN** the service reuses the existing Pi session (hot resume)

### Requirement: ar-4 — Lifecycle: cold-resume bootstrap

WHEN cold-resuming, THE service SHALL bootstrap from the chat manifest when present, otherwise from the provisional workspace chat record; IF the Pi session file is missing, THEN attachment SHALL fail (`chat file not found for <chatId>`). The manifest's `rootDirectory` and `model` are authoritative on resume.

#### Scenario: Manifest present on cold resume

- **WHEN** cold-resuming a chat and the manifest is present
- **THEN** the service bootstraps from the manifest, using its `rootDirectory` and `model` as authoritative values

#### Scenario: No manifest on cold resume

- **WHEN** cold-resuming a chat and no manifest is present
- **THEN** the service bootstraps from the provisional workspace chat record

#### Scenario: Pi session file missing

- **WHEN** cold-resuming a chat and the Pi session file is missing
- **THEN** attachment fails with `chat file not found for <chatId>`

### Requirement: ar-5 — Lifecycle: idle transition and offload timer

WHEN the last client reference detaches (client references are counted per `clientId`; multiple sockets sharing one id are one logical client until all detach), THE service SHALL transition to `idle` and start the offload timer (`agent_idle_offload_seconds`, default 300, [service](../sheaf-chat-service/spec.md)).

#### Scenario: Last client detaches
- **WHEN** the last client reference detaches from a session
- **THEN** the service transitions to `idle` and starts the offload timer (`agent_idle_offload_seconds`, default 300)

### Requirement: ar-6 — Lifecycle: offload timer firing and conditions

WHEN the offload timer fires, THE service SHALL dispose the Pi session and transition `stopping → cold` only when there are no connected clients, no active agent run, and no active tool call; otherwise it SHALL not offload (run/tool completion with no clients re-arms the timer). A client attaching cancels the timer and returns the state to `active`.

#### Scenario: Offload timer fires with no activity
- **WHEN** the offload timer fires and there are no connected clients, no active agent run, and no active tool call
- **THEN** the service disposes the Pi session and transitions `stopping → cold`

#### Scenario: Offload timer fires with activity
- **WHEN** the offload timer fires and there is an active agent run or tool call
- **THEN** the service does not offload; run/tool completion with no clients re-arms the timer

#### Scenario: Client attaches while timer is armed
- **WHEN** a client attaches while the offload timer is armed
- **THEN** the timer is cancelled and the state returns to `active`

### Requirement: ar-7 — Message delivery: prompt, steer, and queue

WHEN an accepted user message reaches the runtime and the Pi session is not streaming, THE service SHALL deliver it as a prompt; WHILE the Pi session is streaming, a message with `steer: true` SHALL be delivered via steer and a message without it SHALL be queued as a follow-up prompt.

#### Scenario: Message delivered when not streaming
- **WHEN** an accepted user message reaches the runtime and the Pi session is not streaming
- **THEN** the service delivers it as a prompt

#### Scenario: Steer message while streaming
- **WHEN** an accepted user message with `steer: true` arrives while the Pi session is streaming
- **THEN** the service delivers it via steer

#### Scenario: Non-steer message while streaming
- **WHEN** an accepted user message without `steer: true` arrives while the Pi session is streaming
- **THEN** the message is queued as a follow-up prompt

### Requirement: ar-8 — Message delivery: deduplication and delivery failures

THE runtime SHALL deduplicate deliveries by `messageId` (independently of the protocol-level dedup) and SHALL report delivery failures as non-fatal `user_message_delivery_failed` errors rather than throwing.

#### Scenario: Duplicate messageId
- **WHEN** a message with a `messageId` that has already been delivered arrives at the runtime
- **THEN** the duplicate delivery is suppressed

#### Scenario: Delivery failure
- **WHEN** delivering a user message fails
- **THEN** the runtime reports a non-fatal `user_message_delivery_failed` error rather than throwing

### Requirement: ar-9 — Message delivery: cancellation

WHEN a cancel is requested for a session with a live Pi session, THE service SHALL call `abort()` on it and emit a non-fatal error event with code `cancelled` and message `Turn cancelled` (persisted as a `server.error` envelope plus a `RUN_ERROR` AGUI event).

#### Scenario: Cancel requested
- **WHEN** a cancel is requested for a session with a live Pi session
- **THEN** the service calls `abort()` on the Pi session and emits a non-fatal error event with code `cancelled` and message `Turn cancelled`, persisted as a `server.error` envelope plus a `RUN_ERROR` AGUI event

### Requirement: ar-10 — Message delivery: model selection

WHEN a validated model selection is applied, THE service SHALL set the model on the Pi session, emit the model event (persisted as `model.changed`), and — once a manifest exists — update the manifest's `model` and emit a manifest-updated event.

#### Scenario: Model selection applied before manifest exists
- **WHEN** a validated model selection is applied and no manifest exists yet
- **THEN** the service sets the model on the Pi session and emits the model event (persisted as `model.changed`)

#### Scenario: Model selection applied with manifest present
- **WHEN** a validated model selection is applied and a manifest exists
- **THEN** the service sets the model on the Pi session, emits the model event (persisted as `model.changed`), updates the manifest's `model`, and emits a manifest-updated event

### Requirement: ar-11 — Deferred manifest: initial write

WHEN the first user message of a workspace chat is accepted, THE service SHALL start generating a summary from its text; WHEN the first assistant message completes (Pi `message_end` with role `assistant`), THE service SHALL write the initial chat manifest exactly once with the summary as `chatName` and `description` and emit a manifest-updated event (broadcast as `session.updated`).

#### Scenario: First user message accepted

- **WHEN** the first user message of a workspace chat is accepted
- **THEN** the service starts generating a summary from its text

#### Scenario: First assistant message completes

- **WHEN** the first assistant message completes (Pi `message_end` with role `assistant`)
- **THEN** the service writes the initial chat manifest exactly once with the summary as `chatName` and `description`, and emits a manifest-updated event broadcast as `session.updated`

### Requirement: ar-12 — Deferred manifest: deterministic summarizer

THE default summarizer SHALL be deterministic: the first line of the message, whitespace-collapsed, truncated to 80 characters (with a trailing `…` replacing the 80th character when longer, trailing spaces trimmed before it); an empty result falls back to `New chat`. A failing custom summarizer falls back to the deterministic result.

#### Scenario: Message shorter than 80 characters
- **WHEN** the default summarizer processes a message whose first line, whitespace-collapsed, is 80 characters or fewer
- **THEN** the summary is the whitespace-collapsed first line

#### Scenario: Message longer than 80 characters
- **WHEN** the default summarizer processes a message whose first line, whitespace-collapsed, exceeds 80 characters
- **THEN** the summary is truncated to 80 characters with `…` replacing the 80th character, trailing spaces trimmed before it

#### Scenario: Empty result fallback
- **WHEN** the default summarizer produces an empty result
- **THEN** the summary falls back to `New chat`

#### Scenario: Custom summarizer fails
- **WHEN** a custom summarizer fails
- **THEN** the result falls back to the deterministic summarizer output

### Requirement: ar-13 — Deferred manifest: write failure

IF the manifest write fails, THEN THE service SHALL emit a non-fatal `manifest_write_failed` error and continue serving the session (no retry: the first-assistant-completed latch stays set).

#### Scenario: Manifest write fails
- **WHEN** the initial manifest write fails
- **THEN** the service emits a non-fatal `manifest_write_failed` error and continues serving the session with the first-assistant-completed latch remaining set (no retry)

### Requirement: ar-14 — Pi session construction: directories and session manager

THE service SHALL create Pi sessions with the service-local agent directory `data/sheaf-chat/pi-agent/`, the service-local auth storage and model registry ([models](../sheaf-chat-models/spec.md)), and the session's root directory as working directory, opening the stored Pi session file via Pi's `SessionManager`.

#### Scenario: Pi session created
- **WHEN** the service creates a Pi session
- **THEN** it uses the service-local agent directory `data/sheaf-chat/pi-agent/`, the service-local auth storage and model registry, and the session's root directory as working directory, opening the stored Pi session file via Pi's `SessionManager`

### Requirement: ar-15 — Pi session construction: resource loading and extensions

THE service SHALL disable all global Pi resource loading for the session (extensions, skills, prompt templates, themes, context files) and register exactly two extension factories: the local-provider extension and the scoped-tools extension bound to the session root.

#### Scenario: Pi session resource loading configured
- **WHEN** the service creates a Pi session
- **THEN** all global Pi resource loading is disabled (extensions, skills, prompt templates, themes, context files) and exactly two extension factories are registered: the local-provider extension and the scoped-tools extension bound to the session root

### Requirement: ar-16 — Pi session construction: tools configuration

THE service SHALL disable Pi built-in tools (`noTools: "builtin"`) and enable exactly the eight scoped tool names ([scoped-tools](../sheaf-chat-scoped-tools/spec.md)); no shell or command-execution tool is available to the agent.

#### Scenario: Pi session tools configured
- **WHEN** the service creates a Pi session
- **THEN** Pi built-in tools are disabled (`noTools: "builtin"`), exactly the eight scoped tool names are enabled, and no shell or command-execution tool is available to the agent

### Requirement: ar-17 — Pi session construction: model not found

IF the session's configured model is not found in the registry at Pi-session creation or at a model switch, THEN THE operation SHALL fail with `model not found: <provider>/<id>`.

#### Scenario: Model not found at creation
- **WHEN** the session's configured model is not found in the registry at Pi-session creation
- **THEN** the operation fails with `model not found: <provider>/<id>`

#### Scenario: Model not found at switch
- **WHEN** the session's configured model is not found in the registry at a model switch
- **THEN** the operation fails with `model not found: <provider>/<id>`

### Requirement: ar-18 — Workspace identity: runtime keys

THE service SHALL key agent runtimes by `{repoId, workspaceId, chatId}` and SHALL not use pile names as part of runtime identity.

#### Scenario: Runtime created

- **WHEN** a chat runtime is created for a workspace chat
- **THEN** its lifecycle key contains `repoId`, `workspaceId`, and `chatId`

### Requirement: ar-19 — Workspace root: Pi session construction

WHEN creating or resuming a workspace chat runtime, THE service SHALL use the chat manifest root when present and the provisional workspace root otherwise, and SHALL pass the workspace root as the Pi session working directory and scoped-tools root.

#### Scenario: Manifest present on resume

- **WHEN** a workspace chat has a manifest
- **THEN** the service uses the manifest root as authoritative for Pi session construction

#### Scenario: Provisional chat

- **WHEN** a workspace chat has no manifest yet
- **THEN** the service uses the provisional workspace root for Pi session construction

## Contracts

The externally observable surfaces of this capability are the
`agent.status`, `session.updated`, `model.changed`, and `server.error`
envelopes specified in [chat-protocol](../sheaf-chat-chat-protocol/spec.md), the manifest file
in [session files](../../../projects/sheaf-chat/docs/contracts/session-files.md), and the
`AgentStatusSnapshot` fields surfaced through `server.hello`
(`manifest`, `activeModel`, `provisionalSession`).

Lifecycle states:

| State | Meaning |
|---|---|
| `cold` | Session files exist; no Pi session attached. |
| `starting` | Pi session being created/resumed. |
| `active` | Pi session attached; messages deliverable. |
| `idle` | No clients connected; offload timer armed. |
| `stopping` | Pi session being disposed. |
| `failed` | Startup/resume failed (`lastError` recorded). |

### Error catalogue

| Condition | Code | Message |
|---|---|---|
| Pi session creation fails | `session_start_failed` (fatal) | underlying message |
| Runtime missing after startup | `session_start_failed` | `session runtime missing after startup` |
| Message/model op on inactive session that cannot start | `session_not_active` | `session is not active` |
| Pi delivery failure | `user_message_delivery_failed` (non-fatal) | underlying message |
| Cancel | `cancelled` (non-fatal) | `Turn cancelled` |
| Manifest write failure | `manifest_write_failed` (non-fatal) | underlying message |
| Session file missing on resume | — (attach fails) | `session file not found for <sessionId>` |
| Unknown model at Pi level | — (operation fails) | `model not found: <provider>/<id>` |

## Design

- `src/agents/manager.ts` — `AgentManager`: runtime registry, per-session
  startup locks (promise chains), `createBlankSession` validation,
  `attachSession`/`markClientDetached`, `BuildStatus`.
- `src/agents/sessionRuntime.ts` — `SessionRuntime`: state transitions,
  client reference counts, idle timer, `AcceptUserMessage`
  (prompt/steer/followUp split), `CancelTurn`, `SelectModel`,
  run/tool-call counters driven by Pi `agent_start`/`agent_end`/
  `tool_execution_start`/`tool_execution_end` events, and
  `HandleAssistantMessageCompleted` (deferred manifest);
  `ResolveSessionBootstrap` / `CreateRuntimeRecordFromColdResume` for
  resume.
- `src/agents/piAdapter.ts` — `CreateSheafPiSession` and the
  `PiSessionHandle` wrapper (prompt/steer/followUp/setModel/abort/dispose/
  subscribe); `DefaultResourceLoader` is configured with all `no*` flags and
  the two extension factories.
- `src/agents/summarizer.ts` — `BuildDeterministicSummary`,
  `CreateSessionSummarizer`. No LLM-backed summarizer is wired in
  production; the generator hook exists for tests.
- `src/agents/lifecycle.ts` — `LifecycleEmitter` event bus (`status`,
  `model`, `userMessageAccepted`, `agentEvent`, `manifestUpdated`,
  `error`); error events are dropped when no listener is registered so the
  manager never crashes on unobserved errors.
- Offload disposes the Pi session object only; all files remain, so the
  next attach is a cold resume.

## Interactions

- [chat-protocol](../sheaf-chat-chat-protocol/spec.md) — drives attach/detach/messages and
  persists every event this capability emits.
- [models](../sheaf-chat-models/spec.md) — registry bundle used at session creation and model
  switch.
- [scoped-tools](../sheaf-chat-scoped-tools/spec.md) — the extension registered per session.
- [agui-mapping](../sheaf-chat-agui-mapping/spec.md) — consumes the Pi events this runtime
  re-emits.
- [session files](../../../projects/sheaf-chat/docs/contracts/session-files.md) — manifest/provisional
  formats read and written here.
