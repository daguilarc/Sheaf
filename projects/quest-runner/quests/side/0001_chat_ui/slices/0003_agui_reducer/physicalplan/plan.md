# AG UI Reducer

## Objective

Create the reusable browser-side AG UI event reducer and `ChatView` API shell under `projects/web/src/`, with reducer unit tests independent of the Quest Runner dashboard.

Expected outcome: `agui-chat.js` can maintain the complete transcript state described by the spec from server messages and AG UI events, exposes `window.ChatView.create(...)` and `window.ChatView.destroy(...)`, and has reducer tests for every event type the Python mapper can produce.

## Sequencing

This slice can follow the server route work but does not depend on dashboard wiring. Slice 4 will add the DOM renderer/CSS on top of this reducer state, and slice 5 will call the public `ChatView` API from `app.js`.

## Key Files And Systems

- `projects/web/src/agui-chat.js`
- `projects/web/tests/agui-chat.test.mjs`
- `structure/schemas/ag_ui_events.schema.json`
- `projects/quest-runner/src/quest_runner_service/agui_mapper.py`

## Existing APIs To Reuse As-Is

- Use the AG UI event names and field names emitted by `QuestLogToAguiMapper`.
- Use Node’s built-in `node --test` runner, matching existing dashboard JavaScript tests.
- Do not import `@ag-ui/client` or any UI framework.

## APIs To Add Or Modify

### `agui-chat.js` module shape

Implement as a framework-free browser script that attaches one global:

```javascript
window.ChatView = {
  create(container, wsUrl) { ... },
  destroy(handle) { ... },
  _test: { createChatState, reduceAguiEvent, applyServerMessage }
};
```

Also attach to `globalThis.ChatView` so Node tests can evaluate the file in a VM context. Keep reducer helpers side-effect-light and testable without a DOM.

`ChatView.create(...)` in this slice may create the initial state and WebSocket protocol plumbing, but rendering can remain minimal until slice 4. Do not leave API stubs: the handle must contain enough state/socket cleanup for `destroy(...)` to close an opened socket and clear owned timers/listeners. Slice 4 will replace the minimal render callback with the full renderer.

### State shape

Use plain JavaScript `Map` and `Set` for the in-memory state:

- `messages: Map<string, ChatMessage>`
- `messageOrder: string[]`
- `openTextMessages: Set<string>`
- `openToolCalls: Map<string, OpenToolCall>`
- `openReasoning: Set<string>`
- `runs: Map<string, RunState>`
- `activeSteps: Map<string, StepState>`
- `caughtUp: boolean`
- `eventCount: number`
- `status: { kind: "loading" | "live" | "complete" | "error", message: string | null }`

Use the `ChatMessage`, `ToolCallInfo`, `OpenToolCall`, `RunState`, and `StepState` fields named in the spec. Add only small renderer-oriented fields if necessary, such as `activityType` for activity rows.

### Server message handling

Implement:

- `applyServerMessage(state, message)`
  - `type: "events"`: reduce each event in order and increment `eventCount` by the number of events received.
  - `type: "caught_up"`: set `caughtUp = true` and derive status from whether any run has `status === "running"`.
  - `type: "error"`: set warning/error status and append a system message.
  - Unknown message types: ignore.

### Event dispatch table

Handle every event type listed in the spec:

- `RUN_STARTED`, `RUN_FINISHED`, `RUN_ERROR`
- `STEP_STARTED`, `STEP_FINISHED`
- `TEXT_MESSAGE_START`, `TEXT_MESSAGE_CONTENT`, `TEXT_MESSAGE_END`
- `TOOL_CALL_START`, `TOOL_CALL_ARGS`, `TOOL_CALL_END`, `TOOL_CALL_RESULT`
- `REASONING_START`, `REASONING_MESSAGE_START`, `REASONING_MESSAGE_CONTENT`, `REASONING_MESSAGE_END`, `REASONING_END`, `REASONING_ENCRYPTED_VALUE`
- `CUSTOM`, `RAW`
- `ACTIVITY_SNAPSHOT`, `ACTIVITY_DELTA`
- `MESSAGES_SNAPSHOT`
- `STATE_SNAPSHOT`, `STATE_DELTA`

Behavior details:

- Unknown event types are ignored.
- Missing IDs should not throw; synthesize stable IDs from event type plus current event count only when a visible message must be created.
- `RUN_FINISHED` closes open text messages, tool calls, and reasoning, and recomputes status.
- `RUN_ERROR` marks the run as error when `runId` is present and appends a system message with the error text.
- `TOOL_CALL_RESULT` creates a tool message and links `result` back to the matching assistant message’s `ToolCallInfo` when present.
- `CUSTOM` creates activity messages. For `name === "provider.text"`, display `value.text` or `text`; otherwise display a muted label using the custom event name.
- `RAW` creates an activity message labeled as an unrecognized event.
- `ACTIVITY_SNAPSHOT` creates or replaces one activity message keyed by `messageId`.
- `ACTIVITY_DELTA` applies JSON Patch operations to the matching activity message content. Implement the small subset needed for JSON Patch arrays from the schema: `add`, `replace`, and `remove` with slash-separated paths. On an invalid patch, leave the activity unchanged and do not throw.
- `MESSAGES_SNAPSHOT` clears messages/open message state and rebuilds `messages` and `messageOrder` from the snapshot payload.
- `STATE_SNAPSHOT`, `STATE_DELTA`, and `REASONING_ENCRYPTED_VALUE` are no-ops for display state.

## Validation Expectations

Add `projects/web/tests/agui-chat.test.mjs`:

- Load `projects/web/src/agui-chat.js` in a VM or DOM-free global context.
- Test simple text message: `TEXT_MESSAGE_START -> CONTENT -> CONTENT -> END`.
- Test tool call lifecycle: `TOOL_CALL_START -> ARGS -> ARGS -> TOOL_CALL_RESULT -> TOOL_CALL_END`.
- Test reasoning lifecycle: `REASONING_START -> REASONING_MESSAGE_START -> CONTENT -> REASONING_MESSAGE_END -> REASONING_END`.
- Test run lifecycle and status: `RUN_STARTED`, `caught_up`, `RUN_FINISHED`.
- Test `RUN_ERROR` creates a system message and error status.
- Test `CUSTOM` provider text, generic `CUSTOM`, and `RAW`.
- Test `ACTIVITY_SNAPSHOT` replacement and `ACTIVITY_DELTA` patching.
- Test `MESSAGES_SNAPSHOT` resets prior messages.
- Test `STATE_SNAPSHOT`, `STATE_DELTA`, `REASONING_ENCRYPTED_VALUE`, and unknown event types do not alter visible transcript state unexpectedly.
- Include a golden reducer test using representative AG UI events produced from a converted JSONL sequence; store the golden inline in the test file unless a local fixture pattern already exists.

Run:

```text
node --test projects/web/tests/agui-chat.test.mjs
make -C projects/quest-runner test
```
