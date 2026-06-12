# Architecture

Sheaf Chat is a Node/TypeScript service (ES modules, Node >= 20) that embeds
Pi agent sessions (`@earendil-works/pi-coding-agent`) and exposes them to
browsers. It has no web framework: routing is hand-rolled on Node's `http`
module, with `ws` for WebSocket upgrades and `typebox` for tool parameter
schemas.

## Component overview

```text
Browser UI (src/ui + shared projects/web/src/agui-chat.js)
  |        REST discovery + file API    WebSocket /ws/chat
  v                                          v
HTTP server (src/server)  ---------  per-session protocol pair (src/protocol)
  routes/, files/, static.ts, websocket.ts
                                       SessionPersistenceHub  (persist + fan-out)
  |                                    SessionBroadcaster     (socket + file fan-out)
  v                                          |
AgentManager (src/agents)  <-----------------+
  SessionRuntime (lifecycle, idle offload)
  piAdapter (Pi session construction)
  models/auth/localProvider (registry)
  |
  +-- scoped tools extension (src/extensions/sheaf-chat)
  +-- Pi -> AGUI mapping (src/agui)
  v
Storage (src/storage)  -> data/sheaf-chat/sessions/piles/<pile>/...
```

## Server layer

`src/server/main.ts` loads repository-local configuration
(`src/server/config.ts`), reads `config/services.json`
(`src/server/service_registry.ts`), fails fast if the `sheaf-chat` entry is
missing, creates one `AgentManager`, and starts the combined HTTP/WebSocket
server (`src/server/server.ts`). The repository root is discovered by walking
up from the working directory until a directory containing both
`config/services.json` and `structure/` is found (`src/server/repo_paths.ts`).

`server.ts` dispatches in order: `/health` (conductor-compatible liveness),
`/api/*` (REST router in `src/server/router.ts` + `src/server/routes/`),
everything else static (`src/server/static.ts`). WebSocket upgrades are
validated *before* the socket is opened; validation failures are rejected as
plain HTTP responses on the upgrade socket.

## Session identity and storage

Every session is addressed by `(pile, sessionId)`. A pile is a directory
under `data/sheaf-chat/sessions/piles/`; a session id is a safe file stem
inside it. Four sibling files per session share the stem: the Pi session
JSONL, the Sheaf envelope history JSONL, a provisional JSON record, and the
manifest JSON ([session files](contracts/session-files.md)).

The key design decision is separating Pi's own session file (replayed by Pi's
`SessionManager` on resume) from Sheaf Chat's envelope history (replayed to
browsers). Browser protocol history survives Pi-internal format changes, and
Pi resume does not depend on browser frames.

Manifests are deliberately deferred: creating a blank session shell is enough
to open a WebSocket and send the first message, but the manifest — including
the summarizer-generated chat name — is written only after the first
assistant message completes. Abandoned blank sessions therefore never appear
in session lists (listing scans `*.manifest.json` only).

## Protocol pair: persistence hub and broadcaster

For each session with at least one connected client the server keeps a
`SessionPersistenceHub` and a `SessionBroadcaster`
(`src/protocol/sessionPersistenceHub.ts`, `sessionBroadcaster.ts`).

The hub is the single writer: it subscribes to `AgentManager` lifecycle
events, maps them to envelopes (Pi events through a per-session
`PiToAguiMapper`), appends them to the history log with strictly increasing
sequence numbers, and publishes each persisted envelope to subscribers. It
also serializes user-message acceptance and deduplicates by `messageId`.

The broadcaster fans persisted envelopes out to connected sockets and serves
replay and history-page requests. Hubs live in a registry for the process
lifetime; broadcasters are released when their last client disconnects. The
connect handshake (hello → replay → caught_up → live) is specified in
[chat-protocol](../../../openspec/specs/sheaf-chat-chat-protocol/spec.md).

## Agent runtime

`AgentManager` (`src/agents/manager.ts`) keeps an in-memory `SessionRuntime`
registry keyed by `(pile, sessionId)`. Startup is serialized per session so
concurrent clients share one runtime; hot resume reuses an attached Pi
session; cold resume bootstraps from the manifest (or the provisional record
when no manifest exists) and recreates the Pi session from the stored session
file. When the last client detaches, an idle timer offloads (disposes) the Pi
session after `agent_idle_offload_seconds`, but only when no run or tool call
is active. Files stay on disk; the next attach cold-resumes.

`src/agents/piAdapter.ts` constructs Pi sessions hermetically: service-local
`agentDir` (`data/sheaf-chat/pi-agent/`), service-local auth storage and
model registry, all global Pi resource loading disabled (`noExtensions`,
`noSkills`, `noPromptTemplates`, `noThemes`, `noContextFiles`), built-in Pi
tools disabled, and exactly two extensions registered: the local-provider
extension and the scoped-tools extension bound to the session's root
directory. A path guard refuses any auth path containing `/.pi/` so a
developer's global Pi state can never leak into the service.

## AGUI mapping

`src/agui/` converts Pi `AgentSessionEvent`s and Sheaf-side activity into
AGUI events for the shared renderer, buffering open runs/messages/tools so
streamed deltas become well-formed start/content/end triples. A sanitizer
redacts secret-looking strings and relativizes absolute paths under the
session root before anything is persisted or sent to a browser.
`eventsToSnapshots` reduces an AGUI event list to message snapshots for lazy
history loading. The event vocabulary is the repository schema
`structure/schemas/ag_ui_events.schema.json`.

## Browser UI

`src/ui/sheaf-chat.js` is a dependency-free IIFE with three hash-routed
screens (piles, sessions, chat). The chat screen embeds a session-root file
workspace: non-touch layouts render explorer/file/chat panes, touch layouts
render the file view with pull-out explorer, tabs, and chat panels. Transcript
rendering is delegated to the shared `projects/web/src/agui-chat.js` renderer
(`window.ChatView`), which the server serves at `/assets/web/`. File and
message Markdown rendering use `src/ui/sheaf-markdown.js` with Markdown-it
and KaTeX assets served from `/assets/vendor/`. The chat screen reconnects
automatically with the last processed sequence and queues outbound frames
while disconnected.

## Session file browser

`src/server/files/sessionBrowser.ts` exposes read-only file browsing for the
root directory recorded in a session's manifest or provisional record. It
reuses the scoped-tools root policy, canonicalizes the root with `realpath`,
rejects absolute paths, parent traversal, NUL bytes, and symlink escapes, and
returns only root-relative paths. The REST router serves whole-file reads at
`/api/piles/:pile/sessions/:sessionId/file` and directory listings at
`/api/piles/:pile/sessions/:sessionId/files`.

The scoped `edit` tool calls a file-change callback only after a successful
write. `CreateSheafChatServer` wires that callback to
`SessionBroadcasterRegistry.BroadcastFileChanged`, which canonicalizes the
changed path once and asks each active broadcaster to emit a receiver-relative
`file.changed` envelope when the changed path is inside that session's root.
The event is live-only and is not appended to the history log.

## Security boundaries

- Service-local config and Pi auth storage; global `~/.pi` paths rejected.
- `(pile, sessionId)` validated as safe single path segments before any file
  access; storage paths additionally asserted under the piles root.
- Scoped tools resolve every path through a `RootPolicy` pinned to the
  canonical (realpath) session root; no shell or process execution tools.
- File-browser REST paths use the same root-policy containment checks and do
  not expose writes, diffs, partial reads, or absolute paths.
- Tool results and AGUI payloads are sanitized (secret redaction, path
  relativization) before leaving the server.
