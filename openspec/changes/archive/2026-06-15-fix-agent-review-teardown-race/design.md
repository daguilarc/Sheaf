## Context

The Agent Review service (`projects/sheaf-chat/src/server/agentReview/service.ts`) reacts to three event sources, all dispatched fire-and-forget:

- `void this.HandleCellPressed(x, y)` (~586) — Dictator Launchpad cell presses → `ExecuteCommand` → `RefreshAndBroadcast` → `git` (via `agentReview/git.ts`).
- `void this.HandleMessage(socket, data)` (~618) — inbound browser WebSocket frames.
- `void this.m_dictatorRPC?.popContext(hunkId)` (~1032, `voidPopCommentContext`) — Dictator RPC `dictationContext.pop`.

The Dictator RPC client's `call()` rejects every pending promise when its socket closes (~382–386, "Dictator RPC closed") or when unavailable (~402). None of the fire-and-forget callers attach a `.catch`, and there is no lifecycle that stops accepting events or waits for outstanding work.

Confirmed failure mode (reproduced under 6× concurrent test load): a cell-press handler is still running `git` when the test returns; the harness then `rmSync`s the temp repo (`WithFakeRepoAsync` `finally`), and the in-flight git child fails (`fatal: unable to read <sha>`, `fatal: stat … No such file`, `Not a git repository`). The `void` dispatch turns that into an `unhandledRejection` after the test ended. `node:test` reports it as "asynchronous activity after the test ended" and counts a synthetic extra test — hence the flaky failure and the drifting total count. Serially it never reproduces (15/15 clean); only contention widens the window between "test returns" and "git finishes". This is a server lifecycle bug that also exists in production whenever a connection/workspace closes mid-operation.

## Goals / Non-Goals

**Goals:**
- A deterministic teardown: after `dispose()`/connection close resolves, the service has zero outstanding async work and spawns no further git/RPC activity.
- No `unhandledRejection` can originate from the service after teardown, achieved by draining/guarding at the source.
- A regression test that deterministically reproduces the race and asserts no post-teardown async activity and a stable `node:test` count.

**Non-Goals:**
- No change to Agent Review behavior, REST/WebSocket contracts, Launchpad colors, comment lifecycle, or review serialization.
- Not "fix the test only" — the production lifecycle leak is the target.
- No change to the Dictator-side RPC server (Swift); only the Sheaf Chat client/service.

## Decisions

- **Introduce a `closing` flag checked at every event entry point.** Once teardown begins, `HandleCellPressed`, `HandleMessage`, and Dictator RPC callbacks return immediately without starting new git/RPC work. This closes the window where a new press starts work during teardown.
- **Track in-flight work and await it in `dispose()`.** Maintain a set (or single serialized chain) of outstanding command/refresh promises; `dispose()` sets `closing`, then `await`s the tracked work before resolving. This is the core fix: teardown becomes a real drain, not a fire-and-forget abandonment. Chosen over "just cancel everything" because the command/refresh already in progress should finish or unwind cleanly rather than leave half-applied git state.
- **Make git invocation cancellable/abortable and kill children on dispose.** `agentReview/git.ts` accepts an `AbortSignal` (or the service kills tracked child processes); `dispose()` aborts so a long git read returns a benign cancellation rather than blocking the drain. The drain then awaits the settled (resolved or aborted) result.
- **Handle Dictator RPC `call()` rejections without swallowing.** The fire-and-forget RPC callsites (`voidPopCommentContext`, cell-event handlers) must route through the lifecycle: skip when `closing`, and where a fire-and-forget RPC is genuinely best-effort, await it within tracked work so its rejection is observed by the drain rather than escaping. A bare `.catch {}` is rejected as a fix — it hides real errors (e.g. a failed `cursor.insertText` mid-session) and was explicitly disallowed.
- **Test harness awaits the drain before repo removal.** `handle.close()` awaits the service `dispose()`; `WithFakeRepoAsync` only `rmSync`s after `close()` resolves. This removes the test-side rug-pull and makes the suite deterministic regardless of load.

## Risks / Trade-offs

- [Draining could hang teardown if a git child never settles] → invocation gets an abort/timeout so `dispose()` always resolves; the drain awaits the settled result, not an unbounded wait.
- [A `closing` guard could drop a legitimately in-progress user command] → guard only blocks *new* events after teardown begins; already-started commands are awaited to completion (or cleanly aborted). Teardown only happens on disconnect/dispose, where dropping new input is correct.
- [Reproducing the race deterministically] → the regression test starts a cell-press/command whose git step is in flight, then disposes and asserts no `unhandledRejection` (via `process` listener) and that the temp repo is removed only after drain; run with an artificial git delay/hook if needed to make the window deterministic rather than load-dependent.

## Migration Plan

1. Add the `closing` flag and in-flight tracking to the service; route the three fire-and-forget callsites through guards/tracking.
2. Make `agentReview/git.ts` abortable; have `dispose()` abort and await outstanding git.
3. Resolve Dictator RPC pending-promise rejections through the lifecycle (observed by the drain, not unhandled).
4. Wire connection/workspace teardown to `await dispose()`; make `handle.close()` await it and `WithFakeRepoAsync` remove the repo only afterward.
5. Add the deterministic teardown-race regression test; run the Agent Review suite under concurrency to confirm zero failures and a stable count.

Rollback is a straight revert; no data or contract changes.

## Open Questions

- Whether to serialize Agent Review commands into a single in-flight chain (simplest to drain) or track a set of concurrent promises — decide during implementation based on whether commands can legitimately overlap; serialization is preferred if it does not regress responsiveness.
