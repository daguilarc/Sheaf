# Chat UI for Agent Log Pages

## Quest Overview

Replace the raw JSONL `<pre>` dump on the Quest Runner dashboard's agent page
with a streaming chat transcript interface. The Quest Runner already has a
Python mapper (`QuestLogToAguiMapper` in `agui_mapper.py`) that converts quest
log events to AG UI events. This quest adds a WebSocket endpoint to the Quest
Runner Flask service that streams AG UI events to the browser, and a vanilla JS
chat UI that renders them as a real-time transcript.

## Goals

- Add a WebSocket endpoint to the Quest Runner service that serves AG UI events
  for a given agent log JSONL file.
- On connection, the server reads the full JSONL file, converts it through
  `QuestLogToAguiMapper`, and sends all resulting AG UI events. Then it follows
  the file for new lines and streams converted events in real time.
- Build a browser-side AG UI event reducer that maintains chat transcript state
  from the event stream.
- Render the transcript as a chat UI within the Quest Runner dashboard, reusing
  its existing dark theme and CSS conventions.
- The chat UI is read-only. There is no input box or ability to send messages.

## Non-Goals

- Do not add the ability to send messages back to the agent.
- Do not introduce React, Vue, or any UI framework. The chat UI is vanilla JS
  matching the existing `app.js` dashboard pattern.
- Do not modify the existing `QuestLogToAguiMapper` Python code.
- Do not add a dependency on the `@ag-ui/client` npm package. The browser code
  implements the event reduction logic directly using the AG UI JSON Schema
  (`structure/schemas/ag_ui_events.schema.json`) as the contract.
- The chat UI fully replaces the raw JSONL `<pre>` dump. There is no raw view
  toggle or fallback.

## Architecture

### Data Flow

There are two paths for AG UI events reaching the browser: **replay** (history)
and **live** (real-time). They share the same WebSocket connection and the same
AG UI event format, but they have different sources.

```text
Replay (on connect):
  JSONL file on disk
    → read all lines
    → QuestLogToAguiMapper.consume(event) per line
    → AG UI events batched and sent over WebSocket
    → {"type": "caught_up"} sent when replay is complete

Live (after caught_up):
  HarnessJsonlLogSink._append() writes a quest log event
    → also pushes the event to a ChatEventBus
    → ChatEventBus fans out to all subscribed WebSocket sessions
    → each session runs QuestLogToAguiMapper.consume(event)
    → AG UI events sent over WebSocket immediately
```

The Quest Runner is the process that produces events via
`HarnessJsonlLogSink` (`harness.py`). Rather than polling the file it just
wrote, the sink pushes events directly to connected clients through an
in-process pub/sub bus.

### Server: Event Bus (`chat_event_bus.py`)

A new module providing an in-process pub/sub channel keyed by log file path:

- `ChatEventBus` — singleton (or one per `QuestService` instance).
  - `publish(log_path: Path, event: dict)` — called by the log sink whenever
    it writes an event. Fans out `event` to all subscribers for that path.
  - `subscribe(log_path: Path) -> ChatSubscription` — returns an object with
    a `queue` (a `queue.SimpleQueue`) that receives events, and an
    `unsubscribe()` method.
- Thread-safe. The harness runs in background threads; WebSocket handlers run
  in their own threads (via `flask-sock`).

### Server: Log Sink Integration (`harness.py` modification)

`HarnessJsonlLogSink` gains an optional `event_bus: ChatEventBus | None`
constructor parameter. When set, `_append()` calls
`event_bus.publish(self.path, event)` after writing the line to disk. This is
the only change to the harness module.

### Server: WebSocket Support

The Quest Runner is a Flask app (`api.py`, `__main__.py`) running on port 9002.
Flask does not natively support WebSockets. Add the `flask-sock` package, which
provides WebSocket support via a simple decorator without requiring gevent or
eventlet.

New WebSocket endpoint:
```text
/api/dashboard/agent_log/stream
```

Query parameters (same as the existing `agent_log` REST endpoint):
- `project` — the project name.
- `quest_type` — `main` or `side`.
- `quest_number` — integer.
- `agent_key` — e.g. `quest:physical_planner` or `slice:implementer`.
- `step` — optional integer; defaults to the latest step.

### Server: WebSocket Session (`dashboard_chat.py`)

A new module handling the WebSocket session lifecycle:

1. **Validate parameters.** Reuse the existing `_quest_context()` and
   `parse_agent_key()` / `validate_agent_role()` helpers from `dashboard_slice`
   to resolve the quest directory and log file path.

2. **Subscribe to the event bus.** Before reading the file, subscribe to the
   `ChatEventBus` for this log file path. This ensures no events are lost
   between the end of replay and the start of live streaming — any events
   published while replay is in progress queue up in the subscription.

3. **Initial replay.** Read the full JSONL file line by line. For each line,
   parse JSON, call `mapper.consume(event)`, and collect the resulting AG UI
   events. Send events to the WebSocket client in batches (up to 100 per
   message or the end of the file, whichever comes first) as
   `{"type": "events", "events": [...]}` messages. After the entire file is
   processed, call `mapper.flush()` and send any remaining events. Then send
   `{"type": "caught_up"}`.

4. **Live streaming.** Drain the subscription queue. For each event, call
   `mapper.consume(event)` and send the resulting AG UI events to the client
   immediately. Block on the queue waiting for the next event (with a timeout
   to check for WebSocket closure).

5. **Cleanup.** When the WebSocket closes, unsubscribe from the event bus.

**Deduplication.** Events published to the bus while the file is still being
read may also appear in the file. The session tracks the highest `sequence`
number seen during replay and skips any bus events with a `sequence` at or
below that value.

Server message protocol (JSON):
- `{"type": "events", "events": [...]}` — a batch of AG UI events. Each event
  conforms to `structure/schemas/ag_ui_events.schema.json`.
- `{"type": "caught_up"}` — signals that historical replay is complete.
- `{"type": "error", "message": "..."}` — an error.

Client message protocol: none required for v1. The client does not send
messages after the initial connection. All parameters are in the query string.

### Browser: Asset Placement

All reusable browser-side artifacts — the AG UI event reducer, the DOM renderer,
and the chat CSS classes — live in `projects/web/src/` so that other services
and dashboards can reuse the same chat transcript component. The Quest Runner
dashboard imports them from there; it does not keep its own copy.

Files in `projects/web/src/`:
- `agui-chat.js` — the event reducer, DOM renderer, and `ChatView` API.
- `agui-chat.css` — all chat-specific CSS classes.

The Quest Runner already serves `projects/web/src/` at `/assets/web/` (via
Conductor's static roots configuration, which the Quest Runner dashboard can
mirror). The dashboard `index.html` loads the chat assets from that path.

### Browser: Dashboard Integration

The chat UI lives inside the existing dashboard SPA (`app.js`). When the user
selects an agent on the agents page, instead of rendering the raw JSONL into a
`<pre>` tag, the dashboard renders the chat transcript container and opens a
WebSocket connection.

`app.js` calls functions exported by `agui-chat.js` (loaded from
`projects/web/`) to create and destroy the chat view. The existing `<pre>` raw
JSONL rendering is removed entirely.

### Browser: AG UI Event Reducer

The browser maintains a `ChatState` object that the event reducer updates:

```text
ChatState:
  messages: Map<messageId, ChatMessage>
  messageOrder: messageId[]           // insertion order
  openTextMessages: Set<messageId>    // currently streaming text
  openToolCalls: Map<toolCallId, OpenToolCall>
  openReasoning: Set<messageId>       // currently streaming reasoning
  runs: Map<runId, RunState>
  activeSteps: Map<stepName, StepState>
  caughtUp: boolean                   // true after "caught_up" server message

ChatMessage:
  id: string
  role: "user" | "assistant" | "tool" | "reasoning" | "system" | "activity"
  content: string                     // accumulated text
  toolCalls: ToolCallInfo[]           // for assistant messages
  toolCallId: string | null           // for tool result messages
  isStreaming: boolean                // true while TEXT_MESSAGE_START but no END
  timestamp: number | null

ToolCallInfo:
  id: string
  name: string
  args: string                        // accumulated TOOL_CALL_ARGS deltas
  result: string | null               // from TOOL_CALL_RESULT
  isOpen: boolean                     // true until TOOL_CALL_END

OpenToolCall:
  toolCallId: string
  toolCallName: string
  argsBuffer: string
  parentMessageId: string | null

RunState:
  runId: string
  threadId: string
  status: "running" | "finished" | "error"

StepState:
  stepName: string
  startTimestamp: number | null
```

### Browser: Event Dispatch Table

The reducer handles every AG UI event type the mapper can produce:

| AG UI Event Type | State Mutation |
|---|---|
| `RUN_STARTED` | Add entry to `runs` with status `"running"`. |
| `RUN_FINISHED` | Set run status to `"finished"`. Close any open text messages, tool calls, and reasoning for cleanup. |
| `RUN_ERROR` | Set run status to `"error"`. Append an error system message. |
| `STEP_STARTED` | Add entry to `activeSteps`. |
| `STEP_FINISHED` | Remove entry from `activeSteps`. |
| `TEXT_MESSAGE_START` | Create a new `ChatMessage` with the given `messageId` and `role`. Add to `openTextMessages`. Set `isStreaming = true`. |
| `TEXT_MESSAGE_CONTENT` | Append `delta` to the matching message's `content`. |
| `TEXT_MESSAGE_END` | Remove from `openTextMessages`. Set `isStreaming = false`. |
| `TOOL_CALL_START` | Add to `openToolCalls`. If `parentMessageId` points to an existing assistant message, append a `ToolCallInfo` to it. |
| `TOOL_CALL_ARGS` | Append `delta` to the matching `OpenToolCall.argsBuffer` and `ToolCallInfo.args`. |
| `TOOL_CALL_END` | Remove from `openToolCalls`. Set `ToolCallInfo.isOpen = false`. |
| `TOOL_CALL_RESULT` | Create a tool result `ChatMessage` with `role: "tool"`. Set `content` from the event. If a matching `ToolCallInfo` exists, set its `result`. |
| `REASONING_START` | Mark reasoning phase open for the messageId. |
| `REASONING_MESSAGE_START` | Create a new `ChatMessage` with `role: "reasoning"`. Add to `openReasoning`. |
| `REASONING_MESSAGE_CONTENT` | Append `delta` to the reasoning message's `content`. |
| `REASONING_MESSAGE_END` | Remove from `openReasoning`. |
| `REASONING_END` | Clear reasoning phase. |
| `REASONING_ENCRYPTED_VALUE` | No-op (encrypted reasoning is not user-visible). |
| `CUSTOM` | Create an activity message showing the custom event name. For `provider.text`, display the text value. For others, show the name as a muted label. |
| `RAW` | Create an activity message with a muted "unrecognized event" label. |
| `ACTIVITY_SNAPSHOT` | Create or replace an activity message keyed by `messageId`. |
| `ACTIVITY_DELTA` | Apply the JSON Patch to the matching activity message content. |
| `MESSAGES_SNAPSHOT` | Replace the entire messages state (full reset). |
| `STATE_SNAPSHOT` | No-op for chat display (agent-internal state). |
| `STATE_DELTA` | No-op for chat display. |

Unrecognized `type` values are silently ignored.

### Browser: DOM Renderer

The renderer converts `ChatState` into DOM updates incrementally:

**Append-only for new messages.** When a new `messageId` appears in
`messageOrder`, a new DOM element is created and appended to the transcript
container.

**In-place update for streaming.** For messages in `openTextMessages`, the
renderer updates only the text content node of the existing DOM element.
A `requestAnimationFrame` coalescing guard prevents layout thrash when many
`TEXT_MESSAGE_CONTENT` events arrive in a single frame.

**Auto-scroll.** When the user is scrolled to the bottom (within a 50px
threshold), new content auto-scrolls. If the user has scrolled up, auto-scroll
is suppressed until they scroll back to the bottom.

#### Message Rendering by Role

- **user**: Left-aligned bubble with a "User" label in muted text. Content
  displayed in a monospace block.
- **assistant**: Primary message bubble. Text rendered with basic
  markdown-to-HTML (paragraphs, inline code, code blocks, bold, italic). While
  streaming, a blinking cursor indicator appears at the end.
- **tool**: Collapsed panel. Header shows tool name and a chevron. Clicking
  expands to show args and result in monospace. While the tool call is open, a
  spinner appears in the header.
- **reasoning**: Collapsed panel with a "Thinking" label. Expands to show
  reasoning text in muted monospace. Spinner while streaming.
- **activity / system / custom**: Compact muted row, not a full bubble. Shows
  the event name or activity type as a label.

#### Status Bar

A status bar at the top of the chat panel shows:
- During initial replay: "Loading history..." with event count.
- After `caught_up` while a run is active: "Live" with a green dot.
- After `caught_up` with no active run: "Complete" with a muted dot.
- On WebSocket error or disconnect: error message in warning color.
- Active steps shown as muted labels (e.g., "codex.turn").

## Detailed Component Specifications

### 1. WebSocket Endpoint (`api.py` addition)

Register a `flask-sock` route at `/api/dashboard/agent_log/stream`:

- Parse query parameters using existing dashboard helpers.
- Resolve the JSONL file path via `collect_step_logs_for_role()`.
- Create a `ChatStreamSession` and run it on the WebSocket.
- The WebSocket handler blocks until the connection closes or an error occurs.

### 2. Event Bus (`chat_event_bus.py`)

New module in `quest_runner_service/`:

- `ChatEventBus` class with `publish()` and `subscribe()` methods.
- `ChatSubscription` with a `queue.SimpleQueue` and `unsubscribe()`.
- Keyed by resolved log file `Path`. Multiple WebSocket clients watching the
  same file share a fan-out from a single publish call.
- Thread-safe via a `threading.Lock` on the subscriber registry.

### 3. Chat Stream Session (`dashboard_chat.py`)

New module in `quest_runner_service/`:

- `ChatStreamSession` class managing the replay + live lifecycle.
- Constructor takes: JSONL file path, `flask_sock.Server` WebSocket object,
  `ChatEventBus` instance.
- `run()` method:
  1. Subscribe to the event bus for this log file path.
  2. Create a `QuestLogToAguiMapper` instance.
  3. Read the JSONL file line by line, call `mapper.consume()`, batch AG UI
     events, send batches via WebSocket. Track the highest `sequence` number.
  4. Call `mapper.flush()`, send remaining events.
  5. Send `{"type": "caught_up"}`.
  6. Enter live loop: block on the subscription queue (with a short timeout to
     detect WebSocket closure). For each event, skip if `sequence` is at or
     below the replay high-water mark. Otherwise call `mapper.consume()` and
     send the AG UI events immediately.
  7. On WebSocket close: unsubscribe from the event bus.

### 4. Chat UI JavaScript (`projects/web/src/agui-chat.js`)

Reusable, framework-agnostic module. Exports (via globals on `window.ChatView`):
- `ChatView.create(container, wsUrl)` — initialize the chat UI in the given
  DOM container. Opens the WebSocket, creates the reducer, starts rendering.
  Returns a handle object.
- `ChatView.destroy(handle)` — close the WebSocket, remove DOM content, clean
  up state.

This file contains the AG UI event reducer, the DOM renderer, and the
auto-scroll logic. It has no dependency on the Quest Runner dashboard — any
page that loads it and provides a WebSocket URL serving the same AG UI event
protocol gets a working chat transcript.

Called from the Quest Runner dashboard's `app.js`:
- When the user selects an agent, call `ChatView.create()` with the appropriate
  WebSocket URL.
- When the user switches agents or navigates away, call `ChatView.destroy()`.

### 5. Chat CSS (`projects/web/src/agui-chat.css`)

Reusable chat CSS classes using CSS custom properties for theming. The classes
use a neutral `agui-chat-` prefix (not `dash-`) so they work outside the Quest
Runner dashboard:

- `.agui-chat-transcript` — scrollable transcript container.
- `.agui-chat-bubble` — message bubble with padding, border-radius, margin.
- `.agui-chat-bubble--user` — user variant (subdued background).
- `.agui-chat-bubble--assistant` — assistant variant (primary surface).
- `.agui-chat-bubble--tool` — tool call collapsible panel.
- `.agui-chat-bubble--reasoning` — reasoning collapsible panel.
- `.agui-chat-activity` — compact activity row.
- `.agui-chat-role` — role label above a bubble.
- `.agui-chat-streaming` — blinking cursor animation.
- `.agui-chat-status` — status bar.
- `.agui-chat-tool-header` — clickable tool panel header.
- `.agui-chat-tool-body` — collapsible tool panel body.

Colors reference CSS custom properties (e.g. `--agui-chat-bg`, `--agui-chat-text`)
with fallback defaults. The Quest Runner dashboard maps its existing design
tokens to these properties so the chat UI inherits the dark theme without
the chat CSS knowing about `--sheaf-*` or `--dash-*` variables.

### 6. Dashboard Wiring (`app.js` modifications)

Modify the agent log rendering section (around line 1119-1171 in `app.js`):

- Remove the `<pre>` raw JSONL rendering.
- When an agent log is loaded:
  - Build the WebSocket URL from the current quest context and agent key.
  - Call `ChatView.create()` with the chat container and URL.
  - Store the handle in `state.contentCache.chatHandle`.
- When switching agents: destroy the previous chat handle if any, then create
  a new one.
- On step change: destroy and recreate the chat view for the new step.

### 8. HTML Changes (`index.html`)

Add tags to load the shared chat assets before `app.js`:
```html
<link rel="stylesheet" href="/assets/web/agui-chat.css">
<script src="/assets/web/agui-chat.js"></script>
```

The Quest Runner dashboard must serve `projects/web/src/` under `/assets/web/`.
If it does not already, add a static file route in `api.py` for this path.

## Testing

### Server Tests

New test file `tests/test_chat_event_bus.py`:
- Unit test `ChatEventBus` pub/sub: subscribe, publish, assert events arrive
  on the queue.
- Test multiple subscribers on the same path.
- Test unsubscribe stops delivery.
- Test thread safety with concurrent publish/subscribe.

New test file `tests/test_dashboard_chat.py`:
- Unit test `ChatStreamSession` with a mock WebSocket and a real event bus:
  - Write a known JSONL file, run the session, assert the correct AG UI event
    sequence is sent including `caught_up`.
  - Publish events to the bus after replay, assert they stream to the client.
  - Test deduplication: publish events with sequence numbers already seen during
    replay, assert they are skipped.
- Integration test the Flask WebSocket endpoint using a test client:
  - Connect, verify events arrive, then `caught_up`.
  - Verify invalid parameters return an error.

### Browser Reducer Tests

New test file `projects/web/tests/agui-chat.test.mjs`:
- Unit test the event reducer with sequences of AG UI events and assert
  the resulting `ChatState`.
- Test sequences:
  - Simple text message: START → CONTENT → CONTENT → END.
  - Tool call lifecycle: START → ARGS → ARGS → RESULT → END.
  - Reasoning: REASONING_START → MESSAGE_START → CONTENT → MESSAGE_END →
    REASONING_END.
  - Run lifecycle: RUN_STARTED → (messages) → RUN_FINISHED.
  - Run error: RUN_STARTED → RUN_ERROR.
  - Custom and RAW events.
  - Full replay of a converted JSONL file (golden test).

### Manual Verification

- Start the Quest Runner with a project that has existing JSONL logs.
- Navigate to the dashboard agents page.
- Select an agent and verify the chat transcript renders correctly.
- Start a quest run and verify live streaming works.
- Verify auto-scroll behavior.
- Verify collapsible tool call and reasoning panels.
- Verify step switching destroys and recreates the WebSocket connection.

## Dependencies

- Add `flask-sock` to the Quest Runner's Python dependencies.
- No npm or TypeScript dependencies are added.

## File Inventory

New files:
- `projects/web/src/agui-chat.js` — reusable AG UI event reducer, DOM renderer,
  and `ChatView` API.
- `projects/web/src/agui-chat.css` — reusable chat transcript CSS classes.
- `projects/web/tests/agui-chat.test.mjs` — browser reducer unit tests.
- `projects/quest-runner/src/quest_runner_service/chat_event_bus.py`
- `projects/quest-runner/src/quest_runner_service/dashboard_chat.py`
- `projects/quest-runner/tests/test_chat_event_bus.py`
- `projects/quest-runner/tests/test_dashboard_chat.py`

Modified files:
- `projects/quest-runner/src/quest_runner_service/harness.py` — add optional
  `event_bus` parameter to `HarnessJsonlLogSink`; call `publish()` in
  `_append()`.
- `projects/quest-runner/src/quest_runner_service/api.py` — add WebSocket route,
  `flask-sock` initialization, and static file serving for `projects/web/src/`
  if not already present.
- `projects/quest-runner/src/quest_runner_service/dashboard_assets/app.js` —
  replace raw JSONL `<pre>` rendering with `ChatView.create()`/`destroy()`
  calls.
- `projects/quest-runner/src/quest_runner_service/dashboard_assets/index.html` —
  add `agui-chat.css` and `agui-chat.js` tags.
- `projects/quest-runner/src/quest_runner_service/dashboard_assets/styles.css` —
  add CSS custom property mappings from dashboard tokens to `--agui-chat-*`
  variables.
