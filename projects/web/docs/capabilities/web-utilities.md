# Capability: Web Utilities

ID prefix: `web`

## Purpose

The web project provides the shared, framework-free browser assets that other
projects' service dashboards consume: a base stylesheet for dashboard pages
(`sheaf.css`) and a streaming chat transcript widget (`agui-chat.js` +
`agui-chat.css`) that renders [AGUI](../../../../structure/schemas/ag_ui_events.schema.json)
event streams. Consuming services (quest-runner, conductor, sheaf-chat) serve
these files verbatim from the repository checkout — there is no build step,
bundler, or package install. Repo-level placement rules:
[Web UI](../../../../structure/webui.md).

## Requirements

### Asset surface and loading

- **[web-1]** THE web project SHALL provide its shared browser assets as plain
  files under `projects/web/src/` — `sheaf.css`, `agui-chat.css`,
  `agui-chat.js` — consumable verbatim by serving the directory over HTTP,
  with no build, transpile, or dependency-install step.
- **[web-2]** WHEN `agui-chat.js` is loaded as a classic (non-module) browser
  `<script>`, THE script SHALL define the `ChatView` object on both `window`
  and `globalThis` and define no other globals (strict-mode IIFE).
- **[web-3]** THE chat stylesheet (`agui-chat.css`) SHALL read every themable
  color from `--agui-chat-*` custom properties with built-in dark fallbacks
  (see Contracts), so it renders standalone and consumers re-theme it by
  defining those properties on an ancestor element.
- **[web-4]** THE base stylesheet (`sheaf.css`) SHALL define the `--sheaf-*`
  design tokens on `:root` and the `.sheaf-*` utility classes listed in
  Contracts; it also styles the bare `body`, `a`, and `*` (border-box)
  selectors, so it is intended as a whole-page stylesheet, not a scoped one.

### ChatView lifecycle

- **[web-5]** WHEN `ChatView.create(container, wsUrlOrOptions)` is called, THE
  library SHALL empty the container and render an `.agui-chat-root` element
  containing a status bar (`.agui-chat-status`) followed by a scrollable
  transcript (`.agui-chat-transcript`), and return a handle accepted by every
  other `ChatView` function. The second argument is either a WebSocket URL
  string or an options object (see Contracts).
- **[web-6]** WHERE a `wsUrl` is supplied and the `WebSocket` global exists,
  THE library SHALL open a WebSocket to that URL during `create` and apply
  each received frame as a JSON server envelope (see Contracts); frames that
  fail to parse as JSON SHALL be ignored.
- **[web-7]** IF the WebSocket emits `error` or closes, THEN THE library SHALL
  set the status to `error` (message `WebSocket error` / `WebSocket closed`)
  and append a system message with that text; a close after an existing error
  status SHALL NOT replace the first error. No automatic reconnect is
  attempted — reconnect policy belongs to the consumer.
- **[web-8]** WHEN `ChatView.destroy(handle)` is called, THE library SHALL
  cancel any pending render frame, remove all listeners it registered, close
  the socket if it is CONNECTING or OPEN, and empty the container; after
  destroy, every `ChatView` function on that handle SHALL be a no-op.
- **[web-9]** WHERE `create` options include an `onScrollNearTop` function,
  THE library SHALL invoke it when the transcript scrolls to within 80px of
  the top, at most once per 500 ms (for consumers to lazy-load older history
  via `prependHistory`).

### Handle API

- **[web-10]** THE library SHALL provide `appendAguiEvent(handle, event)`
  (reduce one AGUI event and schedule a render), `setCaughtUp(handle, bool)`,
  `setConnectionState(handle, stateOrNull)`, and `getUiState(handle)` with the
  shapes in Contracts.
- **[web-11]** WHEN `prependHistory(handle, snapshotMessages)` is called, THE
  library SHALL insert the non-duplicate (by id), non-hidden snapshot
  messages at the head of the transcript preserving their given order, return
  the number inserted, and keep the user's visual scroll position by
  offsetting `scrollTop` by the transcript height growth.
- **[web-12]** THE library SHALL coalesce renders to at most one per animation
  frame (`requestAnimationFrame`, falling back to `setTimeout(0)` when rAF is
  undefined), so any number of consecutive event applications produce a
  single DOM update.

### Event reduction

- **[web-13]** WHEN a server envelope is applied, THE reducer SHALL handle:
  `{"type":"events","events":[...]}` — reduce each AGUI event in order;
  `{"type":"caught_up"}` — mark history replay complete and recompute status;
  `{"type":"error","message":...}` — append a system message (default text
  `Connection error`) and set error status. Any other envelope `type` SHALL be
  ignored without state change.
- **[web-14]** THE transcript status SHALL follow this state machine:
  `loading` until caught-up; once caught-up, `live` while any run has status
  `running`, otherwise `complete`; `error` is sticky — once set (by
  `RUN_ERROR`, an error envelope, or a socket failure) it is never downgraded
  by recomputation.
- **[web-15]** WHEN `RUN_STARTED` is reduced, THE reducer SHALL track the run
  (keyed by `runId`) as `running`; WHEN `RUN_FINISHED` is reduced, it SHALL
  mark the run `finished` and force-close every still-open text, tool-call,
  and reasoning stream (clearing their streaming/spinner indicators); WHEN
  `RUN_ERROR` is reduced, it SHALL mark the run `error` and append a system
  message with the event's `message` (default `Run error`) under id
  `error:<runId>`.
- **[web-16]** WHEN `STEP_STARTED` / `STEP_FINISHED` are reduced, THE reducer
  SHALL add/remove an active step keyed by `stepName`; active steps render as
  chips in the status bar.
- **[web-17]** THE reducer SHALL build text messages from
  `TEXT_MESSAGE_START` (creates a streaming message with the event's `role`,
  default `assistant`) / `TEXT_MESSAGE_CONTENT` (appends `delta`) /
  `TEXT_MESSAGE_END` (stops streaming). A `TEXT_MESSAGE_CONTENT` for an
  unknown id SHALL create a streaming assistant message.
- **[web-18]** IF a `TEXT_MESSAGE_START` arrives for an id that already has a
  closed message with non-empty content (a replayed duplicate), THEN THE
  reducer SHALL preserve the existing content and ignore that stream's
  `CONTENT` deltas until its matching `END`.
- **[web-19]** WHEN `TOOL_CALL_START` is reduced, THE reducer SHALL register
  the open call and, where `parentMessageId` names an existing assistant
  message, append `{id, name, args:"", result:null, isOpen:true}` to that
  message's `toolCalls`; `TOOL_CALL_ARGS` appends `delta` to the call's args;
  `TOOL_CALL_END` marks it closed; `TOOL_CALL_RESULT` records the result on
  the registered call and appends a `tool`-role message (id defaulting to
  `<toolCallId>:result`) whose content is the event's `content` (objects are
  JSON-stringified).
- **[web-20]** THE reducer SHALL build reasoning messages (role `reasoning`)
  from `REASONING_MESSAGE_START` / `REASONING_MESSAGE_CONTENT` /
  `REASONING_MESSAGE_END`. A reasoning message whose id is
  `<parentId>:thinking` SHALL be ordered immediately before the message
  `<parentId>` when that message exists (even if the reasoning arrives after
  the parent rendered). `REASONING_END` with a `messageId` closes that
  message; without one it closes all open reasoning messages.
  `REASONING_START` and `REASONING_ENCRYPTED_VALUE` have no transcript
  effect.
- **[web-21]** WHEN `CUSTOM` is reduced, THE reducer SHALL append an
  `activity`-role message whose `activityType` is the event `name`; for
  `name == "provider.text"` the content is `value.text` (else event `text`,
  else empty), otherwise the content is the name itself. WHEN `RAW` is
  reduced, it SHALL append an activity message with content
  `unrecognized event` and `activityType` = event `source` (default `raw`).
- **[web-22]** THE reducer SHALL hide activity items whose type is
  `sheaf.lifecycle_status`: `CUSTOM` events with that `name` are dropped
  before counting, and snapshot/history messages with that `activityType` are
  filtered out of `MESSAGES_SNAPSHOT` and `prependHistory`.
- **[web-23]** WHEN `ACTIVITY_SNAPSHOT` is reduced, THE reducer SHALL set the
  activity message's content to the JSON-stringified event `content`; WHEN
  `ACTIVITY_DELTA` is reduced for an existing activity message, it SHALL
  apply the event's `patch` as an RFC-6902 subset (`add`, `replace`, `remove`
  only; `add` to `-` appends to arrays; root replacement allowed only for
  `replace`); IF the patch contains any other op or an unresolvable pointer,
  THEN the message content SHALL remain unchanged.
- **[web-24]** WHEN `MESSAGES_SNAPSHOT` is reduced, THE reducer SHALL replace
  the entire transcript with the snapshot's non-hidden messages (shape in
  Contracts) and clear all open-stream tracking; stale DOM nodes are removed
  on the next render.
- **[web-25]** THE reducer SHALL treat `STATE_SNAPSHOT`, `STATE_DELTA`, and
  unknown event types as transcript no-ops, while still incrementing the
  event counter; every event lacking the id its type keys on SHALL get a
  synthesized id `<TYPE>:<eventCount>`. Non-object events are ignored
  entirely.

### Rendering

- **[web-26]** THE renderer SHALL map message roles to the DOM structures in
  Contracts, keep one DOM node per message id reused across renders (text
  streaming must not recreate the node), and remove nodes whose messages
  disappear from state.
- **[web-27]** THE renderer SHALL skip messages that are completed and
  display-empty: non-streaming `user`/`assistant`/`reasoning`/`activity`/
  `system` messages whose content trims to empty — except an assistant
  message with at least one tool call, which always renders.
- **[web-28]** THE renderer SHALL render assistant content through the
  built-in markdown formatter: input is HTML-escaped first, then fenced code
  blocks (` ``` `) become `<pre class="agui-chat-code-block"><code>`, inline
  backticks become `<code class="agui-chat-inline-code">`, `**x**`/`__x__`
  become `<strong>`, single `*x*`/`_x_` (no newlines inside) become `<em>`,
  blank-line-separated blocks become `<p>`, and remaining single newlines
  become `<br>`. No other markdown (links, headings, lists) is interpreted,
  and raw HTML in message content SHALL never be injected.
- **[web-29]** WHILE an assistant message is streaming, THE renderer SHALL
  append a blinking cursor (`.agui-chat-streaming`); WHILE a reasoning
  message is streaming or a tool call is open, THE renderer SHALL show a
  spinner (`.agui-chat-spinner`) in the panel header; these indicators SHALL
  disappear on the render after the closing event.
- **[web-30]** THE renderer SHALL render tool and reasoning messages as
  collapsible panels, collapsed by default; clicking the header toggles the
  `agui-chat-bubble--expanded` class (expansion state is per message id and
  survives re-renders until the message is removed).
- **[web-31]** WHEN a render grows the transcript, THE renderer SHALL keep the
  view pinned to the bottom if it was within 50px of the bottom beforehand,
  and SHALL leave the scroll position untouched otherwise.
- **[web-32]** THE status bar SHALL render, in priority order: a disconnected
  state when `setConnectionState` reported `connected: false` (warning dot,
  `label` text defaulting to `Disconnected`, plus `<n> queued` when
  `queuedCount > 0`); otherwise the transcript status — `loading`: `Loading
  history...` plus `<eventCount> events`; `live`: green dot and `Live`;
  `complete`: `Complete`; `error`: warning dot and the error message. Active
  step chips render after the main status whenever steps are active.

## Contracts

The event vocabulary consumed by the reducer is canonically defined in
[`structure/schemas/ag_ui_events.schema.json`](../../../../structure/schemas/ag_ui_events.schema.json)
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
  [operations.md](../operations.md).
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
    quest-runner's [chat-stream](../../../quest-runner/docs/capabilities/chat-stream.md)
    and [dashboard](../../../quest-runner/docs/capabilities/dashboard.md)
    capabilities — they own the WebSocket endpoint and event production.
  - conductor: `buildConductorStaticRoots` in
    `projects/conductor/src/ui_helpers.ts` maps `/assets/web` →
    `projects/web/src` and links `/assets/web/sheaf.css` from its pages.
  - sheaf-chat: `projects/sheaf-chat/src/server/static.ts` uses the same
    `/assets/web` prefix; its UI loads the chat widget.
- [Web UI rules](../../../../structure/webui.md) — repo-level rule that
  shared presentation utilities live here while business logic stays in the
  consuming project.
- [AGUI event schema](../../../../structure/schemas/ag_ui_events.schema.json)
  — canonical event vocabulary this widget consumes.
