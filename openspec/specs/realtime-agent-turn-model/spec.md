# Capability: Turn Model

Project: `projects/realtime-agent`
ID prefix: `turn` — requirement IDs are append-only; never renumber or reuse.

## Purpose

Realtime Agent supports two turn-detection modes: server VAD (the CLI
default — the API infers end-of-speech from silence and answers on its own)
and manual (the extension default — audio streams continuously and the model
answers only on an explicit commit-and-respond). This capability owns the
`session.update` payload that configures a session and the response queue
that serializes everything capable of starting a model response.

## Requirements

### Requirement: turn-1 — Turn-mode type and default
THE library SHALL accept `RealtimeAgentTurnMode` as either `{ type: "server_vad", silenceDurationMs?, threshold?, prefixPaddingMs?, createResponse?, interruptResponse? }` or `{ type: "manual" }`; WHEN `AgentStartConfig.turnMode` is omitted, THE library SHALL use `{ type: "server_vad", silenceDurationMs: 500, createResponse: true, interruptResponse: true }`.

#### Scenario: Turn mode omitted
- **WHEN** `AgentStartConfig.turnMode` is omitted
- **THEN** the session uses `{ type: "server_vad", silenceDurationMs: 500, createResponse: true, interruptResponse: true }`

#### Scenario: Explicit turn mode
- **WHEN** `AgentStartConfig.turnMode` is given as a `server_vad` object or `{ type: "manual" }`
- **THEN** the library accepts it as the session's turn mode

### Requirement: turn-2 — `session.update` payload shape
THE `session.update` event SHALL have the exact shape in Contracts: `session.type = "realtime"`, `output_modalities = ["text"]` (text-only output in every mode), 24 kHz `audio/pcm` input format, transcription model `gpt-4o-mini-transcribe`, the turn-detection object, and one `{type:"function", name, description, parameters}` entry per tool in tool-call-set order.

#### Scenario: Session configured
- **WHEN** the session transmits its `session.update` event
- **THEN** the payload matches the Contracts shape: `"realtime"` session type, text-only output modalities, 24 kHz `audio/pcm` input, `gpt-4o-mini-transcribe` transcription, the turn-detection object, and one function entry per tool in tool-call-set order

### Requirement: turn-3 — Turn-detection object per mode
WHERE the turn mode is `server_vad`, THE turn-detection object SHALL be `{"type": "server_vad", "silence_duration_ms": <default 500>, "create_response": <default true>, "interrupt_response": <default true>}` with `threshold` and `prefix_padding_ms` included only when set; WHERE the mode is `manual`, `turn_detection` SHALL be `null`.

#### Scenario: Server-VAD mode
- **WHEN** a session is configured with `server_vad` turn mode
- **THEN** `turn_detection` is the server-VAD object with defaults applied, including `threshold` and `prefix_padding_ms` only when set

#### Scenario: Manual mode
- **WHEN** a session is configured with manual turn mode
- **THEN** `turn_detection` is `null`

### Requirement: turn-4 — No initial response in manual mode
WHERE the mode is `manual`, startup SHALL NOT send an initial `response.create` (server-VAD startup does; see [session-lifecycle](../realtime-agent-session-lifecycle/spec.md) ses-6).

#### Scenario: Manual-mode startup
- **WHEN** a manual-mode session completes startup
- **THEN** no initial `response.create` is sent

### Requirement: turn-5 — `createResponse` submits a queued unit
WHEN `createResponse(options)` is called, THE session SHALL submit a `{"type": "response.create"}` (with a `response` field equal to `options.response` when provided) as a response-affecting unit on the response queue.

#### Scenario: createResponse called
- **WHEN** `createResponse(options)` is called
- **THEN** a `{"type": "response.create"}` unit — carrying `response: options.response` when provided — is submitted to the response queue

### Requirement: turn-6 — Atomic commit-and-respond
WHEN `commitAudioAndCreateResponse(options)` is called, THE session SHALL submit `input_audio_buffer.commit` followed by `response.create` as one atomic unit: the two events are transmitted back-to-back and no other queued unit can interleave between them.

#### Scenario: commitAudioAndCreateResponse called
- **WHEN** `commitAudioAndCreateResponse(options)` is called
- **THEN** `input_audio_buffer.commit` and `response.create` are transmitted back-to-back as one atomic unit with no other queued unit interleaved

### Requirement: turn-7 — Response-queue busy predicate
THE response queue SHALL treat itself as busy while any of: (a) a server response is active (`response.created` received and no terminal event yet), (b) an outbound `response.create` has been transmitted but `response.created` has not yet arrived, or (c) at least one pending tool-output hold is registered (turn-11).

#### Scenario: Active server response
- **WHEN** `response.created` has been received and no terminal event has arrived yet
- **THEN** the queue is busy

#### Scenario: In-flight response.create
- **WHEN** an outbound `response.create` has been transmitted but `response.created` has not yet arrived
- **THEN** the queue is busy

#### Scenario: Pending tool-output hold
- **WHEN** at least one pending tool-output hold is registered
- **THEN** the queue is busy

### Requirement: turn-8 — Idle dispatch and enqueue policy
WHEN a response-affecting unit is submitted and the queue is not busy, THE unit SHALL run immediately and the call resolve `{ status: "sent" }`; WHEN busy with policy `enqueue` (the default), the unit SHALL be appended FIFO and the call resolve `{ status: "queued" }`.

#### Scenario: Queue idle
- **WHEN** a response-affecting unit is submitted while the queue is not busy
- **THEN** the unit runs immediately and the call resolves `{ status: "sent" }`

#### Scenario: Queue busy with enqueue policy
- **WHEN** a unit is submitted with policy `enqueue` (the default) while the queue is busy
- **THEN** the unit is appended FIFO and the call resolves `{ status: "queued" }`

### Requirement: turn-9 — Reject and cancel_current policies
WHEN busy with policy `reject`, THE call SHALL resolve `{ status: "rejected", reason: "response_active" }` without sending anything; WHEN busy with policy `cancel_current`, THE queue SHALL transmit `{"type": "response.cancel"}` — including `response_id` when the active response's id is known — enqueue the unit, and resolve `{ status: "queued", reason: "cancelling_active" }`.

#### Scenario: Queue busy with reject policy
- **WHEN** a unit is submitted with policy `reject` while the queue is busy
- **THEN** the call resolves `{ status: "rejected", reason: "response_active" }` and nothing is sent

#### Scenario: Queue busy with cancel_current policy
- **WHEN** a unit is submitted with policy `cancel_current` while the queue is busy
- **THEN** the queue transmits `{"type": "response.cancel"}` (with `response_id` when the active response's id is known), enqueues the unit, and resolves `{ status: "queued", reason: "cancelling_active" }`

### Requirement: turn-10 — Terminal events clear and drain
WHEN `response.done` or `response.cancelled` arrives, or an incoming `error` event carries a `response_id` (top-level or under `error`) equal to the active response's id, THE queue SHALL clear the active-response state and drain queued units FIFO until it is busy again or empty.

#### Scenario: Terminal response event
- **WHEN** `response.done` or `response.cancelled` arrives
- **THEN** the queue clears the active-response state and drains queued units FIFO until busy again or empty

#### Scenario: Error for the active response
- **WHEN** an incoming `error` event carries a `response_id` (top-level or under `error`) equal to the active response's id
- **THEN** the queue clears the active-response state and drains queued units FIFO until busy again or empty

### Requirement: turn-11 — Pending tool-output holds
WHEN a model function call is detected (via `response.function_call_arguments.done` or a `function_call` item in a terminal `response.done`) whose `function_call_output` has not yet been transmitted, THE queue SHALL register a hold for that `call_id` and remain busy until the corresponding outgoing `function_call_output` is transmitted, so externally queued units cannot run ahead of a tool result the model is waiting for. Holds are keyed by `call_id`; duplicate registration is a no-op.

#### Scenario: Function call detected
- **WHEN** a model function call is detected and its `function_call_output` has not yet been transmitted
- **THEN** the queue registers a hold for that `call_id` and remains busy

#### Scenario: Tool output transmitted
- **WHEN** the outgoing `function_call_output` for a held `call_id` is transmitted
- **THEN** that hold is released

#### Scenario: Duplicate hold registration
- **WHEN** a hold is registered again for a `call_id` that already has one
- **THEN** the registration is a no-op

## Contracts

### `session.update` payload (worked example, server VAD defaults)

```json
{
  "type": "session.update",
  "session": {
    "type": "realtime",
    "output_modalities": ["text"],
    "audio": {
      "input": {
        "format": { "type": "audio/pcm", "rate": 24000 },
        "transcription": { "model": "gpt-4o-mini-transcribe" },
        "turn_detection": {
          "type": "server_vad",
          "silence_duration_ms": 500,
          "create_response": true,
          "interrupt_response": true
        }
      }
    },
    "tools": [
      { "type": "function", "name": "echo", "description": "…", "parameters": { "type": "object" } }
    ]
  }
}
```

Manual mode: identical except `"turn_detection": null`. The same `session`
object is stored as the session row's `session_config_json`
([persistence](../realtime-agent-persistence/spec.md)).

### Queue policies

| `queuePolicy` | Queue idle | Queue busy |
|---|---|---|
| `enqueue` (default) | run now → `{"status":"sent"}` | FIFO append → `{"status":"queued"}` |
| `reject` | run now → `{"status":"sent"}` | `{"status":"rejected","reason":"response_active"}`, nothing sent |
| `cancel_current` | run now → `{"status":"sent"}` | send `response.cancel` (+`response_id` if known), append → `{"status":"queued","reason":"cancelling_active"}` |

Operations that go through the queue: `createResponse()`,
`commitAudioAndCreateResponse()`, `sendTextMessage`/`sendStructuredContext`
with `createResponse: true`, `sendRealtimeEvent` of a `response.create`, and
tool follow-up responses (always `enqueue`). Operations that bypass it:
`commitAudio()`, `clearAudioBuffer()`, `sendAudioFrame()`,
`sendRealtimeEvent` of `response.cancel` and of any non-response type.

### Server-side caveat

Committing an empty audio buffer is rejected by the Realtime API; that
surfaces as an incoming `error` event through normal routing — the library
does not pre-validate commits.

## Design

- `src/agent/src/session_config.ts` — `buildSessionUpdateEvent` and
  `BuildAudioTurnDetectionConfig`; constants `x_pcmSampleRate = 24000`,
  `x_serverVadSilenceDurationMs = 500`.
- `src/agent/src/response_queue.ts` — `ResponseQueue`: busy predicate
  (`IsBusy`), `SubmitResponseAffectingUnit`, terminal handling
  (`OnIncomingEvent`), pending-tool-output holds
  (`RegisterPendingToolOutput` / cleared in `NotifyOutgoingTransmitted` when
  a matching `function_call_output` goes out), re-entrancy-guarded
  `TryDrain`.
- `agent_loop.ts` reserves holds *before* letting the queue observe a
  terminal `response.done` (`ReserveToolOutputHolds` runs ahead of
  `OnIncomingEvent`), and reserves on both the streaming
  (`function_call_arguments.done`) and batch (`response.done`) paths because
  streaming dispatch can transmit its output before the terminal event
  arrives.
- Tests: `tests/agent/agent_loop/response_queue.test.ts`,
  `tests/agent/agent_loop/session_api_and_turn_mode.test.ts`,
  `tests/agent/events/session_config.test.ts`.

## Interactions

- [session-lifecycle](../realtime-agent-session-lifecycle/spec.md) — startup sequence and the
  session API methods that feed the queue.
- [tool-dispatch](../realtime-agent-tool-dispatch/spec.md) — follow-up `response.create` units and
  the `function_call_output` events that release holds.
- [cli](../realtime-agent-cli/spec.md) — uses the default server-VAD mode.
- [vscode-extension](../realtime-agent-vscode-extension/spec.md) — always starts manual-mode
  sessions; F20 maps to `commitAudioAndCreateResponse()`.
