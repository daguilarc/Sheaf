# Slice 0005 — Chat Pane

## Objective

Add a focused chat pane to the VS Code extension that surfaces the
meaningful conversation surface of an active realtime-agent session:
user audio transcripts, assistant text output, high-level tool call
summaries, context push summaries, and errors. The pane filters out raw
websocket noise and partial-event spam.

## Scope

In scope:

- A new `ChatViewProvider` implementing `vscode.WebviewViewProvider`
  contributing a sidebar view at `sheaf.chatView`.
- `package.json` `contributes.views` and `contributes.viewsContainers`
  entries to register the view in the activity bar.
- A `ChatModel` that subscribes to realtime-agent callbacks via the
  `RealtimeAgentSession` started by `SessionController` and produces a
  stream of typed `ChatBubble` records.
- Bubble types: `user_transcript`, `assistant_text`, `tool_call`,
  `context_push`, `error`.
- Streaming-aware aggregation:
  - Multiple
    `conversation.item.input_audio_transcription.delta` events with the
    same item id collapse into one in-progress user bubble; the
    `completed` event finalizes it.
  - Multiple `response.output_text.delta` events with the same response
    id collapse into one in-progress assistant bubble; the
    `response.output_text.done` event finalizes it.
- Tool call bubble summary built from the tool name + parsed arguments
  (one short line; never the full result payload). A small per-tool
  formatter table in `chat/toolSummary.ts`.
- Context push bubble fed by a new `ChatModel.onContextPushed(message)`
  hook called from `SessionController` whenever the extension itself
  invokes `session.sendStructuredContext`. Bubble label uses
  `message.summary` if provided; otherwise a generic
  `"Context: <kind>"` line.
- Error bubble for incoming `error` events and session-fatal failures.
- Inactive-state UI: when no session is active, the pane shows a clear
  "Session inactive — press F16 to start" message and a button bound to
  the toggle command.
- Active-state UI: header shows session id (truncated) and an inline
  Commit/Respond button bound to the existing
  `sheaf.realtime.commitAndRespond` command.

Out of scope:

- Rendering full structured tool results.
- Multi-session history browsing.
- Editing or replaying transcripts.
- Speech output.

## Key Files / Systems Affected

New / changed files in `apps/vscode-extension/src/chat/`:

```
src/chat/
  chatViewProvider.ts   # WebviewViewProvider, html scaffold, message bridge
  chatModel.ts          # ordered list of ChatBubble entries + emitter
  bubbleTypes.ts        # ChatBubble union and helpers
  toolSummary.ts        # tool name + args -> short string
  contextSummary.ts     # StructuredContextMessage -> short string
  webview/
    index.ts            # entry compiled separately for the webview bundle
    index.css           # styles
```

Updates:

- `src/extension.ts` — register `ChatViewProvider`, wire `ChatModel`
  into `SessionController`.
- `src/sessionController.ts` — accept a `ChatModel` dependency, route
  session callbacks (`onConversationEvent`, `onToolLifecycle`,
  `onSessionEnded`) and the extension-side `sendStructuredContext` calls
  into it.
- `package.json` — `contributes.viewsContainers.activitybar` and
  `contributes.views.sheafContainer`.
- `esbuild.config.mjs` — second entry point that builds
  `src/chat/webview/index.ts` to `out/webview/index.js` as an IIFE
  bundle for the webview.

## APIs To Reuse As-Is

- `RealtimeAgentSession` callbacks (`onConversationEvent`,
  `onToolLifecycle`, `onSessionEnded`) supplied via `AgentStartConfig`.
- `classifyIncomingEvent` / `classifyOutgoingEvent` from
  `realtime-agent-lib` to filter noise before producing bubbles.
- `vscode.WebviewView`, `webview.postMessage`,
  `webview.onDidReceiveMessage` for host↔webview communication.

## APIs To Extend / Modify

- `SessionController.start()` now wires `onConversationEvent` and
  `onToolLifecycle` into `chatModel.ingestEvent` /
  `chatModel.ingestToolLifecycle`. Errors and session-end are routed via
  `onSessionEnded` and the existing error-surfacing path.
- Any place the extension itself calls
  `session.sendStructuredContext(...)` (slice 0006) is augmented to
  notify `chatModel.recordContextPush(message)`. This slice defines the
  hook now so slice 0006 can call it without restructuring.

## Design Notes

### Bubble model

```ts
export type ChatBubble =
  | { kind: "user_transcript"; id: string; itemId: string;
      text: string; complete: boolean; createdAt: string }
  | { kind: "assistant_text"; id: string; responseId: string;
      text: string; complete: boolean; createdAt: string }
  | { kind: "tool_call"; id: string; toolCallId: string;
      toolName: string; summary: string; phase: ToolLifecyclePhase;
      createdAt: string }
  | { kind: "context_push"; id: string; summary: string;
      createdAt: string }
  | { kind: "error"; id: string; message: string; createdAt: string };
```

`ChatModel` exposes:

```ts
class ChatModel {
  getSnapshot(): ChatBubble[];
  subscribe(fn: () => void): () => void;
  ingestEvent(event: RealtimeEvent, info: ConversationEventInfo): void;
  ingestToolLifecycle(notification: ToolLifecycleNotification): void;
  recordContextPush(message: StructuredContextMessage): void;
  recordError(message: string): void;
  reset(reason: string): void;
}
```

`reset(reason)` is called when a session ends so a fresh session starts
with an empty pane (plus an "ended: <reason>" bubble for context).

### Event handling rules

`ingestEvent` dispatches by event type:

- `conversation.item.input_audio_transcription.delta` (incoming): find
  or create a `user_transcript` bubble keyed by `event.item_id`. Append
  `event.delta`. `complete = false`.
- `conversation.item.input_audio_transcription.completed` (incoming):
  finalize the bubble with `event.transcript`, `complete = true`.
- `response.output_text.delta` (incoming): find or create an
  `assistant_text` bubble keyed by `event.response_id` (or
  `event.item_id` if `response_id` missing in this event family — use a
  small key extractor). Append `event.delta`.
- `response.output_text.done` (incoming): finalize.
- `error` (incoming): push an `error` bubble.
- Tool call lifecycle: handled in `ingestToolLifecycle` (not via the
  raw event stream) so the chat surface gets clean transitions.
- Everything else: ignored. The classifier confirms which event classes
  carry user-visible content; only `transcription`, `text_output`, and
  `error` produce bubbles directly.

`ingestToolLifecycle`:

- `queued`: create a `tool_call` bubble with `phase: "queued"`. Summary
  derived from `toolSummary.format(notification.toolName, args)`.
  However, the lifecycle notification does not carry args — the model
  must call `ingestEvent` first to capture args, or the bubble shows
  only the tool name until `succeeded`. Decision: keep a small
  side-table inside `ChatModel` that records the latest
  `response.function_call_arguments.done` for each call id, then the
  tool summary uses those args.
- `started`/`succeeded`/`failed`: update the bubble's `phase` in place.
  No new bubble.

### Webview transport

Standard VS Code webview pattern:

- Host posts `{ type: "snapshot", bubbles }` whenever `ChatModel`
  changes.
- Webview posts `{ type: "command", id: "toggleSession" | "commitAndRespond" }`
  in response to buttons. Host translates to
  `vscode.commands.executeCommand(...)`.
- Webview script lives in `src/chat/webview/index.ts`, compiled to
  `out/webview/index.js` as an IIFE bundle. CSP `script-src` allows
  only the bundled script via a per-load nonce.

The webview is a small vanilla-DOM renderer (no React) to keep the
slice scope small. The render is incremental in spirit (re-render on
snapshot) but uses `replaceChildren` for simplicity. Bubble list keys
are the `id` field so DOM diffing is straightforward.

### Throttling streaming updates

Snapshot subscription fires on every `delta`. To avoid render churn,
`ChatModel.subscribe` consumers use a 32-ms debounce inside the view
provider before re-posting to the webview. Inside the webview, `delta`
updates patch the in-progress bubble's text content directly without
rebuilding the whole list.

### Session id rendering

`session.sessionId` is shown truncated (first 8 chars) in the header
alongside session state read from `SessionController.getState()`. The
view provider subscribes to a new
`SessionController.onStateChanged(listener)` emitter added in this
slice; state changes also re-render the header.

## Validation

- Tests under `apps/vscode-extension/test/chat/`:
  - `chatModel.test.ts` — feed canned event sequences and assert the
    bubble list shape, including delta collapsing,
    completion finalization, and tool lifecycle transitions.
  - `toolSummary.test.ts` — common tool name / args combos render
    expected one-liners (e.g. `code_read` with `startLine/endLine`
    renders `Reading <file> lines 40-90`).
  - `contextSummary.test.ts` — `file_changed_since_last_read` and
    siblings produce the expected text.
- Webview render is not unit tested in this slice; manual smoke
  required.
- `npm run build` in `apps/vscode-extension` produces both
  `out/extension.js` and `out/webview/index.js`.

## Risks / Open Concerns

- The Realtime event field names (`item_id`, `response_id`) used for
  delta keying need to match the actual server schema. The existing
  `EventRouter` already classifies these events but doesn't read the
  ids; the model must look at the live server payload during
  implementation. If field names differ, the implementer should adjust
  the key extractor in `chatModel.ts`. No spec change needed.
- Tool args are captured opportunistically from
  `response.function_call_arguments.done`. If a future tool emits
  enormous args, the side-table should bound its memory. Slice keeps a
  simple `Map` keyed by call id and clears entries when the tool call
  reaches a terminal lifecycle phase.
