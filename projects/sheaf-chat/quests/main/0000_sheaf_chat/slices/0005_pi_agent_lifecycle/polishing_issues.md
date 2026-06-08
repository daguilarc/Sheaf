# Issues

## Issue PL-0001

- status: completed
- owner_role: polisher_reviewer
- created_at: 2026-06-08T22:16:28Z
- updated_at: 2026-06-08T22:21:43Z
- title: LifecycleEmitter emits on reserved "error" event; throws/crashes when no listener attached
- details: ## Problem

`LifecycleEmitter` (src/agents/lifecycle.ts) extends Node's `EventEmitter` and emits
lifecycle errors on the **reserved `"error"` event name**:

```ts
EmitError(event: LifecycleErrorEvent): void {
  this.emit("error", event);
}
```

Node's `EventEmitter` gives `"error"` special semantics: if `emit("error", …)` is
called and **no listener is registered for `"error"`**, Node throws. Because the
payload here is a plain object (not an `Error`), it throws an `ERR_UNHANDLED_ERROR`
(`Unhandled 'error' event`). Nothing in this slice registers a default `"error"`
listener on the emitter (verified: `grep` of src/ finds only the `emit("error", …)`
call and the type-union member; `LifecycleEmitter` has no constructor / no default
listener). The emitter is created in `AgentManager.Create` with no internal
subscriber, and slice 8 (the WebSocket bridge) is what is expected to attach
listeners later.

## Why this is a problem

The error-reporting paths are reachable on ordinary (non-test) flows, and the throw
defeats their intent:

1. **Non-fatal delivery errors become thrown rejections.**
   `SessionRuntime.AcceptUserMessage` catches a Pi delivery failure and calls
   `EmitError({ code: "user_message_delivery_failed", fatal: false })` specifically so
   the message is *reported* rather than thrown (the plan requires "the manager must
   report acceptance before Pi failure can drop it"). With no `"error"` listener, the
   `emit` itself throws, so `AcceptUserMessage` rejects and `submitUserMessage`
   rejects — the opposite of the intended non-fatal reporting.

2. **Process-level crash risk on the manifest-write path.**
   `HandlePiEvent` triggers `void this.HandleAssistantMessageCompleted()`
   (fire-and-forget). If the initial manifest write fails (disk/permission/etc.), its
   catch calls `EmitError({ code: "manifest_write_failed" })`. With no listener, the
   throw surfaces inside an unawaited promise → **unhandled promise rejection**, which
   can terminate the process. This is triggered by a normal event (assistant message
   completion), not just an exotic error path.

3. **Startup-failure path throws the wrong error.**
   `AgentManager.StartSessionRuntime`'s catch calls `EmitError({ fatal: true })` and
   *then* `throw new AgentManagerError("session_start_failed", …)`. If `EmitError`
   throws first, callers receive an `ERR_UNHANDLED_ERROR` instead of the intended
   typed `AgentManagerError`.

This is the classic `EventEmitter` `"error"` footgun. It is currently masked only
because no test exercises an `EmitError` path without first attaching a listener.

## Test coverage gap

No test drives any `EmitError` path with zero `"error"` subscribers (the existing
summarizer-failure test uses the deterministic fallback and emits no error). A
regression test that calls a manager/runtime error path on an emitter with no
`"error"` listener would have caught this.

## What must be true to close

- Emitting a lifecycle error when no consumer is subscribed must not throw or cause an
  unhandled rejection. Acceptable resolutions include: renaming the lifecycle error
  event off the reserved `"error"` name, registering a safe default no-op `"error"`
  listener in the `LifecycleEmitter` constructor, or otherwise guarding the emit so a
  missing listener is a no-op.
- The non-fatal delivery-error path (`AcceptUserMessage`) and the fire-and-forget
  manifest-write path (`HandleAssistantMessageCompleted`) must not reject/crash when
  no `"error"` listener is attached.
- A test covers emitting a lifecycle error with no subscriber and asserts no throw /
  no unhandled rejection.
- resolution_notes: none

## Issue PL-0002

- status: completed
- owner_role: polisher_reviewer
- created_at: 2026-06-08T22:16:35Z
- updated_at: 2026-06-08T22:21:44Z
- title: AgentStatusSnapshot.error always undefined: lastError declared/surfaced but never assigned
- details: ## Problem

`SessionRuntimeRecord.lastError` (src/agents/sessionRuntime.ts) is declared and is
surfaced to callers through `AgentStatusSnapshot.error` in
`AgentManager.BuildStatus` (`error: record.lastError`), but it is **never assigned**
anywhere in the slice. All failures are emitted via the lifecycle emitter
(`EmitError`) and the state is moved to `Failed`, but the record's `lastError` stays
`undefined`.

## Why this is a problem

`getStatus(key).error` is part of the status API and is intended to let a caller
inspect why a session is in a `Failed` (or otherwise degraded) state via a pull-based
status read, independent of having subscribed to the lifecycle event stream at the
moment the error occurred. As implemented, `error` is always `undefined`, so a caller
that reads status after a `session_start_failed` / `manifest_write_failed` /
`user_message_delivery_failed` cannot see any reason. The field is effectively dead
and the snapshot's error reporting is incomplete.

## What must be true to close

Either:
- Populate `record.lastError` on the relevant failure paths (at minimum the fatal
  `StartSessionRuntime` failure that transitions to `Failed`) so
  `getStatus().error` reflects the last error, with a test asserting it; or
- If pull-based error surfacing is intentionally out of scope for this slice, remove
  the dead `lastError` field and the `error` snapshot field (or document why it is
  intentionally always undefined) so the API does not advertise data it never
  provides.
- resolution_notes: none
