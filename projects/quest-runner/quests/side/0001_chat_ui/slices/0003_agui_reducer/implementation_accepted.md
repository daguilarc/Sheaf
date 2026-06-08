# Implementation Accepted: 0003_agui_reducer

## Acceptance Summary

The browser-side AG UI event reducer and `ChatView` API shell
(`projects/web/src/agui-chat.js`) with unit tests
(`projects/web/tests/agui-chat.test.mjs`) are accepted for this slice's scope.

## Verified Against Spec and Plan

- **Event field names match `QuestLogToAguiMapper`**: RUN_ERROR `message`;
  TOOL_CALL_RESULT `messageId`/`toolCallId`/`content`/`role`; CUSTOM `name`/`value`
  with `provider.text` → `value.text`; RAW `source`; ACTIVITY_SNAPSHOT
  `messageId`/`activityType`/`content`.
- **Full dispatch table** implemented for every event type the mapper can produce;
  `STATE_SNAPSHOT`, `STATE_DELTA`, `REASONING_ENCRYPTED_VALUE`, and unknown types
  are correct no-ops. Missing IDs are handled without throwing.
- **State shape** uses `Map`/`Set` per plan; `applyServerMessage` handles
  `events`/`caught_up`/`error`/unknown; status derivation (loading/live/complete/
  error) is correct.
- **JSON Patch subset** (`add`/`replace`/`remove`, slash-separated paths) applies
  to ACTIVITY_DELTA and leaves content unchanged on invalid patches without
  throwing. `MESSAGES_SNAPSHOT` performs a full reset.
- **`ChatView.create`/`destroy`** open the WebSocket and own/clean up the socket,
  listeners, and timers; minimal render is acceptable here (slice 4 owns the full
  renderer).

## Issue History

- PL-0001 (test coverage for `RUN_FINISHED` closing open tool calls and reasoning):
  resolved — a dedicated test now exercises the `CloseOpenStreams` branch with
  streams left open until the finish event. Verified and closed.

No open polishing issues remain.
