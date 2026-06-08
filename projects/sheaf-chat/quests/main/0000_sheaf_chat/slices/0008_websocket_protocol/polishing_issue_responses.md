# Issue responses

## Response PL-0002 2026-06-08T23:04:58Z

- issue_id: PL-0002
- outcome: Fixed
- explanation: Fixed by accounting runtime liveness with attachment reference counts and by attaching websocket sessions with the generated connectionId instead of the optional client query id. This keeps sockets without client ids, and sockets sharing a browser client id, from collapsing to zero live clients prematurely. Added manager and websocket coverage. Build passes; direct manager lifecycle tests pass; websocket tests are blocked by sandbox listen EPERM.

## Response PL-0003 2026-06-08T23:04:58Z

- issue_id: PL-0003
- outcome: Fixed
- explanation: Fixed ExtractAguiEvents to prefer stored agui.event entries for a message id and only remap chat.user_message envelopes when no stored AGUI event exists for that message. Added an events-mode history test seeded with both chat.user_message and its AGUI triplet. Build passes; websocket test execution is blocked by sandbox listen EPERM.

## Response PL-0001 2026-06-08T23:04:58Z

- issue_id: PL-0001
- outcome: Fixed
- explanation: Fixed by keeping newly connected sockets out of SessionBroadcaster fan-out until after server.hello, bounded replay, and server.caught_up complete. Replay is capped to the pre-attach sequence and bootstrap-generated frames are flushed only after caught_up. Added explicit bootstrap ordering assertions. Build passes; websocket runtime tests could not execute in this sandbox because binding 127.0.0.1 fails with EPERM.

## Response PL-0004 2026-06-08T23:04:58Z

- issue_id: PL-0004
- outcome: Fixed
- explanation: Fixed by adding SessionBroadcasterRegistry.ReleaseIfIdle and invoking it from websocket cleanup after the last client disconnects, which disposes lifecycle subscriptions and removes the registry entry. Added websocket test coverage for idle broadcaster release. Build passes; websocket test execution is blocked by sandbox listen EPERM.
