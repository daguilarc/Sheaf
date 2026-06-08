# Slice 0005 `pi_agent_lifecycle` — Implementation Accepted

## Summary

The Pi agent lifecycle slice is accepted. The implementation matches the physical plan
and slice spec: the in-memory `(pile, sessionId)` registry, Pi SDK adapter, per-session
runtime, lifecycle event emitter, and first-turn summarization path are all present and
correctly wired.

## Verified behavior

- **State machine**: sessions move through `cold`/`starting`/`active`/`idle`/`stopping`/
  `failed` with status events emitted on transitions.
- **New session**: `createBlankSession` validates pile/root/model and allocates the
  session shell without writing a manifest; the manifest is deferred until the first
  assistant message completes, with summarizer output and a deterministic first-line
  fallback.
- **Resume**: cold resume reconstructs from manifest + Pi JSONL (fixture-backed test);
  hot resume shares the existing registry entry; concurrent attachers share a single
  startup via the per-key startup lock.
- **Messaging**: first-message acceptance is reported before delivery; streaming
  messages steer (`steer: true`) or fall back to `prompt(..., { streamingBehavior:
  "followUp" })`.
- **Model switching**: validated through the slice-4 registry, applied via
  `session.setModel`, manifest updated when present, model event emitted.
- **Idle offload**: flushes/disposes only with no clients and no active run/tool;
  blocked mid-run and mid-tool (fake-timer tests).

## Review history

Two issues were filed in the first review cycle and have both been fixed and verified:

- **PL-0001 (completed)** — `LifecycleEmitter.EmitError` no longer emits on the reserved
  `EventEmitter` `"error"` event when there are no subscribers (guarded by
  `listenerCount`), eliminating the throw / unhandled-rejection crash risk on the
  non-fatal delivery path, the fire-and-forget manifest-write path, and the startup
  path (callers now receive the typed `AgentManagerError`). Regression tests assert no
  throw with no subscriber, no rejection on delivery failure, and recorded status on
  manifest-write failure.
- **PL-0002 (completed)** — `SessionRuntimeRecord.lastError` is now populated via
  `SessionRuntime.ReportError` on delivery, manifest-write, and startup failures; the
  failed runtime is retained in the manager map so `getStatus().error` reports the
  reason. Tests assert `status.error` for both delivery and startup failures.

No open issues remain.
