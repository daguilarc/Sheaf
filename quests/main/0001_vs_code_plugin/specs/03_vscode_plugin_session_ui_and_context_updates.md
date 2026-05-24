# VS Code Plugin Session UI and Context Updates

## Overview

The VS Code extension provides the user-facing voice interface for realtime agent
sessions. It starts and stops a realtime-agent session in manual mode, captures
microphone audio, streams that audio into the session, exposes a commit/respond
control, renders a focused chat pane, and pushes lightweight context invalidation
updates when editor state changes after the agent last checked it.

The extension owns VS Code integration and UI state. The realtime-agent library
owns the Realtime API websocket, session configuration, tool dispatch, event
persistence, and response queueing.

## Session Launch

The extension must launch realtime-agent sessions in manual turn mode:

```ts
{
  turnMode: {
    type: "manual"
  }
}
```

Manual mode means microphone audio may stream continuously or while the user is
speaking, but the model does not receive a committed turn until the extension
explicitly calls `commitAudioAndCreateResponse()`.

When a session starts, the extension must:

1. Create or reuse the configured realtime-agent session dependencies.
2. Start a `RealtimeAgentSession` with manual turn mode.
3. Establish microphone capture.
4. Convert microphone frames to the realtime-agent input format.
5. Stream audio frames into `session.sendAudioFrame()`.
6. Subscribe to realtime-agent conversation, transcript, tool lifecycle, and
   response events needed by the chat pane.

If microphone setup fails, the extension must stop the agent session and return
the UI to the inactive state with a visible error.

## Microphone Capture

The extension must establish a microphone connection while a session is active.
Captured audio must be converted to the format expected by realtime-agent:

- 24 kHz sample rate
- mono channel
- signed 16-bit PCM
- base64 encoded frames

The implementation should keep microphone capture in the extension host if the
platform allows it. A webview microphone adapter should only be introduced if the
extension host cannot reliably access microphone input or required permissions on
a supported platform. The session boundary remains the same: every encoded frame
is sent through `sendAudioFrame()`.

Stopping the session must stop microphone capture before closing or finalizing the
agent session.

## Controls

The extension UI must expose two primary controls.

### Start / Stop Session

One toggle button starts or stops the realtime session.

Inactive state:

- Label communicates that pressing it will start the session.
- Color communicates inactive or disconnected state.
- Pressing the button starts the session and microphone capture.

Active state:

- Label communicates that pressing it will stop the session.
- Color communicates active listening/session state.
- Pressing the button stops microphone capture and stops the agent session.

The button must reflect transient startup and shutdown states so duplicate clicks
do not create multiple sessions or race session cleanup.

### Commit And Create Response

One button commits the current audio buffer and requests a model response.

Behavior:

- Enabled only while a session is active.
- Calls `commitAudioAndCreateResponse()` on the active session.
- Uses the realtime-agent queue behavior so the request is queued if a response is
  already active.
- Does not interrupt an active response unless a future explicit UI option asks
  for cancellation.
- May show a pending state while the commit/respond request is queued.

## Default Keyboard Shortcuts

The extension must contribute default keybindings for both controls:

- `F16`: start/stop session toggle.
- `F20`: commit audio and create a response.

The keybindings should invoke VS Code commands contributed by the extension, not
depend on focus inside a specific webview or panel. They must be usable whenever
VS Code itself is focused, regardless of whether focus is in an editor, sidebar,
terminal, chat pane, quick pick, or other VS Code surface.

The commands should handle state internally:

- The `F16` command starts a session when inactive and stops it when active.
- The `F20` command commits/responds when a session is active and should no-op or
  show a brief status message when no session is active.
- Both commands must ignore duplicate invocations during transient startup,
  shutdown, or pending commit/respond transitions.

## Chat Pane

The extension must provide a chat pane that displays the meaningful conversation
surface without rendering every raw Realtime event.

Show chat bubbles for:

- User audio transcripts, displayed as user-authored messages even though they
  arrive as incoming Realtime transcription events.
- Agent text output, displayed as assistant messages.
- High-level tool calls, displayed as tool activity messages.
- Context pushes sent by the extension, displayed as context activity messages.
- Errors that affect the session or user-visible command outcome.

Do not show chat bubbles for:

- Raw websocket events.
- Individual audio frame append events.
- Low-level response lifecycle events such as `response.created` or
  `response.output_item.added`.
- Tool responses or full structured tool result payloads.

Tool call bubbles should summarize the tool at a high level, for example:

```text
Reading src/example.ts lines 40-90
```

They should not include full tool output. The model still receives full tool
results through the realtime-agent tool protocol.

Context push bubbles should summarize what was pushed without dumping full
structured payloads, for example:

```text
Context update: src/example.ts changed since last read
```

Context push bubbles should be simple individual bubbles for the initial
implementation. Collapsing or grouping several context pushes can be added later
if the chat pane becomes noisy.

## User Transcript Display

Input audio transcription events represent the user's spoken words. The chat pane
must render completed user transcripts as user bubbles.

Partial transcript deltas may be shown as an in-progress user bubble, but the UI
should collapse them into a single completed transcript bubble when transcription
finishes. The UI should avoid creating one bubble per transcript delta.

## Context Pushes

The extension must proactively notify the agent when editor context previously
observed by the agent may be stale. These notifications are structured context
messages, not tool responses.

Context pushes should use `sendStructuredContext()` and should not automatically
request a model response unless a later UX flow explicitly needs one. They are
conversation context for the model to use on a later turn.

## Changed Since Last Read

The extension must maintain per-file state for whether a file has changed since
the agent last read it.

State:

```ts
export interface FileFreshnessState
{
  file: string;
  changedSinceLastRead: boolean;
  notificationSent: boolean;
}
```

Behavior:

- When the agent reads any part of a file through a read/navigation tool, clear
  `changedSinceLastRead` and `notificationSent` for that file.
- When a file changes due to something other than an agent tool call, set
  `changedSinceLastRead` to `true`.
- If `changedSinceLastRead` is `true` and `notificationSent` is `false`, send one
  structured context notification to the agent and set `notificationSent` to
  `true`.
- Do not send duplicate notifications while `notificationSent` remains `true`.
- If the agent reads the file after a notification, clear the state.
- If the file changes again after the agent reads it, send a new notification.

The notification does not need to describe the diff. It only needs to tell the
agent that the file has changed since the last time the agent read it. The agent
can request the file or a range again if it needs details.

Example structured context:

```json
{
  "kind": "file_changed_since_last_read",
  "source": "vscode",
  "payload": {
    "file": "src/example.ts"
  },
  "summary": "src/example.ts changed since last read"
}
```

Changes caused by agent tool calls must not trigger this notification. The
extension should mark agent-initiated mutations so document change events caused
by those mutations can be ignored for this freshness state.

## Viewport Changed Since Last Check

The extension must maintain whether the active viewport has changed since the
agent last requested visible-range context.

State:

```ts
export interface ViewportFreshnessState
{
  changedSinceLastCheck: boolean;
  notificationSent: boolean;
}
```

Behavior:

- When the agent calls `read_visible_range` or a movement tool that returns a
  visible range, clear `changedSinceLastCheck` and `notificationSent`.
- When the visible viewport changes due to user scrolling, editor reveal, tab
  switch, or another non-agent action, set `changedSinceLastCheck` to `true`.
- If `changedSinceLastCheck` is `true` and `notificationSent` is `false`, send one
  structured context notification and set `notificationSent` to `true`.
- Do not send duplicate viewport notifications until the agent requests visible
  range context again.

Example structured context:

```json
{
  "kind": "viewport_changed_since_last_check",
  "source": "vscode",
  "payload": {
    "file": "src/example.ts"
  },
  "summary": "Visible range changed since last check"
}
```

The notification does not need to include the new visible range. The agent can
call `read_visible_range` if it needs the current viewport.

## Cursor Changed Since Last Check

The extension must maintain whether the cursor position has changed since the
agent last requested cursor or visible-range context.

State:

```ts
export interface CursorFreshnessState
{
  changedSinceLastCheck: boolean;
  notificationSent: boolean;
}
```

Behavior:

- When the agent calls `read_visible_range`, `set_cursor_position`, or another
  tool that returns cursor position, clear `changedSinceLastCheck` and
  `notificationSent`.
- When the cursor moves due to user action or another non-agent action, set
  `changedSinceLastCheck` to `true`.
- If `changedSinceLastCheck` is `true` and `notificationSent` is `false`, send one
  structured context notification and set `notificationSent` to `true`.
- Do not send duplicate cursor notifications until the agent requests cursor or
  visible-range context again.

Example structured context:

```json
{
  "kind": "cursor_changed_since_last_check",
  "source": "vscode",
  "payload": {
    "file": "src/example.ts"
  },
  "summary": "Cursor position changed since last check"
}
```

The notification does not need to include the new cursor position. The agent can
call `read_visible_range` or another navigation tool if it needs the current
position.

## Agent-Originated Changes

The extension must distinguish agent-originated changes from user/external
changes.

Agent-originated actions include:

- Tool calls that move the cursor.
- Tool calls that move the viewport.
- Future tool calls that edit or type code.

State changes caused by these actions should update the extension's internal
freshness state as if the agent already knows about the resulting state. They
should not produce "changed since last check" notifications back to the agent.

## Deferred Enhancements

- Collapse or group repeated context push bubbles if the initial simple display
  becomes noisy.
- Add a webview microphone adapter only if extension-host capture is not reliable
  enough on a supported platform.
