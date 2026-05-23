# VS Code Plugin Overview and Realtime Agent Updates

## Quest Overview

Build a VS Code extension that lets a developer drive repository work by voice.
The extension listens to the microphone, starts and manages realtime agent loops,
and routes user intent into editor actions. The extension will eventually be able
to navigate the codebase, request language-server context, inspect editor state,
and type or edit code through explicit tools.

This document covers the preliminary realtime-agent changes required before the
extension-specific tool surface is designed.

## Goals

- Make realtime-agent turn handling configurable per session.
- Preserve the current voice activity detection behavior as the default path.
- Add an explicit-turn mode where callers decide when to commit audio and when
  to request a model response.
- Expose session APIs for audio append, audio commit, response creation, and
  arbitrary Realtime client events.
- Expose a structured context API so editor state, language-server results, and
  tool-derived context can be sent without flattening everything into ad hoc prose.
- Queue externally requested commits and responses while the model is already
  responding, rather than interrupting active generation.
- Define the OpenAI Realtime event shapes the extension should send for text,
  audio, and response control.

## Non-Goals

- This spec does not define the VS Code tool catalog yet.
- This spec does not define command palette entries, UI panels, or editor
  keybindings.
- This spec does not require speech output; the current realtime-agent session
  remains text-output focused unless a later spec changes output modalities.
- This spec does not introduce a public HTTP server for the realtime agent.

## Current Realtime Agent Behavior

The current CLI creates a realtime session, captures microphone audio, chunks it
as 24 kHz mono signed 16-bit PCM, encodes each 100 ms frame as base64, and sends
each frame as:

```json
{
  "type": "input_audio_buffer.append",
  "audio": "<base64 pcm frame>"
}
```

Session configuration enables server VAD:

```json
{
  "type": "session.update",
  "session": {
    "type": "realtime",
    "output_modalities": ["text"],
    "audio": {
      "input": {
        "format": {
          "type": "audio/pcm",
          "rate": 24000
        },
        "transcription": {
          "model": "gpt-4o-mini-transcribe"
        },
        "turn_detection": {
          "type": "server_vad",
          "silence_duration_ms": 500,
          "create_response": true,
          "interrupt_response": true
        }
      }
    }
  }
}
```

With that configuration, the server detects speech boundaries, commits audio, and
automatically creates model responses after silence.

The main realtime model remains `gpt-realtime-2` by default. The
`gpt-4o-mini-transcribe` value above is only the input audio transcription model
inside the session audio configuration.

## OpenAI Realtime Events

The extension and realtime-agent APIs should use these client events:

- `input_audio_buffer.append`: append base64 PCM audio to the current input
  buffer.
- `input_audio_buffer.commit`: commit the current input audio buffer, creating a
  user message item and triggering transcription when transcription is enabled.
  This does not create a model response by itself.
- `input_audio_buffer.clear`: clear buffered input audio before starting a new
  utterance or after a discarded turn.
- `conversation.item.create`: add a conversation item such as a text user message,
  system/developer context message, or tool/function output.
- `response.create`: ask the model to generate a response from the current
  conversation state.
- `response.cancel`: cancel an in-progress response. This should not be used by
  the default queued behavior, but should remain available through the arbitrary
  event API for explicit callers.

Text messages should be sent with `conversation.item.create`:

```json
{
  "type": "conversation.item.create",
  "item": {
    "type": "message",
    "role": "user",
    "content": [
      {
        "type": "input_text",
        "text": "Explain the active file."
      }
    ]
  }
}
```

A response should then be requested with:

```json
{
  "type": "response.create"
}
```

Manual audio turns should use this sequence:

1. Send one or more `input_audio_buffer.append` events.
2. Send `input_audio_buffer.commit`.
3. Send `response.create`.

## Turn Detection Modes

Add a `turnMode` option to `AgentStartConfig`.

```ts
type RealtimeAgentTurnMode =
  | {
      type: "server_vad";
      silenceDurationMs?: number;
      threshold?: number;
      prefixPaddingMs?: number;
      createResponse?: boolean;
      interruptResponse?: boolean;
    }
  | {
      type: "manual";
    };
```

When omitted, `turnMode` must default to the current behavior:

```ts
{
  type: "server_vad",
  silenceDurationMs: 500,
  createResponse: true,
  interruptResponse: true
}
```

When `turnMode.type` is `manual`, the session update must set
`audio.input.turn_detection` to `null`. In manual mode, the model must not respond
to appended audio until the caller explicitly commits the audio buffer and asks
for a response.

## Exported Session API

Extend `RealtimeAgentSession` beyond `sendAudioFrame()` and `stop()`.

```ts
export interface RealtimeAgentSession
{
  readonly sessionId: string;

  sendAudioFrame(pcmBase64OrBuffer: string | Buffer): void;
  commitAudio(options?: QueueRequestOptions): Promise<QueuedEventResult>;
  createResponse(options?: CreateResponseOptions): Promise<QueuedEventResult>;
  commitAudioAndCreateResponse(options?: CreateResponseOptions): Promise<QueuedEventResult>;
  sendTextMessage(text: string, options?: SendMessageOptions): Promise<QueuedEventResult>;
  sendStructuredContext(context: StructuredContextMessage, options?: SendMessageOptions): Promise<QueuedEventResult>;
  sendRealtimeEvent(event: RealtimeEvent, options?: QueueRequestOptions): Promise<QueuedEventResult>;
  clearAudioBuffer(options?: QueueRequestOptions): Promise<QueuedEventResult>;
  stop(reason: string): Promise<SessionRow>;
}
```

`sendTextMessage()` should send `conversation.item.create` with a user
`input_text` message. If `options.createResponse` is true, it should also enqueue
`response.create`.

`commitAudioAndCreateResponse()` is a convenience API for the common manual-mode
case. It should enqueue `input_audio_buffer.commit` followed by `response.create`
as one ordered operation.

`sendStructuredContext()` should send structured editor and repository context to
the model as a `conversation.item.create` user message. The content should be
serialized as JSON inside an `input_text` part with a stable envelope so the model
can distinguish context from natural-language user commands.

```ts
export interface StructuredContextMessage
{
  kind: string;
  source: "vscode" | "language_server" | "tool" | "system";
  payload: Record<string, unknown>;
  summary?: string;
}
```

The emitted text should use an explicit envelope:

```json
{
  "kind": "structured_context",
  "source": "language_server",
  "payload": {
    "activeFile": "src/example.ts",
    "symbols": []
  }
}
```

`sendRealtimeEvent()` is the escape hatch for advanced callers. It should validate
that `event.type` is a non-empty string, persist and route the outgoing event, and
apply queue behavior when the event can affect response generation.

## Queue Behavior

The realtime agent should own response queue management. Callers should be able to
request a turn without manually tracking whether the model is already responding.

Add queue options to the API:

```ts
export type ResponseQueuePolicy = "enqueue" | "reject" | "cancel_current";

export interface QueueRequestOptions
{
  queuePolicy?: ResponseQueuePolicy;
}

export interface CreateResponseOptions extends QueueRequestOptions
{
  response?: Record<string, unknown>;
}

export interface SendMessageOptions extends QueueRequestOptions
{
  createResponse?: boolean;
  previousItemId?: string;
}
```

Default policy must be `enqueue`.

Queued requests are only for live session coordination. They do not need crash
recovery or SQLite persistence. If the process or websocket session fails, callers
can start a new realtime session.

The session should track whether a response is active using server events such as
`response.created`, `response.done`, and response cancellation/error terminal
events. While active:

- `enqueue`: store response-affecting requests in FIFO order and send them after
  the current response reaches a terminal state.
- `reject`: return a rejected or failed result without sending the event.
- `cancel_current`: send `response.cancel`, then send the queued request after the
  active response reaches a terminal state.

Response-affecting requests include `response.create`, `input_audio_buffer.commit`
when paired with response creation, and helper APIs such as `sendTextMessage()`
or `sendStructuredContext()` with `createResponse: true`. The VS Code tool
protocol will specify which editor actions require a response after their context
or result is sent.

Plain `input_audio_buffer.append` can continue to stream immediately, but in
manual mode the resulting turn is not committed until `commitAudio()` is called.
If callers need strict turn isolation, they should use `clearAudioBuffer()` before
starting a new manual audio turn.

## VAD Mode Semantics

In `server_vad` mode, the agent should behave as it does today. Audio frames are
appended immediately, the server detects speech start/stop, and
`createResponse: true` allows the server to request responses automatically.

The default `server_vad` config should continue to set `interruptResponse: true`
to preserve current behavior. Callers that want no interruption while still using
VAD can set:

```ts
{
  type: "server_vad",
  createResponse: true,
  interruptResponse: false
}
```

## Manual Mode Semantics

In `manual` mode:

- Appended audio only fills the input buffer.
- `commitAudio()` sends `input_audio_buffer.commit`.
- `createResponse()` sends `response.create`.
- `commitAudioAndCreateResponse()` sends both events as one queued operation.
- No response should be interrupted unless the caller opts into `cancel_current`.

This gives the VS Code extension push-to-talk and command-boundary control. For
example, it can keep recording while the user holds a key, then call
`commitAudio()` and `createResponse()` on key release.

## Intended VS Code Plugin Direction

The VS Code extension will use the realtime-agent library rather than duplicating
Realtime websocket logic. The extension should own editor integration and provide
tools for repository navigation, language-server context, current editor state,
and code insertion/editing. The realtime agent should own Realtime API transport,
session persistence, tool dispatch, and response queueing.

The extension should be able to start an agent loop with either VAD mode for
hands-free conversation or manual mode for explicit command turns. Later specs
will define exact extension commands, microphone lifecycle, tool schemas, and
editor mutation safety rules. Those tool schemas will also declare whether a tool
result or editor action should automatically request a follow-up model response.

## Open Questions

- Should arbitrary `conversation.item.create` support roles beyond `user`, or
  should non-user context use a narrower dedicated API?
- What editor actions require user confirmation before the agent can execute
  them?
