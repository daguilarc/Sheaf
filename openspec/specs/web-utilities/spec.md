# Capability: Web Utilities

Project: `projects/web`
ID prefix: `web` — requirement IDs are append-only; never renumber or reuse.

## Purpose

The web project provides the shared, framework-free browser assets that other
projects' service dashboards consume: a base stylesheet for dashboard pages
(`sheaf.css`) and a streaming chat transcript widget (`agui-chat.js` +
`agui-chat.css`) that renders [AGUI](../../../structure/schemas/ag_ui_events.schema.json)
event streams. Consuming services (quest-runner, conductor, sheaf-chat) serve
these files verbatim from the repository checkout — there is no build step,
bundler, or package install. Repo-level placement rules:
[Web UI](../../../structure/webui.md).

## Requirements

### Requirement: web-1 — Asset surface and loading: Plain files under `projects/web/src/`

THE web project SHALL provide its shared browser assets as plain files under `projects/web/src/` — `sheaf.css`, `agui-chat.css`, `agui-chat.js` — consumable verbatim by serving the directory over HTTP, with no build, transpile, or dependency-install step.

#### Scenario: Assets served verbatim
- **WHEN** a consuming service serves `projects/web/src/` over HTTP
- **THEN** `sheaf.css`, `agui-chat.css`, and `agui-chat.js` are available without any build, transpile, or dependency-install step

### Requirement: web-2 — Asset surface and loading: `ChatView` defined on `window` and `globalThis`

WHEN `agui-chat.js` is loaded as a classic (non-module) browser `<script>`, THE script SHALL define the `ChatView` object on both `window` and `globalThis` and define no other globals (strict-mode IIFE).

#### Scenario: Script loaded as classic script
- **WHEN** `agui-chat.js` is loaded as a classic (non-module) browser `<script>`
- **THEN** the script defines `ChatView` on both `window` and `globalThis` and defines no other globals

### Requirement: web-3 — Asset surface and loading: Chat stylesheet reads `--agui-chat-*` custom properties

THE chat stylesheet (`agui-chat.css`) SHALL read every themable color from `--agui-chat-*` custom properties with built-in dark fallbacks (see Contracts), so it renders standalone and consumers re-theme it by defining those properties on an ancestor element.

#### Scenario: Chat stylesheet rendered standalone
- **WHEN** `agui-chat.css` is loaded with no custom properties defined
- **THEN** the stylesheet renders with built-in dark fallbacks for all `--agui-chat-*` properties

#### Scenario: Consumer re-themes the widget
- **WHEN** a consumer defines `--agui-chat-*` properties on an ancestor element
- **THEN** the stylesheet uses those values instead of the built-in fallbacks

### Requirement: web-4 — Asset surface and loading: Base stylesheet defines `--sheaf-*` tokens and utility classes

THE base stylesheet (`sheaf.css`) SHALL define the `--sheaf-*` design tokens on `:root` and the `.sheaf-*` utility classes listed in Contracts; it also styles the bare `body`, `a`, and `*` (border-box) selectors, so it is intended as a whole-page stylesheet, not a scoped one.

#### Scenario: Base stylesheet loaded
- **WHEN** `sheaf.css` is loaded
- **THEN** the `--sheaf-*` design tokens are defined on `:root` and the `.sheaf-*` utility classes listed in Contracts are available

### Requirement: web-5 — ChatView lifecycle: `ChatView.create` renders root structure

WHEN `ChatView.create(container, wsUrlOrOptions)` is called, THE library SHALL empty the container and render an `.agui-chat-root` element containing a status bar (`.agui-chat-status`) followed by a scrollable transcript (`.agui-chat-transcript`), and return a handle accepted by every other `ChatView` function. The second argument is either a WebSocket URL string or an options object (see Contracts).

#### Scenario: ChatView.create called
- **WHEN** `ChatView.create(container, wsUrlOrOptions)` is called
- **THEN** the container is emptied and an `.agui-chat-root` element is rendered containing `.agui-chat-status` followed by `.agui-chat-transcript`, and a handle is returned

### Requirement: web-6 — ChatView lifecycle: WebSocket opened and frames applied

WHERE a `wsUrl` is supplied and the `WebSocket` global exists, THE library SHALL open a WebSocket to that URL during `create` and apply each received frame as a JSON server envelope (see Contracts); frames that fail to parse as JSON SHALL be ignored.

#### Scenario: wsUrl supplied and WebSocket global exists
- **WHEN** `create` is called with a `wsUrl` and the `WebSocket` global exists
- **THEN** a WebSocket is opened to that URL and each received frame is applied as a JSON server envelope

#### Scenario: Frame fails to parse as JSON
- **WHEN** a WebSocket frame fails to parse as JSON
- **THEN** the frame is ignored

### Requirement: web-7 — ChatView lifecycle: WebSocket error or close sets error status

IF the WebSocket emits `error` or closes, THEN THE library SHALL set the status to `error` (message `WebSocket error` / `WebSocket closed`) and append a system message with that text; a close after an existing error status SHALL NOT replace the first error. No automatic reconnect is attempted — reconnect policy belongs to the consumer.

#### Scenario: WebSocket emits error
- **WHEN** the WebSocket emits an `error` event
- **THEN** the status is set to `error` with message `WebSocket error` and a system message with that text is appended

#### Scenario: WebSocket closes without prior error
- **WHEN** the WebSocket closes and no prior error status exists
- **THEN** the status is set to `error` with message `WebSocket closed` and a system message with that text is appended

#### Scenario: WebSocket closes after existing error
- **WHEN** the WebSocket closes after an error status has already been set
- **THEN** the first error status is NOT replaced

### Requirement: web-8 — ChatView lifecycle: `ChatView.destroy` cleans up fully

WHEN `ChatView.destroy(handle)` is called, THE library SHALL cancel any pending render frame, remove all listeners it registered, close the socket if it is CONNECTING or OPEN, and empty the container; after destroy, every `ChatView` function on that handle SHALL be a no-op.

#### Scenario: ChatView.destroy called
- **WHEN** `ChatView.destroy(handle)` is called
- **THEN** any pending render frame is cancelled, all listeners are removed, the socket is closed if CONNECTING or OPEN, and the container is emptied; every subsequent `ChatView` function on that handle is a no-op

### Requirement: web-9 — ChatView lifecycle: `onScrollNearTop` throttled callback

WHERE `create` options include an `onScrollNearTop` function, THE library SHALL invoke it when the transcript scrolls to within 80px of the top, at most once per 500 ms (for consumers to lazy-load older history via `prependHistory`).

#### Scenario: Transcript scrolled near top
- **WHEN** the transcript scrolls to within 80px of the top
- **THEN** `onScrollNearTop` is invoked at most once per 500 ms

### Requirement: web-10 — Handle API: Core handle functions

THE library SHALL provide `appendAguiEvent(handle, event)` (reduce one AGUI event and schedule a render), `setCaughtUp(handle, bool)`, `setConnectionState(handle, stateOrNull)`, and `getUiState(handle)` with the shapes in Contracts.

#### Scenario: Handle API functions available
- **WHEN** `ChatView.create` returns a handle
- **THEN** `appendAguiEvent`, `setCaughtUp`, `setConnectionState`, and `getUiState` are available with the shapes in Contracts

### Requirement: web-11 — Handle API: `prependHistory` inserts non-duplicate messages

WHEN `prependHistory(handle, snapshotMessages)` is called, THE library SHALL insert the non-duplicate (by id), non-hidden snapshot messages at the head of the transcript preserving their given order, return the number inserted, and keep the user's visual scroll position by offsetting `scrollTop` by the transcript height growth.

#### Scenario: prependHistory called
- **WHEN** `prependHistory(handle, snapshotMessages)` is called
- **THEN** non-duplicate (by id), non-hidden snapshot messages are inserted at the head of the transcript in given order, the number inserted is returned, and `scrollTop` is offset by the transcript height growth

### Requirement: web-12 — Handle API: Renders coalesced to one per animation frame

THE library SHALL coalesce renders to at most one per animation frame (`requestAnimationFrame`, falling back to `setTimeout(0)` when rAF is undefined), so any number of consecutive event applications produce a single DOM update.

#### Scenario: Multiple consecutive event applications
- **WHEN** any number of AGUI events are applied consecutively
- **THEN** at most one DOM update (render) is produced per animation frame

### Requirement: web-13 — Event reduction: Server envelope dispatch

WHEN a server envelope is applied, THE reducer SHALL handle: `{"type":"events","events":[...]}` — reduce each AGUI event in order; `{"type":"caught_up"}` — mark history replay complete and recompute status; `{"type":"error","message":...}` — append a system message (default text `Connection error`) and set error status. Any other envelope `type` SHALL be ignored without state change.

#### Scenario: Events envelope applied
- **WHEN** a `{"type":"events","events":[...]}` envelope is applied
- **THEN** each AGUI event in the array is reduced in order

#### Scenario: caught_up envelope applied
- **WHEN** a `{"type":"caught_up"}` envelope is applied
- **THEN** history replay is marked complete and status is recomputed

#### Scenario: Error envelope applied
- **WHEN** a `{"type":"error","message":...}` envelope is applied
- **THEN** a system message is appended (default text `Connection error`) and error status is set

#### Scenario: Unknown envelope type applied
- **WHEN** an envelope with an unrecognized `type` is applied
- **THEN** it is ignored with no state change

### Requirement: web-14 — Event reduction: Transcript status state machine

THE transcript status SHALL follow this state machine: `loading` until caught-up; once caught-up, `live` while any run has status `running`, otherwise `complete`; `error` is sticky — once set (by `RUN_ERROR`, an error envelope, or a socket failure) it is never downgraded by recomputation.

#### Scenario: Before caught-up
- **WHEN** the transcript has not yet received `caught_up`
- **THEN** the status is `loading`

#### Scenario: Caught-up with a running run
- **WHEN** caught-up and at least one run has status `running`
- **THEN** the status is `live`

#### Scenario: Caught-up with no running runs
- **WHEN** caught-up and no run has status `running`
- **THEN** the status is `complete`

#### Scenario: Error status is sticky
- **WHEN** the status is set to `error` by `RUN_ERROR`, an error envelope, or a socket failure
- **THEN** it is never downgraded by subsequent recomputation

### Requirement: web-15 — Event reduction: Run lifecycle events

WHEN `RUN_STARTED` is reduced, THE reducer SHALL track the run (keyed by `runId`) as `running`; WHEN `RUN_FINISHED` is reduced, it SHALL mark the run `finished` and force-close every still-open text, tool-call, and reasoning stream (clearing their streaming/spinner indicators); WHEN `RUN_ERROR` is reduced, it SHALL mark the run `error` and append a system message with the event's `message` (default `Run error`) under id `error:<runId>`.

#### Scenario: RUN_STARTED reduced
- **WHEN** `RUN_STARTED` is reduced
- **THEN** the run (keyed by `runId`) is tracked as `running`

#### Scenario: RUN_FINISHED reduced
- **WHEN** `RUN_FINISHED` is reduced
- **THEN** the run is marked `finished` and every still-open text, tool-call, and reasoning stream is force-closed (clearing their streaming/spinner indicators)

#### Scenario: RUN_ERROR reduced
- **WHEN** `RUN_ERROR` is reduced
- **THEN** the run is marked `error` and a system message is appended with the event's `message` (default `Run error`) under id `error:<runId>`

### Requirement: web-16 — Event reduction: Step chips in status bar

WHEN `STEP_STARTED` / `STEP_FINISHED` are reduced, THE reducer SHALL add/remove an active step keyed by `stepName`; active steps render as chips in the status bar.

#### Scenario: STEP_STARTED reduced
- **WHEN** `STEP_STARTED` is reduced
- **THEN** an active step keyed by `stepName` is added and renders as a chip in the status bar

#### Scenario: STEP_FINISHED reduced
- **WHEN** `STEP_FINISHED` is reduced
- **THEN** the active step keyed by `stepName` is removed from the status bar chips

### Requirement: web-17 — Event reduction: Text message streaming

THE reducer SHALL build text messages from `TEXT_MESSAGE_START` (creates a streaming message with the event's `role`, default `assistant`) / `TEXT_MESSAGE_CONTENT` (appends `delta`) / `TEXT_MESSAGE_END` (stops streaming). A `TEXT_MESSAGE_CONTENT` for an unknown id SHALL create a streaming assistant message.

#### Scenario: TEXT_MESSAGE_START reduced
- **WHEN** `TEXT_MESSAGE_START` is reduced
- **THEN** a streaming message is created with the event's `role` (default `assistant`)

#### Scenario: TEXT_MESSAGE_CONTENT reduced for known id
- **WHEN** `TEXT_MESSAGE_CONTENT` is reduced for a known id
- **THEN** `delta` is appended to the message

#### Scenario: TEXT_MESSAGE_CONTENT reduced for unknown id
- **WHEN** `TEXT_MESSAGE_CONTENT` is reduced for an unknown id
- **THEN** a streaming assistant message is created for that id

#### Scenario: TEXT_MESSAGE_END reduced
- **WHEN** `TEXT_MESSAGE_END` is reduced
- **THEN** streaming is stopped on the message

### Requirement: web-18 — Event reduction: Replayed duplicate text message start ignored

IF a `TEXT_MESSAGE_START` arrives for an id that already has a closed message with non-empty content (a replayed duplicate), THEN THE reducer SHALL preserve the existing content and ignore that stream's `CONTENT` deltas until its matching `END`.

#### Scenario: Duplicate TEXT_MESSAGE_START for closed non-empty message
- **WHEN** `TEXT_MESSAGE_START` arrives for an id that already has a closed message with non-empty content
- **THEN** the existing content is preserved and subsequent `CONTENT` deltas for that stream are ignored until the matching `END`

### Requirement: web-19 — Event reduction: Tool call events

WHEN `TOOL_CALL_START` is reduced, THE reducer SHALL register the open call and, where `parentMessageId` names an existing assistant message, append `{id, name, args:"", result:null, isOpen:true}` to that message's `toolCalls`; `TOOL_CALL_ARGS` appends `delta` to the call's args; `TOOL_CALL_END` marks it closed; `TOOL_CALL_RESULT` records the result on the registered call and appends a `tool`-role message (id defaulting to `<toolCallId>:result`) whose content is the event's `content` (objects are JSON-stringified).

#### Scenario: TOOL_CALL_START reduced
- **WHEN** `TOOL_CALL_START` is reduced
- **THEN** the open call is registered and, where `parentMessageId` names an existing assistant message, `{id, name, args:"", result:null, isOpen:true}` is appended to that message's `toolCalls`

#### Scenario: TOOL_CALL_ARGS reduced
- **WHEN** `TOOL_CALL_ARGS` is reduced
- **THEN** `delta` is appended to the call's args

#### Scenario: TOOL_CALL_END reduced
- **WHEN** `TOOL_CALL_END` is reduced
- **THEN** the call is marked closed

#### Scenario: TOOL_CALL_RESULT reduced
- **WHEN** `TOOL_CALL_RESULT` is reduced
- **THEN** the result is recorded on the registered call and a `tool`-role message (id defaulting to `<toolCallId>:result`) is appended whose content is the event's `content` (objects are JSON-stringified)

### Requirement: web-20 — Event reduction: Reasoning message streaming and ordering

THE reducer SHALL build reasoning messages (role `reasoning`) from `REASONING_MESSAGE_START` / `REASONING_MESSAGE_CONTENT` / `REASONING_MESSAGE_END`. A reasoning message whose id is `<parentId>:thinking` SHALL be ordered immediately before the message `<parentId>` when that message exists (even if the reasoning arrives after the parent rendered). `REASONING_END` with a `messageId` closes that message; without one it closes all open reasoning messages. `REASONING_START` and `REASONING_ENCRYPTED_VALUE` have no transcript effect.

#### Scenario: REASONING_MESSAGE_START reduced
- **WHEN** `REASONING_MESSAGE_START` is reduced
- **THEN** a streaming reasoning message is created

#### Scenario: Reasoning message id is `<parentId>:thinking`
- **WHEN** a reasoning message whose id is `<parentId>:thinking` is rendered and the message `<parentId>` exists
- **THEN** the reasoning message is ordered immediately before `<parentId>`

#### Scenario: REASONING_END with messageId reduced
- **WHEN** `REASONING_END` with a `messageId` is reduced
- **THEN** that specific reasoning message is closed

#### Scenario: REASONING_END without messageId reduced
- **WHEN** `REASONING_END` without a `messageId` is reduced
- **THEN** all open reasoning messages are closed

#### Scenario: REASONING_START or REASONING_ENCRYPTED_VALUE reduced
- **WHEN** `REASONING_START` or `REASONING_ENCRYPTED_VALUE` is reduced
- **THEN** there is no transcript effect

### Requirement: web-21 — Event reduction: CUSTOM and RAW events

WHEN `CUSTOM` is reduced, THE reducer SHALL append an `activity`-role message whose `activityType` is the event `name`; for `name == "provider.text"` the content is `value.text` (else event `text`, else empty), otherwise the content is the name itself. WHEN `RAW` is reduced, it SHALL append an activity message with content `unrecognized event` and `activityType` = event `source` (default `raw`).

#### Scenario: CUSTOM event reduced with name "provider.text"
- **WHEN** `CUSTOM` is reduced with `name == "provider.text"`
- **THEN** an `activity`-role message is appended with `activityType` = `"provider.text"` and content = `value.text` (else event `text`, else empty)

#### Scenario: CUSTOM event reduced with other name
- **WHEN** `CUSTOM` is reduced with any other `name`
- **THEN** an `activity`-role message is appended with `activityType` = the event `name` and content = the name itself

#### Scenario: RAW event reduced
- **WHEN** `RAW` is reduced
- **THEN** an activity message is appended with content `unrecognized event` and `activityType` = event `source` (default `raw`)

### Requirement: web-22 — Event reduction: `sheaf.lifecycle_status` activity items hidden

THE reducer SHALL hide activity items whose type is `sheaf.lifecycle_status`: `CUSTOM` events with that `name` are dropped before counting, and snapshot/history messages with that `activityType` are filtered out of `MESSAGES_SNAPSHOT` and `prependHistory`.

#### Scenario: CUSTOM event with name "sheaf.lifecycle_status"
- **WHEN** a `CUSTOM` event with `name == "sheaf.lifecycle_status"` is reduced
- **THEN** it is dropped before counting and does not appear in the transcript

#### Scenario: Snapshot or history message with activityType "sheaf.lifecycle_status"
- **WHEN** a `MESSAGES_SNAPSHOT` or `prependHistory` message has `activityType == "sheaf.lifecycle_status"`
- **THEN** it is filtered out and does not appear in the transcript

### Requirement: web-23 — Event reduction: ACTIVITY_SNAPSHOT and ACTIVITY_DELTA

WHEN `ACTIVITY_SNAPSHOT` is reduced, THE reducer SHALL set the activity message's content to the JSON-stringified event `content`; WHEN `ACTIVITY_DELTA` is reduced for an existing activity message, it SHALL apply the event's `patch` as an RFC-6902 subset (`add`, `replace`, `remove` only; `add` to `-` appends to arrays; root replacement allowed only for `replace`); IF the patch contains any other op or an unresolvable pointer, THEN the message content SHALL remain unchanged.

#### Scenario: ACTIVITY_SNAPSHOT reduced
- **WHEN** `ACTIVITY_SNAPSHOT` is reduced
- **THEN** the activity message's content is set to the JSON-stringified event `content`

#### Scenario: ACTIVITY_DELTA reduced with valid patch
- **WHEN** `ACTIVITY_DELTA` is reduced for an existing activity message with a valid RFC-6902 subset patch
- **THEN** the patch is applied (`add`, `replace`, `remove` only; `add` to `-` appends; root replacement only for `replace`)

#### Scenario: ACTIVITY_DELTA reduced with invalid patch
- **WHEN** `ACTIVITY_DELTA` is reduced with a patch containing any other op or an unresolvable pointer
- **THEN** the message content remains unchanged

### Requirement: web-24 — Event reduction: MESSAGES_SNAPSHOT replaces transcript

WHEN `MESSAGES_SNAPSHOT` is reduced, THE reducer SHALL replace the entire transcript with the snapshot's non-hidden messages (shape in Contracts) and clear all open-stream tracking; stale DOM nodes are removed on the next render.

#### Scenario: MESSAGES_SNAPSHOT reduced
- **WHEN** `MESSAGES_SNAPSHOT` is reduced
- **THEN** the entire transcript is replaced with the snapshot's non-hidden messages and all open-stream tracking is cleared; stale DOM nodes are removed on the next render

### Requirement: web-25 — Event reduction: No-op event types and synthesized ids

THE reducer SHALL treat `STATE_SNAPSHOT`, `STATE_DELTA`, and unknown event types as transcript no-ops, while still incrementing the event counter; every event lacking the id its type keys on SHALL get a synthesized id `<TYPE>:<eventCount>`. Non-object events are ignored entirely.

#### Scenario: STATE_SNAPSHOT, STATE_DELTA, or unknown event type reduced
- **WHEN** `STATE_SNAPSHOT`, `STATE_DELTA`, or an unknown event type is reduced
- **THEN** it is a transcript no-op but the event counter is still incremented

#### Scenario: Event lacks the id its type keys on
- **WHEN** an event lacks the id its type keys on
- **THEN** a synthesized id `<TYPE>:<eventCount>` is assigned

#### Scenario: Non-object event received
- **WHEN** a non-object event is received
- **THEN** it is ignored entirely

### Requirement: web-26 — Rendering: One DOM node per message id

THE renderer SHALL map message roles to the DOM structures in Contracts, keep one DOM node per message id reused across renders (text streaming must not recreate the node), and remove nodes whose messages disappear from state.

#### Scenario: Message rendered across multiple renders
- **WHEN** a message is updated across multiple renders
- **THEN** the same DOM node (keyed by message id) is reused and not recreated

#### Scenario: Message disappears from state
- **WHEN** a message is removed from state
- **THEN** its DOM node is removed

### Requirement: web-27 — Rendering: Display-empty messages skipped

THE renderer SHALL skip messages that are completed and display-empty: non-streaming `user`/`assistant`/`reasoning`/`activity`/`system` messages whose content trims to empty — except an assistant message with at least one tool call, which always renders.

#### Scenario: Completed message with empty content
- **WHEN** a completed non-streaming `user`, `assistant`, `reasoning`, `activity`, or `system` message has content that trims to empty
- **THEN** the message is not rendered

#### Scenario: Completed assistant message with at least one tool call
- **WHEN** a completed assistant message has at least one tool call (even if content is empty)
- **THEN** the message is always rendered

### Requirement: web-28 — Rendering: Markdown formatter for assistant content

THE renderer SHALL render assistant content through the built-in markdown formatter: input is HTML-escaped first, then fenced code blocks (` ``` `) become `<pre class="agui-chat-code-block"><code>`, inline backticks become `<code class="agui-chat-inline-code">`, `**x**`/`__x__` become `<strong>`, single `*x*`/`_x_` (no newlines inside) become `<em>`, blank-line-separated blocks become `<p>`, and remaining single newlines become `<br>`. No other markdown (links, headings, lists) is interpreted, and raw HTML in message content SHALL never be injected.

#### Scenario: Assistant message rendered
- **WHEN** an assistant message is rendered
- **THEN** content is HTML-escaped first, then markdown formatted: fenced code blocks become `<pre class="agui-chat-code-block"><code>`, inline backticks become `<code class="agui-chat-inline-code">`, `**x**`/`__x__` become `<strong>`, single `*x*`/`_x_` become `<em>`, blank-line-separated blocks become `<p>`, remaining newlines become `<br>`, and raw HTML from content is never injected

### Requirement: web-29 — Rendering: Streaming and spinner indicators

WHILE an assistant message is streaming, THE renderer SHALL append a blinking cursor (`.agui-chat-streaming`); WHILE a reasoning message is streaming or a tool call is open, THE renderer SHALL show a spinner (`.agui-chat-spinner`) in the panel header; these indicators SHALL disappear on the render after the closing event.

#### Scenario: Assistant message streaming
- **WHEN** an assistant message is streaming
- **THEN** a blinking cursor (`.agui-chat-streaming`) is appended

#### Scenario: Reasoning message streaming or tool call open
- **WHEN** a reasoning message is streaming or a tool call is open
- **THEN** a spinner (`.agui-chat-spinner`) is shown in the panel header

#### Scenario: Closing event received
- **WHEN** the closing event for a streaming message or open tool call is received
- **THEN** the streaming/spinner indicator disappears on the next render

### Requirement: web-30 — Rendering: Collapsible tool and reasoning panels

THE renderer SHALL render tool and reasoning messages as collapsible panels, collapsed by default; clicking the header toggles the `agui-chat-bubble--expanded` class (expansion state is per message id and survives re-renders until the message is removed).

#### Scenario: Tool or reasoning message rendered
- **WHEN** a tool or reasoning message is rendered
- **THEN** it appears as a collapsible panel collapsed by default

#### Scenario: Panel header clicked
- **WHEN** the panel header is clicked
- **THEN** the `agui-chat-bubble--expanded` class is toggled and the expansion state survives subsequent re-renders until the message is removed

### Requirement: web-31 — Rendering: Auto-scroll pinning

WHEN a render grows the transcript, THE renderer SHALL keep the view pinned to the bottom if it was within 50px of the bottom beforehand, and SHALL leave the scroll position untouched otherwise.

#### Scenario: Render grows transcript while view is near bottom
- **WHEN** a render grows the transcript and the view was within 50px of the bottom beforehand
- **THEN** the view is pinned to the bottom after the render

#### Scenario: Render grows transcript while view is not near bottom
- **WHEN** a render grows the transcript and the view was not within 50px of the bottom beforehand
- **THEN** the scroll position is left untouched

### Requirement: web-32 — Rendering: Status bar priority rendering

THE status bar SHALL render, in priority order: a disconnected state when `setConnectionState` reported `connected: false` (warning dot, `label` text defaulting to `Disconnected`, plus `<n> queued` when `queuedCount > 0`); otherwise the transcript status — `loading`: `Loading history...` plus `<eventCount> events`; `live`: green dot and `Live`; `complete`: `Complete`; `error`: warning dot and the error message. Active step chips render after the main status whenever steps are active.

#### Scenario: Disconnected state
- **WHEN** `setConnectionState` reports `connected: false`
- **THEN** the status bar shows a warning dot, `label` text (defaulting to `Disconnected`), plus `<n> queued` when `queuedCount > 0`

#### Scenario: Loading transcript status
- **WHEN** the transcript status is `loading`
- **THEN** the status bar shows `Loading history...` plus `<eventCount> events`

#### Scenario: Live transcript status
- **WHEN** the transcript status is `live`
- **THEN** the status bar shows a green dot and `Live`

#### Scenario: Complete transcript status
- **WHEN** the transcript status is `complete`
- **THEN** the status bar shows `Complete`

#### Scenario: Error transcript status
- **WHEN** the transcript status is `error`
- **THEN** the status bar shows a warning dot and the error message

#### Scenario: Active steps present
- **WHEN** any steps are active
- **THEN** active step chips render after the main status

## Contracts

The event vocabulary consumed by the reducer is canonically defined in
[`structure/schemas/ag_ui_events.schema.json`](../../../structure/schemas/ag_ui_events.schema.json)
(tagged union on `type`). This file does not restate per-event field shapes.

### `ChatView` API

```js
const handle = ChatView.create(containerEl, "ws://host/ws/chat?...");
// or
const handle = ChatView.create(containerEl, {
  wsUrl: "ws://host/ws/chat?...",   // optional; no socket when absent
  onScrollNearTop: () => { ... },    // optional; see web-9
});

ChatView.appendAguiEvent(handle, aguiEvent);   // one schema event, not an envelope
ChatView.prependHistory(handle, snapshotMessages); // -> number inserted
ChatView.setCaughtUp(handle, true);
ChatView.setConnectionState(handle, { connected: false, queuedCount: 2, label: "Disconnected" });
ChatView.setConnectionState(handle, null);     // back to socket-derived status
ChatView.getUiState(handle);
// -> { connected: bool, queuedCount: number, caughtUp: bool, messageCount: number }
//    connected defaults to true while no connection state has been set
ChatView.destroy(handle);
```

The handle exposes `state`, `root`, `statusBar`, `transcript`, and `wsUrl` as
readable fields (the tests and consumers rely on them). `ChatView._test`
exposes the internal functions used by the Node test suite:
`createChatState`, `reduceAguiEvent`, `applyServerMessage`, `applyJsonPatch`,
`parseActivityContent`, `prependSnapshotMessages`, `escapeHtml`,
`formatMarkdown`, `isAtBottom`, `renderChat`, `scheduleRender`,
`x_AutoScrollThreshold` (= 50).

### WebSocket server envelope

Each frame is one JSON object:

```json
{"type": "events", "events": [ {"type": "RUN_STARTED", "runId": "..."} ]}
{"type": "caught_up"}
{"type": "error", "message": "stream failed"}
```

### Snapshot message shape (`MESSAGES_SNAPSHOT.messages` / `prependHistory`)

```json
{
  "id": "thread:step:1:seq:2:prompt",
  "role": "assistant",
  "content": "text",
  "timestamp": 1735689600000,
  "activityType": "codex.file_change",
  "toolCallId": "tc-1",
  "toolCalls": [
    {"id": "tc-1", "name": "grep", "arguments": "{\"pattern\":\"foo\"}", "result": "match"}
  ]
}
```

Messages without an `id` are skipped. `role` defaults to `activity`. Tool
call entries accept `id`/`toolCallId` and `arguments`/`args` aliases.

### Role → DOM mapping

| Role | Root element | Content |
|---|---|---|
| `user` | `.agui-chat-bubble--user` | `User` role label + plain-text `.agui-chat-content` (pre-wrap, monospace) |
| `assistant` | `.agui-chat-bubble--assistant` | markdown HTML per web-28 |
| `tool` | `.agui-chat-bubble--tool` collapsible panel | header: tool name from the parent's tool-call registry (fallback `Tool`); body: `Args:\n<args>` and/or `Result:\n<result>` (fallback: message content as `Result:`) |
| `reasoning` | `.agui-chat-bubble--reasoning` collapsible panel | header `Thinking`; body: plain text content |
| `activity` / `system` | `.agui-chat-activity` row | label: `System` for system, else `activityType` (fallback `Activity`); content: for activity, JSON content is summarized as its `text` field, else `path` field, else the JSON string; non-JSON content verbatim |
| any other role | bare `.agui-chat-activity` div | raw content |

Every message root carries `data-message-id`.

### Chat theming custom properties (`--agui-chat-*`)

| Property | Fallback | Used for |
|---|---|---|
| `--agui-chat-bg` | `#0f1419` | root background, code blocks, header hover |
| `--agui-chat-surface` | `#1a2332` | status bar, assistant bubble |
| `--agui-chat-surface-muted` | `#232f3e` | user/tool/reasoning bubbles, chips, inline code |
| `--agui-chat-text` | `#e6edf3` | text |
| `--agui-chat-muted` | `#8b9cb3` | labels, activity rows, idle status dot |
| `--agui-chat-border` | `#2d3a4d` | borders |
| `--agui-chat-accent` | `#3b82f6` | streaming cursor, spinner |
| `--agui-chat-live` | `#22c55e` | live status dot |
| `--agui-chat-warning` | `#f59e0b` | warning dot/labels |

### `sheaf.css` surface

Tokens on `:root`: `--sheaf-bg`, `--sheaf-surface`, `--sheaf-border`,
`--sheaf-text`, `--sheaf-text-muted`, `--sheaf-accent`,
`--sheaf-accent-hover`, `--sheaf-healthy`, `--sheaf-unhealthy`,
`--sheaf-warning`, `--sheaf-font`, `--sheaf-mono`, `--sheaf-radius`,
`--sheaf-space`.

Classes: `.sheaf-page` (centered 72rem column), `.sheaf-header`,
`.sheaf-card`, `.sheaf-table`, `.sheaf-status` with `--healthy` /
`--unhealthy` / `--unknown` modifiers (pill badges using `color-mix`),
`.sheaf-button` with `--primary` modifier, `.sheaf-log-view` (monospace
pre-wrap scroll box), `.sheaf-muted`, `.sheaf-warning`.

### Error catalogue

| Condition | Surface | Message (exact) |
|---|---|---|
| WebSocket `error` event | system message + error status | `WebSocket error` |
| WebSocket `close` (no prior error) | system message + error status | `WebSocket closed` |
| `RUN_ERROR` without `message` | system message (id `error:<runId>`) + error status | `Run error` |
| `{"type":"error"}` envelope without `message` | system message + error status | `Connection error` |
| Unparseable WebSocket frame | none (frame dropped) | — |
| Invalid `ACTIVITY_DELTA` patch | none (content unchanged) | — |

### Browser constraints

- `agui-chat.js`: ES2017+ browser (Map/Set/spread/template literals/`const`),
  no module system, no dependencies. `WebSocket` and
  `requestAnimationFrame` are feature-detected (the library works without
  either: no socket / `setTimeout` scheduling), which is what lets the Node
  test suite run it in a `node:vm` context with a fake DOM.
- `sheaf.css` uses `color-mix(in srgb, ...)` (Chrome/Edge 111+, Safari 16.2+,
  Firefox 113+).

## Design

- `src/agui-chat.js` (~1600 lines, single IIFE) has three layers: a pure
  reducer (`CreateChatState`, `ReduceAguiEvent`, `ApplyServerMessage`)
  operating on a state object of `Map`s/`Set`s; an incremental DOM renderer
  (`RenderChat` → `RenderStatusBar` + `RenderTranscript`,
  `CreateMessageNode`/`UpdateMessageNode`, node cache `handle.messageNodes`);
  and the public handle API (`Create`/`Destroy` plus the functions in
  Contracts). Streaming nodes are updated in place; settled nodes are only
  re-rendered once after their stream closes (`renderedStreaming` flag), and
  tool panels always refresh because results can arrive late.
- The reducer is deliberately tolerant: ids are stringified, missing fields
  defaulted, and unknown event types ignored, because upstream producers
  (quest-runner's quest-event→AGUI mapping, sheaf-chat) evolve independently.
- `ApplyJsonPatch` deep-copies via `JSON.parse(JSON.stringify(...))` and
  validates the whole patch before mutating nothing-or-all of the copy, so a
  bad delta can never half-apply.
- `tests/agui-chat.test.mjs` loads the script with `node:vm` against a
  ~150-line fake DOM (`FakeElement`) and covers the reducer, renderer,
  socket lifecycle, scroll behavior, and markdown escaping. Run lane:
  [operations.md](../../../projects/web/docs/operations.md).
- The two stylesheets are hand-maintained plain CSS; `agui-chat.css` is
  scoped entirely under `.agui-chat-*` class selectors so it can be loaded
  next to any host page style, while `sheaf.css` intentionally styles `body`.

## Interactions

- Consumers serve `projects/web/src/` from the repository checkout at
  `/assets/web/<filename>`:
  - quest-runner: `@app.route("/assets/web/<path:filename>")` in
    `projects/quest-runner/src/quest_runner_service/api.py` (no-cache); the
    dashboard shell loads `agui-chat.js`/`agui-chat.css` and themes the
    widget by mapping `--agui-chat-*` to its `--dash-*` tokens. See
    quest-runner's [chat-stream](../quest-runner-chat-stream/spec.md)
    and [dashboard](../quest-runner-dashboard/spec.md)
    capabilities — they own the WebSocket endpoint and event production.
  - conductor: `buildConductorStaticRoots` in
    `projects/conductor/src/ui_helpers.ts` maps `/assets/web` →
    `projects/web/src` and links `/assets/web/sheaf.css` from its pages.
  - sheaf-chat: `projects/sheaf-chat/src/server/static.ts` uses the same
    `/assets/web` prefix; its UI loads the chat widget.
- [Web UI rules](../../../structure/webui.md) — repo-level rule that
  shared presentation utilities live here while business logic stays in the
  consuming project.
- [AGUI event schema](../../../structure/schemas/ag_ui_events.schema.json)
  — canonical event vocabulary this widget consumes.
