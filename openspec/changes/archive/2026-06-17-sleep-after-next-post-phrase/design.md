## Context

Dictator controls the installed Talon runtime through a Sheaf-owned Talon bridge at `projects/dictator/src/talon/sheaf_control/sheaf_control.py`. The bridge currently exposes local-only `status`, `wake`, and `sleep` operations; `sleep` immediately calls `actions.speech.disable()`.

That immediate disable can discard an utterance that Talon has received but has not finalized yet. Talon does not expose a public, engine-independent "flush current audio buffer" API, but Talon user scripts can register a `post:phrase` callback. The desired behavior is therefore to make sleep wait for Talon's next phrase-finalization callback, with a bounded timeout for the no-callback case.

## Goals / Non-Goals

**Goals:**

- Preserve the existing Launchpad Talon control gesture while making sleep less lossy immediately after speech.
- Change only the Talon sleep semantics: sleep after next `post:phrase`, or after a timeout fallback if no callback arrives.
- Keep the bridge local-only and limited to status/wake/sleep style control.
- Return a final status to Dictator after the bridge has actually disabled speech.

**Non-Goals:**

- Do not buffer, replay, delay, cancel, or reinterpret Talon phrases.
- Do not introduce a new Launchpad mode or change Launchpad pad mappings/colors beyond existing status results.
- Do not expose arbitrary Talon code execution or generic Talon action RPC.
- Do not depend on engine-specific APIs such as macOS Speech Framework task finishing.

## Decisions

### Keep the existing `/sleep` endpoint and defer inside the bridge

`POST /sleep` remains the only sleep operation. When speech is enabled, the bridge creates or joins a single pending deferred-sleep operation. That operation disables speech when either:

- the next `speech_system.register("post:phrase", ...)` callback fires, or
- a timeout fallback expires.

The HTTP handler waits for the operation to complete, then returns the normal status body. This keeps Dictator's public operation model unchanged and lets the Launchpad status update reflect the final asleep state.

Alternative considered: add a separate `/sleep-after-phrase` endpoint. This was rejected because the Launchpad Talon control has one user-facing sleep behavior and the requested behavior should replace, not sit beside, immediate sleep.

### Use a bounded fallback instead of pending-audio detection

The bridge should not try to infer whether Talon has unfinalized audio. There is no reliable public flag for that. A short fixed fallback keeps sleep deterministic when no phrase finalizes, while still giving Talon a chance to emit `post:phrase` after the Launchpad button press.

Alternative considered: preserve immediate sleep when no phrase is pending. This was rejected because implementing it would require unsupported audio-buffer or engine internals.

### Coalesce duplicate sleep requests

If multiple `/sleep` requests arrive while a deferred sleep is pending, they should wait on the same pending operation rather than registering extra callbacks or timers. Wake should continue to call `actions.speech.enable()` and should clear any pending sleep state before reporting status.

Alternative considered: let each request create its own timer. This was rejected because it increases race risk and makes status/logging harder to reason about.

### Extend Dictator's Talon client timeout

`TalonControlClient` currently has a short bridge timeout suitable for immediate status/wake/sleep responses. Since `/sleep` may now wait until `post:phrase` or fallback, the client timeout should exceed the bridge fallback with margin. The response shape can stay compatible if the bridge returns only after speech is disabled.

Alternative considered: return a "pending_sleep" status immediately and poll later. This was rejected because it would expand status semantics and require Launchpad polling for a small timing change.

## Risks / Trade-offs

- Bounded sleep delay when no phrase is pending -> keep the fallback short and document it as part of the bridge behavior.
- A phrase that is still growing after the button press may finalize before sleep -> this is consistent with "sleep after next post phrase" and avoids cancellation/replay behavior.
- Talon callback ordering may differ across engines -> rely only on `post:phrase`, which is already used by community Talon scripts; cover no-callback behavior with the fallback.
- HTTP handler waits during deferred sleep -> use a daemon-threaded server and a timeout shorter than Dictator's client timeout.

## Migration Plan

Deploy by updating the repo-owned Talon bridge and reinstalling/reloading the symlinked Talon script through the existing install flow. Rollback is the current immediate `actions.speech.disable()` behavior in `/sleep`.

No persisted data migration is needed.

## Open Questions

- The exact fallback duration should be chosen during implementation. It should be short enough to feel like a sleep command and long enough to allow Talon's default phrase timeout plus a small scheduling margin.
