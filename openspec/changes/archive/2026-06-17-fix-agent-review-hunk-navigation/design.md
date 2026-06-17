## Context

Agent Review Mode is implemented inside `projects/sheaf-chat`. The service computes zero-context unstaged hunks in `src/server/agentReview/git.ts`, owns current hunk state and Dictator RPC cells in `src/server/agentReview/service.ts`, and renders the inline review view in `src/ui/sheaf-chat.js`.

The current implementation already has useful seams for this fix: fake Dictator RPC coverage exists in `tests/server/rest/agentReview.test.ts`, review clients talk over `/ws/agent-review`, and the browser UI code can be loaded in tests with mocked WebSocket/fetch behavior. The reported failures are not new protocol concepts; they are correctness and interaction gaps in hunk mutation, focus-gated cell painting, scroll anchoring, and post-mutation focus selection.

## Goals / Non-Goals

**Goals:**

- Make targeted hunk mutation trustworthy for non-linear review flows, especially non-first hunks in a file.
- Preserve the paste-ready review pad `(3,3)` while an active review is armed, even after the Sheaf Chat browser loses focus.
- Preserve the existing three-leading-row inline scroll context when navigation must move the viewport, and fix the implementation path that currently fails to select those preceding rows.
- Keep hunk navigation and mutation within the current file unless the user explicitly presses next-file or previous-file.
- Add a deterministic randomized regression test that exercises realistic mixed review behavior without requiring Dictator.

**Non-Goals:**

- Do not change Agent Review WebSocket frame shapes unless implementation proves an internal-only field is insufficient.
- Do not move review state into Dictator; Dictator remains a generic RPC surface.
- Do not add durable storage for active review drafts.
- Do not replace the full Agent Review UI or introduce a separate review page.

## Decisions

### Verify targeted mutation against recomputed Git state

The hunk command path should continue validating `hunkId` and `patchHash`, then apply the selected hunk patch through the existing Git helper. After a successful apply, the service should recompute state and verify the intended target disappeared from the appropriate unstaged/staged side while sibling hunks in the same file remain when expected. If verification fails, the command should roll back with the inverse operation when possible and return an error rather than reporting success.

Alternative considered: replacing `git apply` with manual index/worktree editing. That would increase the chance of drifting from Git semantics for mode changes, whitespace, and delete/add hunks. Keeping Git as the mutator but adding post-apply assertions is narrower and easier to test.

### Treat "armed review" as a review-cell exception to focus gating

Focus gating should still turn off navigation and mutation pads when no browser client is focused. The exception is the review cell `(3,3)` when `SerializedReview()` is non-null and no hunk is focused: it should stay green and accept a press so the serialized review can be inserted into whatever app currently has focus. This keeps the user's paste flow available while preventing accidental stage/revert/navigation commands from a background Sheaf Chat tab.

Alternative considered: disabling all press handling while unfocused and requiring refocus before paste. That preserves the older gating model but defeats the main use case: building a review in Sheaf Chat and pasting it elsewhere.

### Make post-mutation focus selection file-scoped

`Refresh()` currently tries to preserve the previous hunk, then falls back by file, then normalizes an index. The mutation path should mark the previous file as a boundary after stage/revert/undo. During the refresh caused by that mutation, if the prior file has remaining hunks, focus one of those; if it has none, clear focus and leave file advancement to the explicit file navigation commands.

Alternative considered: always keep the closest global hunk selected. That is convenient for linear review, but it surprises users who intentionally finish a file and expect the next-file button to be the only cross-file transition.

### Fix the three-row anchor helper

`ReviewHunkRevealTarget()` should keep the intended `index - 3` target. The root cause is that the helper checks `Array.isArray(parent.children)` before calling `Array.from`; in browsers, `parent.children` is an `HTMLCollection`, so `Array.isArray(parent.children)` is false and the helper returns the anchor itself. That makes the hunk's first changed row land at the top even though the code appears to request three rows of context.

The fix should convert children with `Array.from(parent.children)` whenever a parent exists, then apply the existing `Math.max(0, index - 3)` clamp. Tests should cover enough-context and near-file-start cases, plus the already-visible no-scroll branch.

Alternative considered: CSS `scroll-margin-top`. The inline review rows live in a custom scroll container and the implementation already computes exact scroll positions, so changing the helper is the lowest-risk path.

### Use a seeded randomized browser workflow test

Add a deterministic pseudo-random workflow test that uses a fixed seed and a fake WebSocket server/client pair. The test should drive the same public UI commands a user would: navigation buttons, comment text entry, stage/revert/undo buttons, blur/presence changes, and review-cell paste through fake Dictator RPC. After every step, assert the expected focused file/hunk, staged/unstaged model, visible comment draft, Launchpad cell update, and serialized review state.

The test should be randomized in operation order and data shape but deterministic in CI by logging the seed. It can run in the existing Node DOM-style UI test harness if that is sufficient; use Playwright only if layout/scroll assertions require real browser geometry.

## Risks / Trade-offs

- Targeted mutation verification may expose edge cases where Git applies successfully but state cannot be matched back to the original zero-context hunk -> mitigate by returning a clear command error and preserving the review draft rather than pretending success.
- Keeping `(3,3)` active while unfocused creates one intentional background action surface -> mitigate by allowing only serialized-review paste in that state; all navigation and mutation pads remain off and ignored.
- Randomized tests can become flaky if they depend on wall-clock timing or live services -> mitigate with fake WebSocket/RPC objects, seeded randomness, explicit frame waits, and no Dictator dependency.
- The no-auto-advance rule leaves the UI with no focused hunk after a file is complete -> mitigate by keeping next-file availability visible and making the explicit next-file command select the next file's first hunk.
