# Slice 0002 — Response Queue and Tool Follow-up Responses

## Objective

Make the realtime-agent track whether a model response is currently active and
coordinate response-affecting outbound events through an in-memory queue with
configurable policy. After this slice, callers can issue
`createResponse()`/`commitAudioAndCreateResponse()`/`sendTextMessage(...,
{ createResponse: true })`/`sendStructuredContext(..., { createResponse: true
})` while a response is already running, and the agent will enqueue, reject,
or cancel-current per their `queuePolicy`.

This slice also gives `ToolDispatcher` a configurable follow-up policy so it
can request a model response after sending a tool's `function_call_output`.
That follow-up `response.create` flows through the same queue, so tool-driven
turns coexist cleanly with caller-driven turns.

This completes Spec 01's queue semantics so the VS Code extension never has
to think about whether the model is busy, and it satisfies Spec 02's "send
result, then request another response" rule for navigation/read tools.

## Scope

In scope:

- A new `ResponseQueue` component owned by `RealtimeAgentSessionImpl`.
- Tracking response-active state via incoming server events.
- Wiring queue logic into the Session API methods introduced in slice 0001.
- `QueuedEventResult` returns realistic statuses (`sent`, `queued`,
  `rejected`, `cancelled`).
- Optional `queuePolicy` defaulting to `enqueue`.
- Behavior for `response.cancel` issued explicitly via `sendRealtimeEvent`
  remains a transparent pass-through (per spec).
- A new `ToolDispatcher` option `responseAfterOutput` (default `"never"`,
  opt-in `"always"`) that, when set, queues a `response.create` after each
  successful or error tool output. Routed through the queue introduced in
  this slice.
- A new `AgentStartConfig.responseAfterToolOutput` flag that
  `startAgentSession` plumbs into `ToolDispatcher`. Default preserves
  today's "no follow-up" behavior so the existing CLI is unaffected.

Out of scope:

- Cross-session persistence of queued requests (spec explicitly disallows).
- VS Code extension integration (slice 0003+).

## Key Files / Systems Affected

- `apps/realtime-agent/src/agent_loop.ts` — add response-active tracking
  driven by incoming events; route the Session API methods through the queue.
- `apps/realtime-agent/src/response_queue.ts` (new) — encapsulates queue
  policy, FIFO storage, and the await/notify primitives used by the session
  to wait for a terminal response state.
- `apps/realtime-agent/src/types.ts` — finalize queue-related types if not
  fully completed in slice 0001 (`ResponseQueuePolicy`, the populated
  statuses of `QueuedEventResult`).
- `apps/realtime-agent/src/event_router.ts` — no schema changes; the session
  subscribes to `onEvent`/`HandleIncomingEvent` directly. If new classified
  outgoing classes are required for testing, add them here.
- `apps/realtime-agent/test/agent_loop/` — new test file(s) covering queue
  behavior end-to-end against the fake socket.

## APIs To Reuse As-Is

- The existing fake-socket test harness under
  `apps/realtime-agent/test/agent_loop/helpers.ts` for driving incoming
  events deterministically.
- `SendOutgoing(event)` for the actual transmit path. The queue layer is a
  pre-send gate; it does not bypass routing.

## APIs To Extend / Modify

- `RealtimeAgentSessionImpl.HandleIncomingEvent` — observe `response.created`,
  `response.done`, `response.cancelled`, and `error` events scoped to a
  response to maintain a single `m_responseActive: boolean` flag and resolve
  any in-flight "wait for terminal" promise.
- `RealtimeAgentSessionImpl.SendOutgoing` (or a new sibling) — route
  response-affecting events through the queue. Non-response-affecting events
  (`input_audio_buffer.append`, `input_audio_buffer.clear`,
  `conversation.item.create` for context/text without `createResponse`)
  continue to send immediately.

## Design Notes

### Response-active state machine

States: `Idle` → `Active` (on `response.created`) → `Idle` (on
`response.done`, `response.cancelled`, or a terminal `error` referencing the
active response). `error` events without a clear response association leave
state unchanged; record a TODO log only — they do not block the queue.

The state machine owns a queue: `Array<QueuedRequest>` processed in FIFO
order when transitioning to `Idle`.

### Response-affecting requests

A request is response-affecting when sending it could either create a new
response or cancel one:

- `response.create`
- `input_audio_buffer.commit` when issued as part of
  `commitAudioAndCreateResponse()`. Naked `commitAudio()` is **not**
  response-affecting on its own — it just produces a user item. The spec
  language about "commit when paired with response creation" is honored by
  treating the pair as a single queued unit; a standalone `commitAudio()`
  sends immediately.
- `sendTextMessage` with `createResponse: true` (the pair of message +
  response.create is queued as a single unit).
- `sendStructuredContext` with `createResponse: true` (same pairing rule).
- `sendRealtimeEvent` when `event.type === "response.create"` or
  `event.type === "response.cancel"`. `response.cancel` is always sent
  immediately and never queued; the spec preserves it as the explicit
  escape hatch.

For pair operations, the queue stores a closure that, when fired, emits
both events through `SendOutgoing` in order. This guarantees the
conversation item and its `response.create` are not interleaved with
another caller's pair.

### Policies

- `enqueue` (default): append to queue, return `Promise<{ status: "queued"
  }>` immediately. Callers that want to know when the queued unit actually
  fires can `await` a follow-up promise — but the spec requires
  `QueuedEventResult` only, so we resolve the promise as soon as the queue
  decision is made. This keeps the API non-blocking and matches the spec
  language "store ... and send them after".
- `reject`: do not enqueue. Resolve with `{ status: "rejected", reason:
  "response_active" }`.
- `cancel_current`: emit `response.cancel` immediately via `SendOutgoing`,
  then enqueue the request. The request fires when the cancelled response
  reaches a terminal state. Resolve immediately with `{ status: "queued",
  reason: "cancelling_active" }`.

When the queue is empty and no response is active, the request sends
immediately and resolves with `{ status: "sent" }`.

### Concurrency

`ResponseQueue` is single-threaded JS; no locks are needed. Use a private
`m_processing` guard like `ToolDispatcher` to prevent reentrancy when an
incoming event triggers draining the queue.

### Tool-call interaction and follow-up responses

Spec 02 requires that after a model tool call, the extension sends the
`function_call_output` and then asks the model for another response so the
loop continues (call another tool, answer the user, or stop). The
realtime-agent today sends only the `function_call_output`; the server does
not automatically continue when `turn_detection` is `null` (manual mode), so
voice-driven tool calls would stall without an explicit follow-up.

Implementation in this slice:

- `ToolDispatcherOptions` gains `responseAfterOutput?: "never" | "always"`.
  Default `"never"` preserves today's behavior so the existing CLI and
  tests stay green. `"always"` makes the dispatcher emit one
  `response.create` after every tool output (success or structured error).
- The follow-up `response.create` is queued through the response queue
  defined in this slice with `queuePolicy: "enqueue"`. This guarantees:
  - The follow-up never overlaps an already-active response.
  - If multiple tool calls arrive in quick succession, each appends one
    follow-up and the queue drains them in FIFO order.
  - Tool error payloads (`tool_not_found`, `invalid_arguments`,
    `callback_failed`) also generate a follow-up so the model can recover
    instead of hanging.
- The `function_call_output` event itself remains routed through
  `SendOutgoing` as today and is not queued — it is not response-affecting
  on its own.
- `AgentStartConfig.responseAfterToolOutput?: boolean` (default `false`)
  is forwarded by `startAgentSession` to `ToolDispatcher` as
  `responseAfterOutput: "always"` when true. The VS Code extension
  (slice 0003) sets this to `true`; the CLI keeps the default `false`.
- The dispatcher must avoid issuing a follow-up when the tool output is
  itself the result of a model turn that the queue knows is about to be
  cancelled. Practically this is not a real conflict because tool dispatch
  runs in response to a model emitting a function call, so a follow-up
  always belongs to a fresh logical turn. The queue handles ordering.

Plumbing note: `ToolDispatcher` already receives a `sendContext` with
`sendOutgoingEvent`. Extend `ToolDispatcherSendContext` with a second
method `enqueueResponseCreate(): Promise<QueuedEventResult>` that the
session implementation backs with `responseQueue.enqueueResponseCreate()`.
This keeps the dispatcher unaware of the queue internals.

### Idempotency of `commitAudioAndCreateResponse`

When the audio buffer is empty (no frames have been appended since the last
commit), the OpenAI server will likely return an error. The slice does not
add client-side guarding; the failure path is reported via the existing
`onEvent` callback as a Realtime `error` event. Document this in code
comments; do not silently swallow.

## Validation

- New tests under `test/agent_loop/`:
  - Default `enqueue` policy holds `response.create` until `response.done`.
  - `reject` returns `{ status: "rejected", reason: "response_active" }` and
    does not send any event.
  - `cancel_current` emits `response.cancel` first, then the queued request
    after the cancelled response terminates.
  - `commitAudioAndCreateResponse` enqueues both events as one unit; another
    caller's queued request is not interleaved between them.
  - `sendTextMessage(..., { createResponse: true })` queues message+response
    as a pair under all policies.
  - Naked `commitAudio()` sends immediately even while a response is active.
  - Explicit `sendRealtimeEvent({ type: "response.cancel" })` always sends
    immediately.
  - FIFO order across multiple queued requests.
  - Terminal-by-error: a Realtime `error` referencing the active response
    drains the queue.
  - **Tool follow-up tests** (QP-0002 coverage):
    - Default `responseAfterToolOutput: false` (or omitted): dispatcher
      emits only `function_call_output` after a successful tool call;
      no `response.create` is sent. Existing CLI behavior preserved.
    - `responseAfterToolOutput: true` + successful tool callback:
      dispatcher emits `function_call_output` immediately followed by a
      queued `response.create`. Sent immediately when no response is
      active; deferred behind an active response when one is in flight.
    - `responseAfterToolOutput: true` + `tool_not_found`,
      `invalid_arguments`, and `callback_failed` paths each emit
      `function_call_output` (carrying the structured error) followed
      by a queued `response.create`.
    - Two rapid tool calls with `responseAfterToolOutput: true` produce
      two outputs and exactly two follow-up `response.create` events in
      FIFO order.
- `npm test` in `apps/realtime-agent` passes.

## Risks / Open Concerns

- The spec is silent on whether the promise returned by the queue should
  resolve on enqueue or on actual send. This plan picks "resolve on enqueue"
  because it matches the spec's `QueuedEventResult` shape (a one-shot
  decision result, not a completion notification). If the reviewer prefers
  resolve-on-send, that is a small refactor inside the queue with no API
  shape change. Flagging for reviewer attention rather than escalating, as
  either choice satisfies the literal spec.
