# Issues

## Issue PL-0001

- status: open
- owner_role: polisher_reviewer
- created_at: 2026-06-08T05:41:23Z
- updated_at: 2026-06-08T05:41:23Z
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
