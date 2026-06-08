# Slice 0005 Implementation Complete

## Summary

Implemented the in-memory `(pile, sessionId)` agent registry, Pi SDK adapter, session runtime, lifecycle event emitter, and summarization path for Sheaf Chat agent lifecycle management.

## Delivered

- **Lifecycle emitter** (`lifecycle.ts`): `SessionKey` helpers, `LifecycleEmitter`, and typed events for status, model, user-message acceptance, Pi agent events, manifest updates, and errors.
- **Summarizer** (`summarizer.ts`): injectable first-turn summary generation with deterministic first-line fallback via `BuildDeterministicSummary` and `CreateSessionSummarizer`.
- **Pi adapter** (`piAdapter.ts`): `CreateSheafPiSession` wiring Sheaf auth/model registry, scoped tools only (`noTools: "builtin"` + allowlist), local provider extension, and `SessionManager.open` for new/cold sessions.
- **Session runtime** (`sessionRuntime.ts`): per-session state tracking, Pi event handling, deferred initial manifest write after first assistant completion, steer/followUp message delivery, model updates, cancellation, and idle offload guards for active runs/tools.
- **Agent manager** (`manager.ts`): `createBlankSession`, `attachSession` (hot/cold resume with startup lock), `submitUserMessage`, `selectModel`, `cancelTurn`, `markClientDetached`, and `getStatus`.

## Validation

- `npm test` — 67 unit tests pass, including lifecycle state transitions, manifest deferral, summary fallback, cold resume from manifest/JSONL fixture, hot resume shared entry, steer/followUp behavior, model switching, cancellation, idle offload with fake timers, and offload prevention during active runs/tools.
