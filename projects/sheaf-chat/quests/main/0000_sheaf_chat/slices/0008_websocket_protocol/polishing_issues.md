# Issues

## Issue PL-0001

- status: open
- owner_role: polisher_reviewer
- created_at: 2026-06-08T22:58:10Z
- updated_at: 2026-06-08T22:58:10Z
- title: Live frames can precede server.hello / interleave replay before server.caught_up
- details: ## Problem

A newly-connected client is added to the broadcast set **before** `server.hello`,
the `after` replay, and `server.caught_up` are sent, so live frames can be
delivered out of the spec-mandated order.

In `AttachChatWebSocketConnection` (`src/server/websocket.ts`):

```
const client = broadcaster.RegisterClient(socket, params.clientId); // joins m_clients now
await SendHello(client, ...);            // awaits attachSession + HistoryWindow (file I/O)
await SendReplayAndCaughtUp(client, ...) // awaits replay then sends caught_up
```

`RegisterClient` inserts the socket into `m_clients`, and
`SessionBroadcaster.Broadcast` fans out to every entry in `m_clients`. Because
`SendHello` / `SendReplayAndCaughtUp` contain multiple `await`s, any lifecycle
event that fires during that window (`agent.status`, `agui.event`,
`model.changed`, `session.updated`, `server.error`) is broadcast to the new
socket before `server.hello` and/or interleaved with replay before
`server.caught_up`.

This is not just a hot-attach edge case: for a brand-new session, `SendHello`
calls `agentManager.attachSession`, which starts the runtime and synchronously
emits `Starting`/`Active` status transitions. The broadcaster's status handler
persists+broadcasts `agent.status` frames during `attachSession`, so the very
first frames a fresh client receives can be `agent.status` before
`server.hello`.

## Why it is a problem

The spec is explicit:
- `server.hello` is "the first frame after a successful connection."
- `server.caught_up` means "the server has finished replaying requested backlog
  and subsequent frames are live."

Delivering live `agent.status`/`agui.event` frames before `server.hello`, or
interleaving them into the replay window before `server.caught_up`, breaks the
client bootstrap contract (connectionId/models/historyWindow must arrive first;
backlog must be bounded by caught_up). It can also double-deliver an envelope
that is both broadcast live and included in the `after` replay read.

The existing test "WebSocket connection sends server.hello then
server.caught_up" does NOT catch this: it locates hello with
`bootstrap.find(...)` rather than asserting it is the first frame, so a status
frame arriving before hello still passes.

## What must be true to close

- A connection must not receive any broadcast frame until after `server.hello`
  and `server.caught_up` have been sent to it (e.g. register into the broadcast
  set only after caught_up, or buffer/queue outbound frames during bootstrap and
  flush them after caught_up).
- `server.hello` is guaranteed to be the first frame; no live frame precedes it
  and no live frame is interleaved into the replay window before
  `server.caught_up`.
- A test asserts ordering explicitly: hello is the first frame, and for a
  session with active lifecycle emissions during attach, no `agent.status` /
  `agui.event` frame is observed before `server.hello` or between the start of
  replay and `server.caught_up`.
- resolution_notes: none

## Issue PL-0002

- status: open
- owner_role: polisher_reviewer
- created_at: 2026-06-08T22:58:23Z
- updated_at: 2026-06-08T22:58:23Z
- title: Idle-offload accounting keyed on optional client id can offload agent under a live socket
- details: ## Problem

WebSocket connection liveness (which drives idle offload of the agent) is
tracked by the optional `client` query parameter, not by the actual socket
connection.

Flow:
- `AttachChatWebSocketConnection` -> `SendHello` -> `agentManager.attachSession(pile, sessionId, clientId)`
  -> `SessionRuntime.AttachClient(clientId)`.
- On socket close -> `agentManager.markClientDetached(key, clientId)` ->
  `SessionRuntime.DetachClient(clientId)`.

`SessionRuntime.AttachClient`/`DetachClient` only mutate `m_record.clients`
when `clientId !== undefined && clientId.length > 0`. The idle-offload
scheduler (`ScheduleIdleOffload`, `CanOffload`) gates entirely on
`m_record.clients.size === 0`.

The slice spec marks `client` as optional:
"client (optional): stable browser client ID for reconnect diagnostics."

Consequences:
1. A connection opened without a `client` param never increments
   `m_record.clients`, so the runtime believes zero clients are attached. After
   `agent_end` (or immediately on the idle path) `ScheduleIdleOffload` runs and
   the agent is torn down (pi session disposed, state -> Cold) while the
   WebSocket is still open and live.
2. Two connections sharing the same `client` id are stored once in the Set;
   closing one removes the id even though the other is still connected,
   triggering premature offload.

## Why it is a problem

The agent can be offloaded out from under an active, connected client whenever
the optional `client` param is absent or shared. The spec's intent is that idle
offload happens when there are no connected WebSockets, not no client ids.
While a subsequent `client.user_message` will re-attach via cold resume, the
disposal causes unnecessary churn and loss of in-flight streaming state for a
client that never disconnected.

## What must be true to close

- Idle-offload accounting reflects the number of live WebSocket connections for
  `(pile, sessionId)`, independent of whether/what `client` param was supplied
  (e.g. count connections by `connectionId`, or have the broadcaster's
  connection count drive offload).
- A connection that omits `client` keeps the agent active for as long as the
  socket is open; offload only occurs after the last socket for the session
  closes (plus idle timeout).
- A test covers attach/detach with no `client` param (and/or two connections
  sharing a `client` id) and asserts the agent is not offloaded while a socket
  remains connected.
- resolution_notes: none

## Issue PL-0003

- status: open
- owner_role: polisher_reviewer
- created_at: 2026-06-08T22:58:25Z
- updated_at: 2026-06-08T22:58:25Z
- title: history.page events mode duplicates user messages (chat.user_message re-mapped on top of stored agui.event)
- details: ## Problem

`ExtractAguiEvents` in `src/protocol/sessionBroadcaster.ts` double-counts user
messages when building `history.page` payloads, producing duplicate user turns
in `prefer: "events"` mode.

For every history envelope it does:
- if `kind === "agui.event"`: push the stored AGUI payload, and
- if `kind === "chat.user_message"`: push `mapUserMessageToAgui(...)` of the
  same message.

But `ProcessUserMessage` persists BOTH a `chat.user_message` envelope AND the
mapped `agui.event` envelopes (TEXT_MESSAGE_START/CONTENT/END) for that same
user message. So for a session produced by the live flow, the history log
contains both representations, and `ExtractAguiEvents` emits the user
message's text events twice.

In `HandleHistoryRequest`, when `prefer === "events"` the raw (duplicated)
event list is returned directly in `payload.events`. (In the default
`snapshots` mode the duplication is masked because `eventsToSnapshots` dedups
by `messageId`.)

## Why it is a problem

A client requesting history in events mode (`prefer: "events"`, a supported
mode) renders each user turn twice on scroll-up / reconnect-after paging. The
existing test "client.history_request returns history.page for before and after
cursors" does not catch this because its history is hand-seeded with
`chat.user_message` entries only (no accompanying `agui.event` entries), so the
double-mapping path is never exercised against a realistic live-produced log.

## What must be true to close

- For a session whose log was produced by the normal user-message flow (both
  `chat.user_message` and its mapped `agui.event` entries present), a
  `history_request` with `prefer: "events"` returns each user message's text
  events exactly once (no duplication).
- The fix chooses a single source of truth for user-message events in history
  extraction (use the stored `agui.event` entries, or re-map from
  `chat.user_message`, but not both).
- A test seeds a log containing both `chat.user_message` and its
  `agui.event` entries and asserts the events-mode page has no duplicated user
  turn.
- resolution_notes: none

## Issue PL-0004

- status: open
- owner_role: polisher_reviewer
- created_at: 2026-06-08T22:58:26Z
- updated_at: 2026-06-08T22:58:26Z
- title: SessionBroadcasterRegistry never releases broadcasters/lifecycle subscriptions for idle sessions
- details: ## Problem

`SessionBroadcasterRegistry` never removes a broadcaster once created. Entries
are only dropped in `Remove(key)` (never called anywhere in the slice) and in
`Dispose()` (full server shutdown).

`GetOrCreate` creates a `SessionBroadcaster` per `(pile, sessionId)` and the
constructor subscribes to five lifecycle channels (`agentEvent`, `model`,
`status`, `manifestUpdated`, `error`). When all clients of a session
disconnect, `RemoveClient` clears `m_clients` but the broadcaster stays
registered and stays subscribed; the underlying agent may even offload to Cold
while the broadcaster lingers.

## Why it is a problem

For a long-running server, every distinct `(pile, sessionId)` ever connected
accumulates a permanent broadcaster with five live lifecycle subscriptions.
This is a slow resource leak and a growing per-emit fan-out: each lifecycle
emit invokes the key-filter handler of every broadcaster ever created, not just
the active ones. It is not a functional bug for quest zero, but it is an
unbounded-growth maintainability concern.

## What must be true to close

- Broadcasters for idle/cold sessions with zero connected clients are released
  (lifecycle subscriptions unsubscribed, registry entry removed), or a clear
  justification is documented for retaining them (e.g. dedupe-id memory needed
  across reconnects) along with a bound on growth.
- If retained intentionally, document why `Remove` is never invoked and confirm
  the lifecycle fan-out cost is acceptable.
- resolution_notes: none
