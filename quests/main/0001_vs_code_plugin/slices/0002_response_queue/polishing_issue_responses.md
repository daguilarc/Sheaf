# Issue responses

## Response PR-0001 2026-05-23T21:18:40Z

- issue_id: PR-0001
- outcome: Fixed
- explanation: Tool outputs are now transmitted before any newly unblocked
  response-affecting unit when a terminal `response.done` carries function calls.

  Changes:

  - `apps/realtime-agent/src/response_queue.ts`: added
    `RegisterPendingToolOutput(callId)` and a `m_pendingToolOutputCallIds` set.
    `IsBusy()` now also returns true while at least one pending tool-output hold
    exists, which blocks `TryDrain()` from running queued response-affecting
    units. `NotifyOutgoingTransmitted` recognizes outgoing
    `conversation.item.create` with `item.type === "function_call_output"`,
    deletes the matching hold, and triggers `TryDrain()` once all holds are
    released.
  - `apps/realtime-agent/src/agent_loop.ts`:
    - `HandleIncomingEvent` now calls a new `ReserveToolOutputHolds(event)`
      BEFORE `m_responseQueue.OnIncomingEvent(event)`. On `response.done`, that
      helper walks `ExtractFunctionCallsFromResponseDone(event)` and calls
      `m_responseQueue.RegisterPendingToolOutput(callId)` for every
      not-yet-dispatched tool call. The queue therefore observes the terminal
      response while already busy, clears active state, but does not drain any
      caller-queued `sendTextMessage(..., { createResponse: true })`,
      `sendStructuredContext(..., { createResponse: true })`, or
      `createResponse()` until each `function_call_output` actually goes out on
      the wire.
    - `TransmitOutgoing` was reordered so the queue is notified AFTER
      `m_client.send(event)`. This guarantees that when the
      `function_call_output` send releases its hold and triggers a drain, any
      `response.create` the drain runs is necessarily transmitted after the
      `function_call_output` has already been written to the socket. The
      tool-driven follow-up `response.create` (when `responseAfterOutput:
      "always"`) is still routed through the same queue via
      `EnqueueToolFollowUpResponseCreate`, so FIFO ordering across caller and
      tool-follow-up units is preserved.
  - `apps/realtime-agent/test/agent_loop/response_queue.test.ts`: added
    `queued external response.create waits for function_call_output from
    terminal response.done`, which sets `responseAfterToolOutput: true`, uses
    a slow async tool callback, queues `session.sendTextMessage("post_tool",
    { createResponse: true })` while a response is active, then receives a
    `response.done` carrying one `function_call`. It asserts that the outgoing
    `function_call_output` precedes both the externally queued user message
    item and any subsequent `response.create`.

  Verification: `npm test` in `apps/realtime-agent` passes (88 tests, 0
  failures), including all pre-existing response queue, tool follow-up, and
  session API tests.

## Response PR-0001 2026-05-23T21:21:15Z

- issue_id: PR-0001
- outcome: Fixed
- explanation: Addresses the reviewer's follow-up gap that the previous fix only
  covered tool calls first surfaced via the terminal `response.done`. Streaming
  paths that dispatch a tool call from `response.function_call_arguments.done`
  before the terminal `response.done` arrives now also register and honor a
  pending tool-output hold.

  Changes:

  - `apps/realtime-agent/src/agent_loop.ts`:
    - `ReserveToolOutputHolds(event)` now also handles
      `response.function_call_arguments.done`: it reads `call_id` and calls
      `m_responseQueue.RegisterPendingToolOutput(callId)` so that any
      subsequent `response.done` cannot drain externally queued
      response-affecting units until the streamed tool call's
      `function_call_output` actually goes out on the wire.
    - Added `m_emittedToolOutputCallIds` plus a new
      `RecordEmittedToolOutput(event)` invoked at the top of `TransmitOutgoing`
      that records every outgoing `conversation.item.create` whose
      `item.type === "function_call_output"`. `ReserveToolOutputHolds` checks
      this set instead of `m_dispatchedCallIds`, so:
      - We do not skip registering a hold for a call that has already been
        dispatched (e.g. from a streaming-args event) but whose output is
        still in flight.
      - We do skip registering a hold for a call whose output already left
        the session, avoiding stuck holds when `response.done` reiterates a
        completed function call.
  - `apps/realtime-agent/test/agent_loop/response_queue.test.ts`: new test
    `streaming tool dispatch holds external queued unit until
    function_call_output is sent even after response.done`. It enables
    `responseAfterToolOutput: true`, registers a deliberately slow async tool
    callback (30 ms), queues `session.sendTextMessage("post_stream_tool",
    { createResponse: true })` while a response is active, then receives
    `response.function_call_arguments.done` (which dispatches the slow
    callback) immediately followed by the terminal `response.done` while the
    callback is still running. The test asserts the outgoing
    `function_call_output` precedes both the externally queued user message
    item and any subsequent `response.create`, exactly the scenario the
    reviewer called out.

  Verification: `npm test` in `apps/realtime-agent` passes (89 tests, 0
  failures), including both the new streaming-path test and the earlier
  `response.done`-bundled-function-call test.
