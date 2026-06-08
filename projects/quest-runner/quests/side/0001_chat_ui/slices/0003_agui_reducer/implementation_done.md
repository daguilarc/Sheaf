# Implementation Complete: 0003_agui_reducer

## Summary

Implemented the browser-side AG UI event reducer and `ChatView` API shell in `projects/web/src/agui-chat.js`, with comprehensive reducer unit tests in `projects/web/tests/agui-chat.test.mjs`.

## Deliverables

- **`agui-chat.js`** — Framework-free module exposing `window.ChatView` / `globalThis.ChatView` with:
  - `create(container, wsUrl)` — opens WebSocket, maintains reducer state, minimal status render, returns cleanup handle
  - `destroy(handle)` — closes socket, clears listeners/timers, empties container
  - `_test` exports: `createChatState`, `reduceAguiEvent`, `applyServerMessage`
  - Full event dispatch for all mapper-produced AG UI event types per spec
  - Server message handling for `events`, `caught_up`, and `error`
  - JSON Patch subset (`add`, `replace`, `remove`) for `ACTIVITY_DELTA`

- **`agui-chat.test.mjs`** — 13 tests covering text/tool/reasoning/run lifecycles, CUSTOM/RAW/activity events, MESSAGES_SNAPSHOT reset, no-op events, server messages, golden JSONL replay, WebSocket lifecycle, and step tracking.

## Validation

```text
node --test projects/web/tests/agui-chat.test.mjs   # 13/13 pass
```

Quest-runner `make test` reports one pre-existing failure in `test_agui_mapper` caused by new quest log lines (`interaction_query` events) in this quest's JSONL files — outside this slice's scope (spec: do not modify `QuestLogToAguiMapper`).
