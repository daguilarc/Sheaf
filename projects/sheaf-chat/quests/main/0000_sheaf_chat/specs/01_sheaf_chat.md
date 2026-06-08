# Sheaf Chat

## Quest Overview

Build Sheaf Chat as a Sheaf service for browser-based conversations with Pi agents.
The project owns:

- a Node.js backend under `projects/sheaf-chat/` that manages embedded Pi agent
  sessions;
- a Pi extension and repository-local Pi configuration used by those agents;
- a browser chat UI, extending the existing AGUI chat assets in `projects/web/`;
- session storage, manifests, pile management, provider/model selection, and a
  WebSocket protocol suitable for robust multi-client chat.

The service must be registered as `sheaf-chat` on port `9004` in
`config/services.json`.

## Reference Documentation

Implementers that are not Pi agents should still use the installed Pi
integration documentation as the authoritative source for Pi embedding,
extensions, sessions, configuration, and tool APIs:

- Pi README: `/opt/homebrew/lib/node_modules/@earendil-works/pi-coding-agent/README.md`
- Pi extension docs: `/opt/homebrew/lib/node_modules/@earendil-works/pi-coding-agent/docs/extensions.md`
- Pi SDK docs: `/opt/homebrew/lib/node_modules/@earendil-works/pi-coding-agent/docs/sdk.md`
- Pi custom providers/models docs:
  `/opt/homebrew/lib/node_modules/@earendil-works/pi-coding-agent/docs/custom-provider.md`
  and `/opt/homebrew/lib/node_modules/@earendil-works/pi-coding-agent/docs/models.md`

AGUI-related in-repo references:

- AGUI schema: `structure/schemas/ag_ui_events.schema.json`
- Existing AGUI reducer/UI: `projects/web/src/agui-chat.js` and
  `projects/web/src/agui-chat.css`
- Existing Python mapper: `projects/quest-runner/src/quest_runner_service/agui_mapper.py`
- Mapping notes: `projects/quest-runner/docs/reference/agui-mapping.md`

## Goals

- Create a Node backend that lazily creates, resumes, multiplexes, and offloads
  Pi agents.
- Persist Pi session JSONL files and companion manifests under Sheaf Chat data.
- Organize sessions into named piles and require `(pile, sessionId)` for all
  session references.
- Provide REST APIs for pile/session/model discovery and WebSocket URLs for live
  chat.
- Provide a bidirectional WebSocket protocol that carries AGUI events plus Sheaf
  Chat control messages.
- Support multiple browser WebSockets connected to the same underlying agent.
- Propagate every user message and live agent event to all clients attached to
  that session.
- Support lazy loading of older messages while keeping the browser synchronized
  with live events.
- Enforce a per-session root directory at the tools layer. The agent must not be
  able to read, write, list, execute against, or reference paths outside that
  root or its descendants.
- Make agents independent of machine/global Pi configuration. The service must
  provide all Pi config, extensions, provider configuration, and tool surfaces
  needed for each session.
- Support OpenAI subscription/OAuth and a local inference endpoint.
- Extend the existing shared AGUI chat UI for send-message, lazy history loading,
  model switching, reconnect handling, and mobile use.

## Non-Goals

- Do not depend on a developer's global `~/.pi` configuration for runtime
  behavior.
- Do not allow tools to escape the session root through absolute paths, `..`,
  symlinks, shell working-directory tricks, environment variables, or generated
  absolute path references.
- Do not require all historical messages to load before a conversation can be
  displayed.
- Do not create a second service registry outside `config/services.json`.
- Do not commit real API keys or OAuth tokens.
- Do not move project-specific Sheaf Chat UI logic into `projects/web/` unless it
  is genuinely reusable by other services.

## Project Layout

Required top-level project layout:

```text
projects/sheaf-chat/
  README.md
  Makefile
  docs/
  quests/
  src/
  tests/
```

Recommended implementation layout:

```text
projects/sheaf-chat/src/
  server/              # HTTP/WebSocket server and REST APIs
  agents/              # Pi SDK adapter, agent lifecycle, offload/resume logic
  extensions/          # Sheaf Chat Pi extension and root-scoped tools
  storage/             # piles, session manifests, JSONL/history readers
  agui/                # Pi-to-AGUI mapper if implemented in TypeScript
  ui/                  # service-owned browser page and JS
```

Shared, generic AGUI rendering improvements may be made in `projects/web/src/`.
Sheaf Chat-specific browser code should remain under `projects/sheaf-chat/src/ui/`.

## Service Registration And Configuration

Register the service in `config/services.json`:

```json
{
  "name": "sheaf-chat",
  "host": "0.0.0.0",
  "port": 9004,
  "home_path": "/",
  "command": "make sheaf-chat-run"
}
```

There is project configuration to `config/global_config.json` or another existing
repo-level non-secret config file if that file already owns service-wide knobs.
At minimum Sheaf Chat needs:

```json
{
    "local_inference_url": ".../v1"
}
```

There is a secrets in `config/api_keys.json`, with an example in
`config/api_keys.example.json`:

```json
{
  "local_inference_api_key": "..."
}
```

OpenAI OAuth data for Sheaf Chat must be stored under the project's data
directory and must not be read from global Pi configuration. The API key file may
contain bootstrap secrets or references, but persisted OAuth material belongs in
`data/sheaf-chat/auth/openai/` or an equivalent documented subdirectory.

## Data Layout

Runtime data belongs under `data/sheaf-chat/`:

```text
data/sheaf-chat/
  auth/
    openai/                 # OpenAI OAuth/subscription material
  sessions/
    piles/
      <pile>/
        <sessionId>.jsonl   # Pi session/event log
        <sessionId>.manifest.json
```

A pile is exactly one subdirectory under `data/sheaf-chat/sessions/piles/`.
Pile names must be validated as safe relative path segments. Recommended rule:
`^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$` and reject `.`, `..`, slashes, backslashes,
empty names, and names that normalize differently.

Session IDs must also be safe file stems. The server may generate them, but any
client-provided ID must be validated before use.

## Session Manifest

Each established session JSONL file must have a companion manifest at the same path stem. The manifest must not be written for a brand-new chat until after the first assistant message has completed and the short chat description has been generated or has fallen back deterministically:

```json
{
  "schemaVersion": 1,
  "pile": "default",
  "sessionId": "01J...",
  "chatName": "Fix login redirect",
  "description": "Short generated description",
  "rootDirectory": "projects/example-app",
  "createdAt": "2026-06-08T00:00:00.000Z",
  "updatedAt": "2026-06-08T00:00:00.000Z",
  "lastOpenedAt": "2026-06-08T00:00:00.000Z",
  "model": {
    "provider": "openai",
    "id": "gpt-5-codex"
  },
  "pi": {
    "sessionFile": "data/sheaf-chat/sessions/piles/default/01J....jsonl",
    "extensionVersion": "..."
  },
  "history": {
    "messageCount": 0,
    "lastSequence": 0
  }
}
```

`rootDirectory` should be stored as an absolute path when possible. On resume,
the manifest root is authoritative for constructing the scoped tools.

When a new session receives its first user message, send that message to a side
agent or summarization path to generate a short chat name/description. Do not
save the manifest yet. Wait until the first assistant message has completed,
then write the initial manifest containing the root directory, model, generated
chat name/description, and session metadata. If summarization fails, use a
deterministic fallback such as the first line of the user message, truncated.
This avoids persisting manifests for abandoned blank sessions or chats that never
produce an assistant response.

## Agent Lifecycle

The backend keeps an in-memory registry keyed by `(pile, sessionId)`.

States:

- `cold`: manifest/session file exists on disk, no Pi agent is running.
- `starting`: an agent is being created or resumed.
- `active`: an agent is running and may have zero or more WebSocket clients.
- `idle`: an active agent has no recent client or model activity and is eligible
  for offload.
- `stopping`: session state is being flushed and the agent is being released.
- `failed`: startup/resume failed; clients receive an error event.

Behavior:

- New chat: validate pile and root directory, allocate a session ID and JSONL
  session path, create a Pi agent with repository-provided config and scoped
  tools, then accept the first user message. Do not write the manifest until
  after the first assistant message completes.
- Resume hot chat: if `(pile, sessionId)` is already active, attach the WebSocket
  to that agent and replay enough recent history for the client.
- Resume cold chat: load manifest, validate the session JSONL exists, recreate
  the scoped tool environment from the manifest, resume the Pi session file, and
  attach the WebSocket.
- Offload: after `agent_idle_offload_seconds` with no connected clients and no
  active run, flush session state to disk and release the agent. Never offload in
  the middle of a tool call or agent turn.
- Reconnect: a client may reconnect to the same session and ask for events after
  its last acknowledged sequence.

## Scoped Tool Requirements

The Sheaf Chat Pi extension must provide scoped file and search tools for the
session `rootDirectory`. It must not expose Bash, shell execution, or any general
command-execution tool.

Required tools:

- `read`: same input/output shape and argument names as Pi's built-in `read`
  tool, but restricted to UTF-8 text files under the root and returning
  line-numbered excerpts with paths relativized to the root.
- `write`: same input/output shape and argument names as Pi's built-in `write`
  tool, but restricted to creating or overwriting files under the root and
  reporting only root-relative paths.
- `edit`: same input/output shape and argument names as Pi's built-in `edit`
  tool, including exact text replacement semantics, but restricted to files under
  the root and reporting only root-relative paths.
- `list`: list directory entries under the root with file type, size, and
  modified time.
- `tree`: return a bounded directory tree with ignore rules for dependency,
  build, VCS, cache, and large generated directories.
- `find_files`: ripgrep/fd-like file discovery by glob, extension, path segment,
  include/exclude globs, max depth, and limit.
- `search_text`: ripgrep-like full-text search with literal or regex modes,
  case sensitivity, include/exclude globs, context lines, multiline-safe output,
  binary-file skipping, and match limits.
- `file_info`: stat a relative path and report canonical in-root metadata.

Tool rules:

- `read`, `write`, and `edit` must preserve Pi's normal tool schema so existing
  Pi prompting and model behavior remain compatible. Only path interpretation,
  validation, and result path rendering change.
- Tool path arguments use paths relative to the root directory.
- Absolute path input is rejected unless converted to a path under the root and
  returned/displayed as relative.
- Normalize, resolve symlinks where relevant, and verify the final target remains
  inside the canonical root before every filesystem operation.
- Search tools must provide enough capability to replace normal shell `rg`,
  `find`, `ls`, and lightweight code-navigation usage without granting arbitrary
  process execution.
- Tool results must redact or relativize absolute host paths under the root.
- Tool results must not reveal parent directories or files outside the root.
- Attempts to escape the root should emit a visible AGUI activity/control event
  and be logged for audit.

## Providers And Models

Initial providers:

1. OpenAI subscription/OAuth, with OAuth data stored under `data/sheaf-chat/`.
2. Local inference, using top-level `local_inference_url` from
   `config/global_config.json` and top-level `local_inference_api_key` from
   `config/api_keys.json`.

The model list exposed to browsers must merge:

- GPT/OpenAI models available through the configured OpenAI subscription; and
- models reported by or configured for the local inference endpoint.

The server should expose model metadata indicating provider, model ID, display
name, context capability if known, and whether the model is currently available.

## REST API

All JSON responses should include stable machine-readable errors:

```json
{ "error": { "code": "not_found", "message": "..." } }
```

Required endpoints:

- `GET /api/health` — service health and version.
- `GET /api/piles` — list piles with session counts and latest update time.
- `POST /api/piles` — create a pile. Body: `{ "pile": "name" }`.
- `GET /api/piles/:pile/sessions` — list session manifests in a pile, newest
  first, excluding heavy message history.
- `GET /api/piles/:pile/sessions/:sessionId` — return one manifest.
- `POST /api/piles/:pile/sessions` — create a new blank session shell. Body
  includes `{ "rootDirectory": "...", "model": { "provider": "...", "id": "..." } }`.
  Response includes `sessionId`, provisional session metadata, and WebSocket URL,
  but not a persisted manifest. The manifest is written only after the first
  assistant message completes. The first user message may be sent over the
  WebSocket rather than this REST call.
- `GET /api/piles/:pile/sessions/:sessionId/history?before=<cursor>&limit=<n>` —
  optional REST fallback for paged history if WebSocket history is not available.
- `GET /api/models` — list available models.

The browser should normally use WebSocket history requests, but the REST history
fallback is useful for testing and recovery.

## WebSocket Protocol

### URL And Connection

Use one WebSocket route for both new and resumed sessions:

```text
/ws/chat?p=<pile>&session=<sessionId>&client=<clientId>&after=<sequence>
```

For a newly-created blank session, the client first calls
`POST /api/piles/:pile/sessions`, then opens this WebSocket and sends the first
`client.user_message`.

Query parameters:

- `p` / `pile` (required): pile name.
- `session` (required): session ID.
- `client` (optional): stable browser client ID for reconnect diagnostics.
- `after` (optional): last server sequence the client has processed. If present,
  server sends all available envelopes after that sequence before live mode.

All WebSocket frames are UTF-8 JSON objects. Binary frames are not required for
quest zero.

### Envelope

Every server-to-client and client-to-server frame uses this envelope:

```ts
type ChatEnvelope = {
  v: 1;
  kind: string;
  id: string;              // unique frame id generated by sender
  pile: string;
  sessionId: string;
  clientId?: string;
  sequence?: number;       // server-assigned monotonically increasing sequence
  timestamp: string;       // ISO-8601
  payload?: unknown;
};
```

Server-assigned `sequence` values are strictly increasing per session and are the
basis for replay, acknowledgements, and lazy loading. Client frames do not set
`sequence`.

### Server-To-Client Kinds

#### `server.hello`

First frame after a successful connection.

```json
{
  "kind": "server.hello",
  "payload": {
    "connectionId": "...",
    "manifest": null,
    "provisionalSession": {
      "rootDirectory": "projects/example-app",
      "model": { "provider": "openai", "id": "gpt-5-codex" }
    },
    "latestSequence": 123,
    "historyWindow": { "oldestSequence": 80, "newestSequence": 123 },
    "models": [],
    "activeModel": { "provider": "openai", "id": "gpt-5-codex" }
  }
}
```

#### `history.page`

A page of historical AGUI events or snapshot messages. Sent in response to
`client.history_request` and optionally during connection bootstrap.

```json
{
  "kind": "history.page",
  "payload": {
    "requestId": "client-frame-id",
    "direction": "before",
    "events": [ { "type": "TEXT_MESSAGE_START" } ],
    "messages": [ { "id": "...", "role": "user", "content": "..." } ],
    "oldestSequence": 1,
    "newestSequence": 50,
    "hasMoreBefore": false,
    "hasMoreAfter": true
  }
}
```

The server may send either AGUI events or AGUI-compatible message snapshots. If
snapshots are sent, they must match message shapes accepted by
`projects/web/src/agui-chat.js`.

#### `agui.event`

One AGUI event mapped from Pi output or generated by Sheaf Chat.

```json
{
  "kind": "agui.event",
  "sequence": 124,
  "payload": {
    "type": "TEXT_MESSAGE_CONTENT",
    "messageId": "assistant-1",
    "delta": "Hello"
  }
}
```

`payload` must validate against `structure/schemas/ag_ui_events.schema.json` when
possible. Preserve raw Pi events in `rawEvent` for debugging unless they contain
secrets or host-only paths.

#### `chat.user_message`

Broadcast copy of an accepted user message. The originating client receives this
too, so all clients render identical user turns.

```json
{
  "kind": "chat.user_message",
  "sequence": 125,
  "payload": {
    "messageId": "user-...",
    "text": "Please inspect src/app.ts",
    "attachments": [],
    "steer": true
  }
}
```

The server should also emit equivalent AGUI text message events so generic AGUI
reducers can display the message.

#### `session.updated`

Manifest or session metadata changed, such as initial manifest creation after the
first assistant message, generated chat name, root display, message count, or
active model.

#### `model.changed`

The active model changed for future turns or, if Pi supports it, for the current
run.

#### `agent.status`

Lifecycle/status update. Payload examples: `{ "state": "starting" }`,
`{ "state": "active" }`, `{ "state": "offloading" }`,
`{ "state": "resumed" }`.

#### `server.caught_up`

The server has finished replaying requested backlog and subsequent frames are
live. This mirrors the existing Quest Runner dashboard behavior.

#### `server.error`

Recoverable or fatal error.

```json
{
  "kind": "server.error",
  "payload": {
    "code": "root_escape_denied",
    "message": "Path is outside the session root",
    "fatal": false,
    "requestId": "..."
  }
}
```

#### `server.pong`

Response to `client.ping`.

### Client-To-Server Kinds

#### `client.hello`

Optional client capabilities after socket open.

```json
{
  "kind": "client.hello",
  "payload": {
    "supportsSnapshots": true,
    "supportsLazyHistory": true,
    "lastSeenSequence": 123
  }
}
```

#### `client.user_message`

Submit a user message.

```json
{
  "kind": "client.user_message",
  "payload": {
    "messageId": "client-generated-id",
    "text": "Continue, but use the local model.",
    "attachments": [],
    "steer": true
  }
}
```

Rules:

- The server validates, persists, sequences, and broadcasts the message before or
  while delivering it to the agent.
- If an agent turn is already running, the new message must steer the ongoing
  conversation if Pi supports steering/queueing. If Pi cannot steer mid-turn, the
  message must be queued as the next user input and all clients must still see it
  immediately.
- The server must de-duplicate by `messageId` for reconnect/retry safety.

#### `client.history_request`

Request older or newer events/messages.

```json
{
  "kind": "client.history_request",
  "payload": {
    "before": 80,
    "after": null,
    "limit": 50,
    "prefer": "snapshots"
  }
}
```

Supported modes:

- `{ "before": sequence }`: page older history for scroll-up loading.
- `{ "after": sequence }`: replay missed events after reconnect.
- no cursor: return latest page large enough to populate the screen.

The server responds with `history.page` and must not block live `agui.event`
broadcasts while reading history.

#### `client.model_select`

Switch model.

```json
{
  "kind": "client.model_select",
  "payload": {
    "provider": "local",
    "id": "qwen3-coder",
    "applyTo": "next_turn"
  }
}
```

If AGUI later standardizes model selection, this control message may be mapped to
that standard, but the Sheaf Chat protocol must support it now. The server
validates availability, updates the manifest, broadcasts `model.changed`, and
applies the change to Pi according to SDK capabilities.

#### `client.ack`

Acknowledge processed server sequence.

```json
{ "kind": "client.ack", "payload": { "sequence": 125 } }
```

Acks are used for diagnostics and reconnect hints. They are not required for
exactly-once delivery.

#### `client.cancel` / `client.stop_generating`

Request cancellation of the current agent turn if supported. The server
broadcasts status and emits AGUI lifecycle close/error events as needed.

#### `client.ping`

Keepalive. Server responds with `server.pong`.

### Ordering And Synchronization

- The server assigns sequence numbers after accepting an event for a session.
- All attached clients receive frames in sequence order for that session.
- User messages are persisted and broadcast even if the agent later fails.
- Agent output events are broadcast to all current clients and appended to the
  session log/history index.
- On reconnect, the client supplies `after=<lastSequence>` or sends
  `client.history_request` with `after`. The server replays missed frames, sends
  `server.caught_up`, then continues live.
- When multiple clients send user messages concurrently, the server serializes
  them by acceptance time and sequence number. That sequence is the conversation
  order.

### AGUI Mapping Requirements

The server may either:

1. reuse the existing Python mapping logic through a subprocess/module boundary;
   or
2. implement an equivalent TypeScript mapper for Pi JSON events.

A TypeScript mapper is preferred for a Node-only backend if it can be tested
against the existing AGUI schema. Required mapped surfaces include:

- user text messages;
- assistant text stream start/content/end;
- reasoning/thinking deltas where Pi exposes them;
- tool call start/arguments/result/end;
- run/turn start, finish, cancellation, and errors;
- custom Sheaf Chat activity events for path enforcement, model changes, and
  lifecycle status.

Unrecognized Pi events must not be dropped. Emit an AGUI `RAW` or custom
activity event with sanitized payload and add tests so known Pi event forms map
cleanly over time.

## Browser UI Requirements

Extend the existing shared AGUI chat assets without breaking their current
read-only uses.

The browser UI has three primary screens with straightforward navigation:

1. Piles screen: the top-level screen lists piles and includes controls to create
   a pile.
2. Sessions screen: selecting a pile shows sessions in that pile and includes
   controls to start a new session in that pile.
3. Chat screen: selecting a session opens the chat for that `(pile, sessionId)`.

Each screen must provide a clear way to go back to the previous screen. The chat
screen goes back to the sessions list for its pile; the sessions screen goes back
to the piles list. Browser history/back-button behavior should match this screen
navigation where practical.

Required capabilities:

- render the piles screen from `GET /api/piles`;
- render the sessions screen from `GET /api/piles/:pile/sessions`;
- render AGUI event streams and message snapshots on the chat screen;
- open a WebSocket for a selected `(pile, sessionId)`;
- show connection/agent/model status;
- on desktop, send text messages with Enter and support multiline input with
  Shift+Enter;
- on mobile/touch layouts, Enter should insert a newline and sending should use
  an explicit in-app Send button rather than relying on the keyboard Enter key;
- disable or visibly queue sends while disconnected;
- render user messages from server broadcasts rather than relying only on local
  echo;
- lazy-load older history when the user scrolls near the top;
- preserve scroll position when prepending older history;
- request a latest history page on initial load large enough to fill the viewport;
- reconnect with last seen sequence and request missed events;
- expose model selection and send `client.model_select`;
- handle multiple connected clients without duplicate local rendering;
- render tool calls and reasoning in compact expandable blocks;
- work well on mobile screens.

Mobile requirements:

- responsive single-column layout;
- composer fixed or sticky at the bottom without hiding the last message;
- touch-friendly controls with at least 44px hit targets;
- textarea grows to a reasonable maximum height;
- avoid horizontal overflow for code, tool args, and long paths;
- tolerate virtual keyboard viewport changes;
- keep pile/session navigation usable on narrow screens.

Existing uses of `projects/web/src/agui-chat.js` that only feed a read-only AGUI
stream must continue to work. Add new APIs as optional extensions rather than
requiring all consumers to provide WebSocket send/history handlers.

## Testing Requirements

Backend tests should cover:

- pile/session path validation;
- deferred manifest creation only after the first assistant message, followed by update and resume;
- cold resume from JSONL plus manifest;
- hot resume attaching multiple WebSockets;
- user message broadcast to all clients including sender;
- reconnect replay by sequence;
- lazy history pages before/after cursors;
- model list and model switch validation;
- root-directory escape denial for scoped tools;
- offload eligibility and prevention during active runs.

Mapper tests should validate emitted AGUI events against
`structure/schemas/ag_ui_events.schema.json` and include representative Pi event
fixtures. The Pi JSONL file for this specification-writing session is:

```text
/Users/joyo/.pi/agent/sessions/--Users-joyo-.quest-worktrees-sheaf-chat_main_0000_sheaf_chat--/2026-06-08T18-00-45-960Z_019ea864-e887-75ab-8dc9-6c98119a189d.jsonl
```

That session JSONL may be copied into the repository as a test fixture, for
example under `projects/sheaf-chat/tests/fixtures/pi-sessions/`, and used to test
cold resume, manifest generation, history pagination, and Pi-to-AGUI mapping.

Browser tests should cover:

- piles-to-sessions-to-chat navigation and back navigation;
- send-message UI behavior;
- incoming broadcast rendering without duplicates;
- lazy prepend preserving scroll position;
- reconnect/missed-event request behavior;
- mobile layout-critical class/DOM behavior where practical.

## Documentation Requirements

Update `projects/sheaf-chat/README.md` and `projects/sheaf-chat/docs/README.md`
with:

- how to run the service;
- data/config paths;
- REST and WebSocket protocol summaries;
- provider/model setup;
- root-scoped tool security model;
- links to the Pi docs listed above.
