## 1. Reproduce and pin the race

- [x] 1.1 Add a deterministic regression test in `projects/sheaf-chat/tests/server/rest/agentReview.test.ts` that starts cell-press/command git work and tears down mid-flight, with a `process` `unhandledRejection` guard. (Test: "Agent Review teardown waits for in-flight git work before completing".)
- [x] 1.2 Make the window deterministic via an injectable git hook (`SetAgentReviewGitHookForTests` in `git.ts`) that holds the press's git in flight; the test asserts teardown does not resolve until the gate releases. Verified it fails before the fix ("teardown resolved before in-flight git settled") and passes after.

## 2. Service lifecycle: closing flag and in-flight tracking

- [x] 2.1 Added `m_closing` to `AgentReviewSession` and an async `Dispose()` that sets it first, closes sockets, drains in-flight work, then disconnects the RPC.
- [x] 2.2 Guarded the entry points so they no-op once closing: `HandleCellPressed`, `HandleMessage`, `RefreshAndBroadcast` (also skips when no clients), and the RPC cell/status callbacks (via `RunBackground`, which refuses new work when closing).
- [x] 2.3 Track in-flight work in `m_backgroundWork` (promise-set) plus the existing `m_refreshInFlight`; `DrainInFlight()` awaits all before disconnect. Chose the promise-set over a serialized chain — commands can legitimately interleave and the set drains them all without changing responsiveness.

## 3. Cancellable git and RPC drain

- [x] 3.1 Resolved by decision: git is **not** made AbortSignal-cancellable. The drain awaits in-flight git, and `RunGit` operations are bounded local reads, so awaiting guarantees completion-before-teardown without an unbounded wait. (Cancellation was the design's "await OR cancel" alternative; await was chosen.) A test-only hook seam was added to `RunGit` for deterministic testing.
- [x] 3.2 `Dispose()` awaits outstanding git via `DrainInFlight()`; because `m_closing` suppresses new work, the drain loop terminates and cannot hang on self-spawned work.
- [x] 3.3 Removed `voidPopCommentContext`; `PopActiveContext` is now local-only (Dictator releases pushed context on disconnect). The remaining fire-and-forget callsites route through `RunBackground`, which observes errors via `ReportBackgroundError` (logged, not swallowed). No bare `.catch {}`.

## 4. Wire teardown into connection/workspace close

- [x] 4.1 `AgentReviewService.Dispose()`/`ReleaseIdle()` are now async and await every session's drain; `server.ts` `close()` awaits `agentReviewService.Dispose()` before closing the WebSocket and HTTP servers.
- [x] 4.2 No harness change needed: `TestServerHandle.close()` already awaits `server.close()` (now the drain), and `WithFakeRepoAsync`/`WithTestServer` remove the temp repo only after the callback returns, i.e. after close resolves. The deterministic test composes `StartTestServer` + `WithFakeRepoAsync` directly to assert this ordering.

## 5. Validation

- [x] 5.1 The regression test fails before the fix and passes after (verified by reverting `service.ts`/`server.ts` to HEAD and re-running).
- [x] 5.2 Agent Review file under 6× concurrency, 3 rounds: 0 failing logs and 0 "asynchronous activity after the test ended" (previously failed every round).
- [x] 5.3 Full Sheaf Chat suite x5: stable total (188) and 0 failures each run — no count drift.
- [x] 5.4 `openspec validate fix-agent-review-teardown-race` reports valid.
