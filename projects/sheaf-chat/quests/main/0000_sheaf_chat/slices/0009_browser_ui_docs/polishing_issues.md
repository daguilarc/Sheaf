# Issues

## Issue PL-0001

- status: open
- owner_role: polisher_reviewer
- created_at: 2026-06-08T23:21:41Z
- updated_at: 2026-06-08T23:21:41Z
- title: Chat screen interactive logic (sheaf-chat.js) has no behavioral test coverage
- details: ## What is wrong

The chat screen — the core deliverable of this slice — has essentially no behavioral
test coverage. `projects/sheaf-chat/src/ui/sheaf-chat.js` is ~960 lines, of which
`RenderChatScreen` (~lines 432-899) holds all the interactive protocol logic: outbound
queue/flush, WebSocket connect/reconnect, server-envelope dispatch, history
request/prepend, model selection, ack tracking, and disconnected disable/queue state.

The only tests exercising `sheaf-chat.js` are in
`projects/sheaf-chat/tests/ui/router.test.ts`, and they cover just the three pure
helpers exposed on `SheafChatApp._test`: `parseRoute`, `buildWebSocketUrl`, and
`createEnvelope`. The interactive chat orchestration is exercised by no test.

The shared renderer changes in `projects/web/src/agui-chat.js` (prependHistory,
connection state, legacy compat) ARE tested in
`projects/web/tests/agui-chat.test.mjs`, so this issue is specifically about the
service-owned chat screen logic in `sheaf-chat.js`, not the shared assets.

## Why it is a problem

The slice plan's Validation section
(`slices/0009_browser_ui_docs/physicalplan/plan.md`) explicitly requires:

> Browser/unit tests for piles-to-sessions-to-chat navigation, back navigation, send
> behavior, broadcast rendering without duplicates, lazy prepend scroll preservation,
> reconnect/missed-event request behavior, model selection frame, disconnected
> queue/disabled state, and mobile-critical DOM/classes.

Of that list, only "lazy prepend scroll preservation" (tested against
`agui-chat.js`, not the chat screen) and the navigation route parsing are covered.
The following required scenarios have no test against `sheaf-chat.js`:

- send behavior (`SubmitMessage` -> `client.user_message` frame; Enter vs Shift+Enter
  on desktop, Send button on touch)
- broadcast rendering without duplicates (the `chat.user_message` + `agui.event`
  dual-render path — currently correct only because both carry the same `messageId`
  and `role:"user"`; a regression here would silently double-render or mis-role user
  messages with nothing to catch it)
- reconnect / missed-event request behavior (`Connect` reconnect timer; `after=`
  cursor; `lastSequence` tracking and `client.ack`)
- model selection frame (`client.model_select` payload shape `{provider,id,applyTo}`)
- disconnected queue/disabled state (`QueueOrSend`/`FlushQueue`; `sendButton.disabled`
  and `--disconnected`/`--queued` classes)
- mobile-critical DOM/classes (`sheaf-chat-touch`/`sheaf-chat-desktop` toggling driving
  Send-button visibility; touch-layout Enter-inserts-newline behavior)

This is the highest-churn, most failure-prone code in the slice (stateful, async,
protocol-coupled) and it is the part with the least coverage. The dedup/role
correctness in particular depends on an invariant in a different module
(`mapUserMessageToAgui` emitting `role:"user"` with the same messageId); without a
test pinning the rendered result, a change on either side regresses silently.

## What must be true to mark this completed

Add unit/DOM tests against `projects/sheaf-chat/src/ui/sheaf-chat.js` (e.g. via the
existing `vm` + fake-DOM/fake-WebSocket harness pattern already used in
`projects/web/tests/agui-chat.test.mjs`, or by extracting the envelope-dispatch/queue
logic into testable units) that cover, at minimum:

1. Sending a user message produces a `client.user_message` envelope and does NOT locally
   echo; the message renders only when the server `chat.user_message`/`agui.event`
   broadcast arrives, and arriving via both paths for the same `messageId` renders the
   user message exactly once with `role: "user"`.
2. While disconnected, a submitted message is queued (not dropped) and the send control
   reflects disabled/queued state; on reconnect the queue flushes.
3. Reconnect builds the WebSocket URL with `after=<lastSequence>` and incoming
   sequenced envelopes drive `client.ack`.
4. Changing the model select emits a `client.model_select` frame with
   `{provider, id, applyTo}`.
5. Near-top scroll triggers a `client.history_request` with a `before` cursor only when
   more history is available and not already loading.
6. Touch vs desktop layout toggles the documented classes / Send-button visibility and
   Enter-key behavior.

Tests must run under `make sheaf-chat-test` (and/or the web test runner) and pass.
- resolution_notes: none
