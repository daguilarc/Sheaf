# Capability: Agent Runtime

ID prefix: `ar`

## Purpose

The in-memory runtime that owns one embedded Pi agent session per chat
session: lifecycle states, attach/detach reference counting, idle offload,
hot and cold resume, user-message delivery (prompt vs steer), cancellation,
model switching, and the deferred initial-manifest write with its summarizer.

## Requirements

### Lifecycle

- **[ar-1]** THE service SHALL report agent lifecycle states `cold`,
  `starting`, `active`, `idle`, `stopping`, `failed`, and SHALL emit a
  status event (persisted/broadcast as `agent.status`,
  [chat-protocol](chat-protocol.md)) on every state change, with
  `previousState` included.
- **[ar-2]** WHEN a client attaches to a session with no live Pi session,
  THE service SHALL transition `cold → starting`, create the Pi session,
  and transition to `active`; IF creation fails, THEN it SHALL transition to
  `failed`, emit a fatal `session_start_failed` error, and surface the
  failure to the attaching client.
- **[ar-3]** THE service SHALL serialize startup per session: concurrent
  attaches to the same session SHALL share one startup and one runtime, and
  an attach while a Pi session is already live SHALL reuse it (hot resume).
- **[ar-4]** WHEN cold-resuming, THE service SHALL bootstrap from the
  manifest when present, otherwise from the provisional record; IF the Pi
  session file is missing, THEN attachment SHALL fail
  (`session file not found for <sessionId>`). The manifest's
  `rootDirectory` and `model` are authoritative on resume.
- **[ar-5]** WHEN the last client reference detaches (client references are
  counted per `clientId`; multiple sockets sharing one id are one logical
  client until all detach), THE service SHALL transition to `idle` and start
  the offload timer (`agent_idle_offload_seconds`, default 300,
  [service](service.md)).
- **[ar-6]** WHEN the offload timer fires, THE service SHALL dispose the Pi
  session and transition `stopping → cold` only when there are no connected
  clients, no active agent run, and no active tool call; otherwise it SHALL
  not offload (run/tool completion with no clients re-arms the timer). A
  client attaching cancels the timer and returns the state to `active`.

### Message delivery

- **[ar-7]** WHEN an accepted user message reaches the runtime and the Pi
  session is not streaming, THE service SHALL deliver it as a prompt;
  WHILE the Pi session is streaming, a message with `steer: true` SHALL be
  delivered via steer and a message without it SHALL be queued as a
  follow-up prompt.
- **[ar-8]** THE runtime SHALL deduplicate deliveries by `messageId`
  (independently of the protocol-level dedup) and SHALL report delivery
  failures as non-fatal `user_message_delivery_failed` errors rather than
  throwing.
- **[ar-9]** WHEN a cancel is requested for a session with a live Pi
  session, THE service SHALL call `abort()` on it and emit a non-fatal error
  event with code `cancelled` and message `Turn cancelled` (persisted as a
  `server.error` envelope plus a `RUN_ERROR` AGUI event).
- **[ar-10]** WHEN a validated model selection is applied, THE service SHALL
  set the model on the Pi session, emit the model event (persisted as
  `model.changed`), and — once a manifest exists — update the manifest's
  `model` and emit a manifest-updated event.

### Deferred manifest

- **[ar-11]** WHEN the first user message of a session is accepted, THE
  service SHALL start generating a summary from its text; WHEN the first
  assistant message completes (Pi `message_end` with role `assistant`), THE
  service SHALL write the initial manifest exactly once with the summary as
  `chatName` and `description`
  ([format](../contracts/session-files.md)) and emit a manifest-updated
  event (broadcast as `session.updated`).
- **[ar-12]** THE default summarizer SHALL be deterministic: the first line
  of the message, whitespace-collapsed, truncated to 80 characters (with a
  trailing `…` replacing the 80th character when longer, trailing spaces
  trimmed before it); an empty result falls back to `New chat`. A failing
  custom summarizer falls back to the deterministic result.
- **[ar-13]** IF the manifest write fails, THEN THE service SHALL emit a
  non-fatal `manifest_write_failed` error and continue serving the session
  (no retry: the first-assistant-completed latch stays set).

### Pi session construction

- **[ar-14]** THE service SHALL create Pi sessions with the service-local
  agent directory `data/sheaf-chat/pi-agent/`, the service-local auth
  storage and model registry ([models](models.md)), and the session's root
  directory as working directory, opening the stored Pi session file via
  Pi's `SessionManager`.
- **[ar-15]** THE service SHALL disable all global Pi resource loading for
  the session (extensions, skills, prompt templates, themes, context files)
  and register exactly two extension factories: the local-provider
  extension and the scoped-tools extension bound to the session root.
- **[ar-16]** THE service SHALL disable Pi built-in tools (`noTools:
  "builtin"`) and enable exactly the eight scoped tool names
  ([scoped-tools](scoped-tools.md)); no shell or command-execution tool is
  available to the agent.
- **[ar-17]** IF the session's configured model is not found in the
  registry at Pi-session creation or at a model switch, THEN THE operation
  SHALL fail with `model not found: <provider>/<id>`.

## Contracts

The externally observable surfaces of this capability are the
`agent.status`, `session.updated`, `model.changed`, and `server.error`
envelopes specified in [chat-protocol](chat-protocol.md), the manifest file
in [session files](../contracts/session-files.md), and the
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

- [chat-protocol](chat-protocol.md) — drives attach/detach/messages and
  persists every event this capability emits.
- [models](models.md) — registry bundle used at session creation and model
  switch.
- [scoped-tools](scoped-tools.md) — the extension registered per session.
- [agui-mapping](agui-mapping.md) — consumes the Pi events this runtime
  re-emits.
- [session files](../contracts/session-files.md) — manifest/provisional
  formats read and written here.
