# Issues

## Issue QP-0001

- status: completed
- owner_role: polisher_reviewer
- created_at: 2026-05-22T12:00:00Z
- updated_at: 2026-05-23T04:10:00Z
- title: response.done unconditionally classified as tool_call
- details: In `apps/realtime-agent/src/event_router.ts:81`, the `classifyIncomingEvent` function unconditionally classifies all `response.done` events as `tool_call`:

  ```ts
  if (x_toolCallTypes.has(event.type) || event.type === "response.done")
  {
    return "tool_call";
  }
  ```

  The spec (section "Tool-call related" under "Planned incoming events") says that only **function-call payloads** within `response.done` output items (`type = "function_call"`) are tool-call related. `response.done` itself is listed under "Conversation and response lifecycle" and can represent completion of a text-only response with no tool calls involved.

  The current implementation causes all `response.done` events — including those from pure text responses — to fire the `onToolCall` typed callback instead of a more appropriate callback. This will produce misleading callback routing in later slices when tool dispatch logic consumes the `tool_call` classification.

  Fix options:
  1. Conditionally classify `response.done` as `tool_call` only when it contains a function-call output item (inspect `response.output` array for items with `type === "function_call"`), otherwise classify it as `unknown`.
  2. Remove `response.done` from the `tool_call` classification entirely and let it fall through to `unknown`. Downstream tool dispatch (later slices) can inspect the event content directly.

  Either approach satisfies the spec. Option 2 is simpler for this slice.
- resolution_notes: Fixed. Polisher implemented Option 1 — `IsResponseDoneWithFunctionCall` inspects `response.output` for `function_call` items. Text-only `response.done` now falls through to `unknown`. Classification tests and a new `routeIncomingEvent` integration test both verify the corrected behavior.
