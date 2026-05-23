# Issues

## Issue PR-0001

- status: open
- owner_role: polisher_reviewer
- created_at: 2026-05-23T19:39:44Z
- updated_at: 2026-05-23T19:39:44Z
- title: Response queue can send queued responses before tool outputs
- details: `RealtimeAgentSessionImpl.HandleIncomingEvent()` currently calls `m_responseQueue.OnIncomingEvent(event)` before `HandleToolCallExtraction(event)`. For a `response.done` that contains function calls, `ResponseQueue.OnIncomingEvent()` clears the active response and drains any caller-queued response-affecting units immediately. If a caller queued `sendTextMessage(..., { createResponse: true })`, `sendStructuredContext(..., { createResponse: true })`, or `createResponse()` while the model was producing the function call, that queued unit can transmit its `response.create` before the `ToolDispatcher` sends the `function_call_output` for the just-finished model tool call. This violates Spec 02's required sequence that tool results are sent back as `function_call_output` and then another model response is requested, and it can cause the model to continue without seeing the tool result or with conversation items in the wrong order. This path is not covered by the current response queue tests, which only cover tool follow-up ordering when no external queued response is waiting.

  To mark this issue `completed`, the implementation must guarantee that tool outputs extracted from the terminal model response are transmitted before any newly unblocked response creates can run, and the tool follow-up `response.create` must still route through the same queue. Add focused coverage for a terminal `response.done` containing a function call while at least one external response-affecting unit is already queued, asserting that the sent order puts `function_call_output` before any subsequent `response.create`.
- resolution_notes: none
