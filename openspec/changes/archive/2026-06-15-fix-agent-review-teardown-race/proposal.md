## Why

The Sheaf Chat Agent Review service dispatches Dictator Launchpad cell-press events, inbound WebSocket messages, and Dictator RPC context calls as fire-and-forget async work (`void this.HandleCellPressed(...)`, `void this.HandleMessage(...)`, `void this.m_dictatorRPC?.popContext(...)`). `HandleCellPressed → ExecuteCommand → RefreshAndBroadcast` shells out to `git`. When a connection or workspace is torn down, that in-flight async work is not awaited or cancelled, so it can run after the service has been disposed — against a repository that is being removed — and fail with errors like `fatal: unable to read <sha>`, `fatal: stat … No such file`, or `Not a git repository`. Because the work was dispatched with `void` and no `.catch`, the failure escapes as an `unhandledRejection` after the lifecycle ended.

This is a real lifecycle leak in the server, and it surfaces in tests as a load-sensitive flake: the Agent Review REST/WebSocket suite intermittently fails, and the `node:test` total count drifts run-to-run because each post-teardown `unhandledRejection` is reported as a synthetic extra test. The root cause was confirmed by reproducing the teardown race deterministically under concurrent load and capturing the git errors as "asynchronous activity after the test ended".

## What Changes

- Give the Agent Review service a real teardown lifecycle: a `dispose()`/`close()` that
  - sets a "closing" flag so new cell-press, inbound-message, and Dictator RPC callback events are ignored once teardown begins,
  - tracks the in-flight command/refresh promise(s) and `await`s them before returning,
  - terminates any spawned `git` child processes so no git work outlives the service.
- Ensure no fire-and-forget path (`HandleCellPressed`, `HandleMessage`, `voidPopCommentContext`, and Dictator RPC `call()` rejections on socket close) can produce an `unhandledRejection` after teardown — by draining/guarding at the source, **not** by adding a bare `.catch {}` that silently swallows errors.
- Make the test harness await the service drain: `handle.close()` (and the Agent Review WebSocket close path) completes all outstanding async before `WithFakeRepoAsync` removes the temporary repository.
- Add regression coverage that reproduces the teardown race deterministically (e.g. cell presses in flight during dispose) and asserts no `unhandledRejection` and a stable test count.

No user-facing behavior changes: Agent Review commands, Launchpad colors, comment lifecycle, and review insertion remain as specified; this only makes teardown deterministic and leak-free.

## Capabilities

### New Capabilities

<!-- none -->

### Modified Capabilities

- `sheaf-chat-agent-review-mode`: Add a teardown/lifecycle requirement (arm-22) stating that disposing the service or closing a connection drains or cancels in-flight Launchpad/command/RPC/git work and never produces async activity after teardown.

## Impact

- Code: `projects/sheaf-chat/src/server/agentReview/service.ts` (dispose/close lifecycle, closing-flag guards, in-flight tracking, fire-and-forget callsites), `projects/sheaf-chat/src/server/agentReview/git.ts` (cancellable/abortable git invocation), and the Dictator RPC client section of `service.ts` (pending-promise rejection handling on close).
- Server wiring: wherever the Agent Review service is created/closed per WebSocket connection or workspace, so dispose is awaited on disconnect.
- Tests: `projects/sheaf-chat/tests/server/rest/agentReview.test.ts` and its harness (`tests/server/rest/helpers.ts`, `WithFakeRepoAsync`) to await drain before temp-repo removal, plus a new deterministic teardown-race regression test.
