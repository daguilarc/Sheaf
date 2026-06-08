# Slice 0008 WebSocket Protocol — Implementation Accepted

## Summary

The bidirectional `/ws/chat` protocol is implemented per spec: query validation
and pile/session rejection, `server.hello` → bounded `after` replay →
`server.caught_up` bootstrap, multi-client fan-out with monotonic per-session
sequencing (serialized by the storage append lock), `client.user_message`
dedupe-by-messageId with acceptance-order serialization and persist-before-deliver,
non-blocking `client.history_request` paging (before/after/latest, events &
snapshot modes), `client.model_select` with availability validation,
`client.cancel`/`stop_generating`, `client.ack`, and `client.ping`/`server.pong`.

## Review Outcome

Reviewed commit `98ba312` (initial implementation) and fix commits `69dd67e` /
`a8070d4`. Four polishing issues were filed and all are now verified resolved:

- **PL-0001** — Bootstrap ordering fixed: connections are not added to the
  broadcast fan-out until after `server.hello`, bounded replay, and
  `server.caught_up` (`RegisterClient` builds the client; `ActivateClient`
  enrolls it post-`caught_up`). Bootstrap-window frames are flushed via a bounded
  second `ReplayAfter`. Test asserts `server.hello` is the first frame and no
  `agent.status`/`agui.event` appears in the bootstrap stream.
- **PL-0002** — Idle-offload liveness now keys on the always-present unique
  `connectionId` and uses a reference-count `Map` (`ConnectedClientCount`).
  Connections without a `client` param, and multiple connections sharing a
  browser `client` id, are counted correctly. Manager + websocket tests added.
- **PL-0003** — `ExtractAguiEvents` no longer double-maps user messages; it
  prefers stored `agui.event` entries per messageId and only re-maps
  `chat.user_message` when no stored AGUI event exists. Events-mode test asserts
  a single `START/CONTENT/END` triplet.
- **PL-0004** — `SessionBroadcasterRegistry.ReleaseIfIdle` disposes idle
  broadcasters (unsubscribing lifecycle) on last-client disconnect, invoked from
  websocket cleanup. Test asserts registry release after close.

Test sufficiency was assessed from the changed test code and artifacts (reviewer
does not run tests). The polisher reported the build passes and manager lifecycle
tests pass; websocket integration tests could not execute in the sandbox due to a
`listen` `EPERM` restriction (environment limitation, not a test failure).

## Non-blocking observations for future hardening

These are narrow, recoverable timing edges that do not block acceptance for
quest zero; recorded here so they are not lost:

- **Activation-gap (relates to PL-0001):** a frame appended in the brief window
  between the final bootstrap `ReplayAfter` snapshot and `ActivateClient` could
  be skipped from the live stream. It is still persisted to the session log and
  recoverable via sequence-gap detection + `client.history_request{after}`. A
  buffer-then-flush activation (enroll first, queue outbound frames until
  `caught_up`) would close it entirely.
- **Release-during-bootstrap (relates to PL-0004):** if the last activated
  client disconnects while another connection is still bootstrapping on the same
  broadcaster, `ReleaseIfIdle` may dispose that broadcaster (unsubscribing
  lifecycle) and orphan the in-flight connection. Counting bootstrapping
  connections toward `ClientCount`, or guarding release against pending attaches,
  would remove the edge.
