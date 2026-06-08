# Agent Chat UI

Quest Runner renders agent logs as read-only chat transcripts in the dashboard.
Agent log pages show transcript UI while JSONL files remain the durable source
of truth.

Implementation files:

- `src/quest_runner_service/chat_event_bus.py`
- `src/quest_runner_service/dashboard_chat.py`
- `src/quest_runner_service/api.py`
- `src/quest_runner_service/harness.py`
- `src/quest_runner_service/dashboard_assets/app.js`
- `src/quest_runner_service/dashboard_assets/index.html`
- `src/quest_runner_service/dashboard_assets/styles.css`
- `projects/web/src/agui-chat.js`
- `projects/web/src/agui-chat.css`

## Server Flow

The dashboard opens `WS /api/dashboard/agent_log/stream` with the selected
`project`, `quest_type`, `quest_number`, `agent_key`, and optional `step`. The
endpoint resolves the same quest-local log file used by
`GET /api/dashboard/agent_log`.

Each `ChatStreamSession` subscribes to `QuestService.chat_event_bus` before it
reads the file. The session then:

1. Reads the selected JSONL log from disk.
2. Converts each source event with `QuestLogToAguiMapper`.
3. Sends AGUI events in `{"type": "events", "events": [...]}` batches.
4. Calls `flush()` on the mapper and sends any final AGUI events.
5. Sends `{"type": "caught_up"}`.
6. Streams live events from the event bus until the WebSocket closes.

`HarnessJsonlLogSink` publishes each event to the bus after writing it to disk.
The bus is in-process and keyed by resolved log path. It fans out each event to
all active subscribers for that file. During replay, the stream tracks the
highest integer `sequence` value seen in the file and skips queued live events at
or below that sequence so replayed lines are not duplicated.

Malformed JSONL lines produce `error` messages but do not stop replay unless the
WebSocket send fails. Setup errors such as an unknown agent key or missing log
are also sent as WebSocket `error` messages.

## Browser Flow

The dashboard shell loads shared chat assets from `/assets/web/agui-chat.js` and
`/assets/web/agui-chat.css`. Those files come from `projects/web/src/` so other
Sheaf web surfaces can reuse the transcript component.

`app.js` creates a chat view with:

```js
window.ChatView.create(container, wsUrl)
```

The returned handle owns the DOM nodes, reducer state, animation frame work, and
WebSocket. When the selected agent, selected step, or dashboard page changes,
the dashboard calls:

```js
window.ChatView.destroy(handle)
```

The dashboard may temporarily detach and reattach an existing handle while
rerendering the same selected agent and step. This preserves the active socket
and transcript DOM across dashboard refreshes.

## Reducer State

`agui-chat.js` keeps a client-side chat state with ordered messages, open text
streams, open reasoning streams, open tool calls, run status, active steps,
event count, and whether replay has caught up.

The reducer handles AGUI lifecycle events for:

- runs: `RUN_STARTED`, `RUN_FINISHED`, `RUN_ERROR`
- steps: `STEP_STARTED`, `STEP_FINISHED`
- text messages: `TEXT_MESSAGE_START`, `TEXT_MESSAGE_CONTENT`, `TEXT_MESSAGE_END`
- tool calls: `TOOL_CALL_START`, `TOOL_CALL_ARGS`, `TOOL_CALL_RESULT`, `TOOL_CALL_END`
- reasoning: `REASONING_START`, `REASONING_MESSAGE_START`,
  `REASONING_MESSAGE_CONTENT`, `REASONING_MESSAGE_END`,
  `REASONING_END`, `REASONING_ENCRYPTED_VALUE`
- activity and snapshots: `CUSTOM`, `RAW`, `ACTIVITY_SNAPSHOT`,
  `ACTIVITY_DELTA`, `MESSAGES_SNAPSHOT`
- agent-internal state: `STATE_SNAPSHOT`, `STATE_DELTA`

Encrypted reasoning and agent-internal state events are not shown in the
transcript. Unknown event types are ignored. `RUN_FINISHED` closes any open text,
tool, and reasoning streams so interrupted logs do not leave persistent
streaming indicators.

## Rendering

The chat renderer appends DOM nodes for new messages and updates existing nodes
in place for streaming text. Updates are coalesced with `requestAnimationFrame`.
Auto-scroll stays enabled when the transcript is within 50 pixels of the bottom
and pauses when the user has scrolled upward.

Visible message styles:

- user messages render as subdued monospace bubbles
- assistant messages render as primary bubbles with basic escaped Markdown
  formatting for paragraphs, inline code, code blocks, bold, and italic
- tool results render as collapsed panels that can expand to show arguments and
  result text
- reasoning messages render as collapsed "Thinking" panels
- activity, system, custom, and raw fallback events render as compact muted rows

The status bar shows loading history, live, complete, or error state. It also
shows the event count and active AGUI step labels when present.

## Constraints

The chat UI is read-only. It has no input box and sends no agent messages over
the WebSocket.

The live event bus is process-local. Existing log history always comes from the
JSONL file on connection, and live updates are available only from events
published by the currently running Quest Runner process.

The stream protocol uses AGUI events as documented in
[AGUI event mapping](agui-mapping.md). WebSocket route details are documented in
[API Reference](api.md#dashboard-websocket-apis).
