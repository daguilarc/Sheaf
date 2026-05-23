# Slice 0001 — Session API and Turn Mode

## Objective

Extend the realtime-agent library so callers can choose between server-VAD
behavior (current default) and a new manual turn mode, and so callers have an
explicit, typed Session API for committing audio, sending text, sending
structured context, and emitting arbitrary Realtime client events. This slice
delivers the surface required by Spec 01, excluding the response queue (which
is its own slice). It is the foundation that the VS Code extension and later
slices depend on.

## Scope

In scope:

- `RealtimeAgentTurnMode` type and `AgentStartConfig.turnMode` field.
- Session config branching for `server_vad` vs `manual` modes.
- New `RealtimeAgentSession` methods:
  - `commitAudio()`
  - `createResponse()`
  - `commitAudioAndCreateResponse()`
  - `sendTextMessage()`
  - `sendStructuredContext()`
  - `sendRealtimeEvent()`
  - `clearAudioBuffer()`
- `QueueRequestOptions`, `CreateResponseOptions`, `SendMessageOptions`,
  `QueuedEventResult`, `ResponseQueuePolicy`, `StructuredContextMessage` types.
- Synchronous send paths for non-queued events (queue logic lives in slice 0002).
  Methods returning `Promise<QueuedEventResult>` should resolve immediately with
  a "sent" result in this slice, so the API surface and call sites are stable
  before queueing is wired in.

Out of scope:

- Response queue policies/active-response tracking (slice 0002).
- VS Code extension (slice 0003+).
- New navigation/reading tools (slice 0004).

## Key Files / Systems Affected

- `apps/realtime-agent/src/types.ts` — extend `AgentStartConfig`,
  `RealtimeAgentSession` and add the new option/result types.
- `apps/realtime-agent/src/session_config.ts` — accept turn mode and build
  `audio.input.turn_detection` accordingly. Default keeps the current
  server-VAD configuration; `manual` mode sets `turn_detection: null`.
- `apps/realtime-agent/src/agent_loop.ts` — accept `turnMode`, wire it into the
  session.update event, and implement the new methods on
  `RealtimeAgentSessionImpl`. New methods all funnel through the existing
  `SendOutgoing(event)` path so persistence and routing keep working.
- `apps/realtime-agent/src/index.ts` — export the new types.
- `apps/realtime-agent/test/agent_loop/agent_loop.test.ts` — add tests for the
  new behaviors. May add new test files under `test/agent_loop/` if file size
  warrants a split.
- `apps/realtime-agent/test/exports.test.ts` — ensure new exports surface.

## APIs To Reuse As-Is

- `EventRouter.routeOutgoingEvent` / `RealtimeAgentSessionImpl.SendOutgoing`
  for any new outbound event. These already handle classification and
  persistence; new senders should not bypass them.
- `buildFunctionCallOutputEvent` style of small builder helpers from
  `tooling.ts` as a pattern for new event builders in `agent_loop.ts` (or a
  new `event_builders.ts` if helpers grow).
- `EventsRepo.shouldPersistOutgoingEvent` — already filters
  `input_audio_buffer.append`. Other new events (`commit`, `clear`,
  `response.create`, etc.) are non-audio and persist as today.

## APIs To Extend / Modify

- `buildSessionUpdateEvent(toolCallSet)` — change signature to
  `buildSessionUpdateEvent(toolCallSet, turnMode)`. When `turnMode.type` is
  `manual`, emit `turn_detection: null`. When `server_vad`, emit current
  default values, overridden by any caller-supplied fields. Default value of
  the parameter must reproduce today's behavior so existing call sites and
  tests stay green if no turn mode is provided.
- `AgentStartConfig` — add optional `turnMode`. Default in `startAgentSession`
  is `{ type: "server_vad", silenceDurationMs: 500, createResponse: true,
  interruptResponse: true }` (matching the spec).
- `RealtimeAgentSession` — extend the public interface with the new methods.
- `RealtimeAgentSessionImpl` — implement the new methods. `sendAudioFrame()`
  continues to work in both modes (it just appends to the input buffer).

## Design Notes

### Turn mode handling

Add a small helper `BuildAudioTurnDetectionConfig(turnMode)` in
`session_config.ts` that returns either `null` (manual) or the populated
server-VAD object. `buildSessionUpdateEvent` plugs the result into
`session.audio.input.turn_detection`.

`startAgentSession` resolves the default turn mode and passes it through.

### Method semantics

- `commitAudio(options?)`: sends `{ type: "input_audio_buffer.commit" }`.
- `createResponse(options?)`: sends `{ type: "response.create", response?:
  options.response }` (omit the `response` property if not provided).
- `commitAudioAndCreateResponse(options?)`: sends both events in order. In
  slice 0001 this is two `SendOutgoing` calls; slice 0002 will wrap the pair
  in one queued operation.
- `sendTextMessage(text, options?)`: builds the spec's
  `conversation.item.create` user message with a single `input_text` part. If
  `options.createResponse === true`, also sends `response.create` after the
  message. Empty text must throw a `TypeError` (or equivalent typed error) so
  callers see misuse early — there is no legitimate empty user text turn.
- `sendStructuredContext(message, options?)`: builds a
  `conversation.item.create` user message whose single `input_text` content is
  `JSON.stringify({ kind, source, payload, summary? })`. `summary` is omitted
  from the JSON when undefined. If `options.createResponse === true`, also
  sends `response.create`.
- `sendRealtimeEvent(event, options?)`: validates `event.type` is a non-empty
  string (throw otherwise). Calls `SendOutgoing(event)`. Routing/persistence
  treat unknown events as `unknown`, which is acceptable.
- `clearAudioBuffer(options?)`: sends `{ type: "input_audio_buffer.clear" }`.

### `QueuedEventResult` shape for slice 0001

```ts
export interface QueuedEventResult {
  status: "sent" | "queued" | "rejected" | "cancelled";
  reason?: string;
}
```

Slice 0001 always returns `{ status: "sent" }`. Slice 0002 introduces the
other statuses without changing the type signature.

### Persistence behavior

No schema changes. All new events (other than `input_audio_buffer.append`,
which is unchanged) persist through `EventsRepo.persistEvent`.
`input_audio_buffer.commit`, `input_audio_buffer.clear`, and `response.create`
classify as `unknown` outgoing today; this is acceptable for now. If
classification gaps cause noise in callbacks, extend `classifyOutgoingEvent`
in this slice with explicit cases (`audio_buffer_commit`,
`audio_buffer_clear`) only if needed by tests; otherwise leave the router
untouched to minimize churn.

Decision rule: extend `classifyOutgoingEvent` only when an existing test or
the new tests require it. Otherwise do not add new outgoing event classes in
this slice.

## Validation

- New unit tests under `test/agent_loop/` for:
  - Default `server_vad` session.update matches today's snapshot (no change).
  - `turnMode: { type: "manual" }` produces `turn_detection: null`.
  - Custom `server_vad` overrides (`silenceDurationMs`, `threshold`,
    `prefixPaddingMs`, `createResponse`, `interruptResponse`) flow into the
    session.update payload.
  - `commitAudio`, `createResponse`, `commitAudioAndCreateResponse`,
    `clearAudioBuffer` each emit the expected JSON to the fake socket.
  - `sendTextMessage` emits one `conversation.item.create` with an
    `input_text` part. With `createResponse: true`, also emits
    `response.create` after it.
  - `sendStructuredContext` emits a `conversation.item.create` whose
    `input_text` text parses to the expected envelope JSON.
  - `sendRealtimeEvent` forwards arbitrary events and rejects empty `type`.
- `exports.test.ts` confirms the new types and runtime symbols are exported.
- `npm test` in `apps/realtime-agent` passes.

## Risks / Open Concerns

- None requiring escalation. The Open Questions section in Spec 01 about
  non-user `conversation.item.create` roles is out of scope for this quest;
  the slice exposes only the user-role helpers described in the spec.
