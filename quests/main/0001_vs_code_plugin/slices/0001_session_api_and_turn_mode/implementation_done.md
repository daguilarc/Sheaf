# Implementation complete — slice 0001_session_api_and_turn_mode

## Summary

Implemented configurable **turn modes** (`server_vad` default vs `manual`), **`session.update`** wiring via `BuildAudioTurnDetectionConfig` / `buildSessionUpdateEvent(toolCallSet, turnMode)`, and **startup behavior** so the initial `response.create` is skipped in manual mode only.

Extended **`RealtimeAgentSession`** with `commitAudio`, `createResponse`, `commitAudioAndCreateResponse`, `sendTextMessage`, `sendStructuredContext`, `sendRealtimeEvent`, and `clearAudioBuffer`, all routing through existing `SendOutgoing` and returning `{ status: "sent" }` for this slice. Added the spec-aligned option/result types and exported them from the library entry point.

## Tests

- New coverage in `test/agent_loop/session_api_and_turn_mode.test.ts` and extra cases in `test/events/session_config.test.ts`.
- Updated `test/cli/cli.test.ts` session stub to satisfy the widened session interface.
- Extended `test/exports.test.ts` for new public types.

`npm test` in `apps/realtime-agent` passes (73 tests).
