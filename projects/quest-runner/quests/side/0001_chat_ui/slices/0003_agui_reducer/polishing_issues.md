# Issues

## Issue PL-0001

- status: completed
- owner_role: polisher_reviewer
- created_at: 2026-06-08T05:41:23Z
- updated_at: 2026-06-08T05:45:04Z
- title: Missing test coverage for RUN_FINISHED closing open tool calls and reasoning
- details: The reducer's `CloseOpenStreams` (`projects/web/src/agui-chat.js:94-122`),
  invoked on `RUN_FINISHED` (`agui-chat.js:322-331`), closes any still-open text
  messages, tool calls (setting `ToolCallInfo.isOpen=false` and clearing
  `openToolCalls`), and reasoning (clearing `openReasoning`, setting
  `isStreaming=false`). This matches the spec table ("RUN_FINISHED ... Close any
  open text messages, tool calls, and reasoning for cleanup") and the plan
  ("RUN_FINISHED closes open text messages, tool calls, and reasoning, and
  recomputes status"). However, the only `RUN_FINISHED` test in
  `projects/web/tests/agui-chat.test.mjs` ("run lifecycle and caught_up status")
  sends `TEXT_MESSAGE_END` before `RUN_FINISHED`, so the text message, tool call,
  and reasoning are already closed by the time `RUN_FINISHED` fires. The
  close-on-finish branch of `CloseOpenStreams` is therefore never exercised by any
  test. This is a likely failure mode (a run that ends mid-stream with open tool
  calls or reasoning) and is exactly the kind of cleanup behavior that regresses
  silently when untested.
- resolution_notes: To mark completed: add a reducer test that opens a text
  message (`TEXT_MESSAGE_START`), a tool call (`TOOL_CALL_START` with a
  `parentMessageId` pointing at an existing assistant message, so a `ToolCallInfo`
  is attached), and a reasoning message (`REASONING_MESSAGE_START`), then fires
  `RUN_FINISHED` WITHOUT prior `TEXT_MESSAGE_END` / `TOOL_CALL_END` /
  `REASONING_MESSAGE_END` events, and asserts: `openTextMessages`,
  `openToolCalls`, and `openReasoning` are all empty; the attached
  `ToolCallInfo.isOpen === false`; and the open text and reasoning messages have
  `isStreaming === false`.
- resolution_notes (verified 2026-06-08T05:45:04Z): Confirmed the new test
  "RUN_FINISHED closes open text, tool call, and reasoning streams" in
  `projects/web/tests/agui-chat.test.mjs` opens a text message, a tool call (with
  `parentMessageId` so a `ToolCallInfo` is attached), and a reasoning message,
  leaves all three open through `caught_up` (asserting `openTextMessages`,
  `openToolCalls`, `openReasoning` each contain the entry), then fires
  `RUN_FINISHED` with no prior END events. It asserts `message.isStreaming` and
  `reasoning.isStreaming` are false, `toolCalls[0].isOpen` is false (with args
  preserved), the run is `finished`, all three open-tracking collections are size
  0, and status recomputes to `complete`. This exercises the previously-untested
  `CloseOpenStreams` branch and matches the resolution criteria. Resolved.
