# Architecture

Sheaf Chat is a Node/TypeScript Sheaf service that embeds Pi agent sessions and exposes them through a browser chat UI.

## Runtime Components

```text
Browser UI
  |
  | REST discovery and WebSocket chat
  v
Sheaf Chat HTTP server
  |
  +-- REST routes for piles, sessions, history, models, health
  +-- WebSocket route /ws/chat
  +-- static assets for service UI and shared AGUI renderer
  |
  v
AgentManager and SessionRuntime
  |
  +-- Pi session adapter
  +-- service-local auth and model registry
  +-- scoped tools extension
  +-- lifecycle events
  |
  v
Storage
  |
  +-- Pi session JSONL
  +-- Sheaf Chat envelope history JSONL
  +-- provisional session metadata
  +-- manifests
```

## Server Layer

`projects/sheaf-chat/src/server/main.ts` loads repository-local configuration, reads `config/services.json`, creates an `AgentManager`, and starts the HTTP/WebSocket server.

`projects/sheaf-chat/src/server/server.ts` owns:

- REST dispatch under `/api/`;
- WebSocket upgrades for `/ws/chat`;
- static serving for `/`, `/index.html`, `/assets/sheaf-chat/*`, and `/assets/web/*`.

The HTTP routing code is dependency-light and uses Node's `http` module plus `ws`.

## Session Identity

Every session is addressed by `(pile, sessionId)`.

A pile is a storage directory under `data/sheaf-chat/sessions/piles/`. A session id is a safe file stem inside that pile. This identity is present in REST routes, WebSocket query parameters, and every chat envelope.

## Agent Lifecycle

`AgentManager` keeps an in-memory runtime registry keyed by `(pile, sessionId)`.

Lifecycle states:

| State | Meaning |
|-------|---------|
| `cold` | Session files exist but no Pi session is attached. |
| `starting` | A Pi session is being created or resumed. |
| `active` | A Pi session is attached and can receive user messages. |
| `idle` | No clients are connected and the session is waiting for the offload timer. |
| `stopping` | The runtime is disposing the Pi session. |
| `failed` | Startup or resume failed. |

Startup is serialized per session so concurrent clients attach to the same runtime. Hot resumes reuse the active runtime. Cold resumes load either the persisted manifest or the provisional session record, then recreate the Pi session from the stored session file and root directory.

When all clients detach, `SessionRuntime` starts the idle timer. It offloads only when there are no connected clients, no active agent run, and no active tool call.

## Pi Integration

`projects/sheaf-chat/src/agents/piAdapter.ts` creates Pi sessions with:

- service-local `agentDir` under `data/sheaf-chat/pi-agent/`;
- service-local auth storage and model registry;
- no global Pi extension, skill, prompt template, theme, or context-file loading;
- Pi built-in tools disabled;
- the Sheaf Chat provider extension and scoped tools extension explicitly registered.

The local provider is OpenAI-compatible and named `local`. The provider uses `local_inference_url` and `local_inference_api_key` from repository-local config.

## Storage Model

Session storage separates Pi's session file from Sheaf Chat's protocol history.

The Pi session file is:

```text
<sessionId>.jsonl
```

Sheaf Chat frames are persisted in:

```text
<sessionId>.sheaf-history.jsonl
```

This keeps replayable browser protocol history independent of Pi's internal JSONL semantics while still preserving the Pi session file for resume.

Manifests are deliberately deferred. Creating a blank session shell is enough to open a WebSocket and send the first user message, but the manifest appears only after the first assistant message completes. This prevents abandoned blank sessions from showing as established chats.

## Protocol And Multiplexing

`SessionBroadcaster` is the bridge between a session runtime and browser clients.

It:

- initializes the latest sequence from the companion history log;
- keeps a per-session set of accepted `messageId` values for deduplication;
- serializes user-message acceptance;
- persists sequenced server envelopes;
- broadcasts accepted messages, AGUI events, model changes, status updates, manifest updates, and errors to every connected client;
- serves history pages without making live broadcasts wait for the browser's scrollback request.

On connect, the server sends `server.hello`, replays envelopes after the optional `after` cursor up to the sequence known at connection time, sends `server.caught_up`, and then sends any envelopes that arrived during the bootstrap window.

## AGUI Mapping

The Pi-to-AGUI layer maps Pi events and Sheaf Chat activity into AGUI events for the shared renderer. Known event surfaces include:

- user and assistant text messages;
- reasoning deltas;
- tool call start, arguments, result, and end;
- run start/end;
- cancellation and errors;
- lifecycle status;
- model changes;
- path enforcement activity;
- sanitized raw/custom activity for unrecognized events.

The mapper validates supported event types against the repository AGUI schema when possible and sanitizes secrets and host paths before events are persisted or sent to browsers.

## Browser UI

The service-owned browser code lives in `projects/sheaf-chat/src/ui/`.

It provides three hash-routed screens:

- piles list and pile creation;
- sessions list and blank session creation;
- chat transcript with model selection, sticky composer, reconnect, sequence acknowledgements, and lazy history loading.

The transcript rendering itself is shared with other web surfaces through `projects/web/src/agui-chat.js` and `projects/web/src/agui-chat.css`. Sheaf Chat uses that renderer's APIs to append live AGUI events, prepend snapshot history, update connection state, and mark the transcript caught up.

## Security Boundaries

The main runtime boundaries are:

- service-local config and Pi auth storage instead of global Pi state;
- `(pile, sessionId)` validation before file access;
- scoped tools bound to a canonical session root;
- no shell or arbitrary command execution tools;
- path sanitization before tool results and AGUI activity are exposed to browsers.
