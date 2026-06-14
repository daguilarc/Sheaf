## Context

Dictator currently exposes a specialized hunk-review integration: hunk providers report focused hunks and action availability, Dictator routes Launchpad commands, records spoken review comments, tracks reverted markers, serializes the review, and pastes it into the active target. Sheaf Chat Agent Review Mode was designed around that topology.

That contract is too specific. Sheaf Chat is the application that knows about chat sessions, hunk focus, review comments, serialized review text, and the UI where comments are edited. Dictator already owns the Launchpad hardware and macOS cursor insertion path. The clean boundary is a generic Dictator RPC surface that exposes those mechanical capabilities without knowing about reviews.

The revised review workflow also avoids direct audio integration. Pressing the review/comment cell opens and focuses a text box near the selected hunk; the user can dictate normally into that text box. Dictator can still improve ordinary dictation by accepting pushed context blocks while that text box is focused.

## Goals / Non-Goals

**Goals:**

- Introduce a generic local WebSocket RPC protocol in Dictator.
- Let external apps own Launchpad cells by setting colors and receiving press/release events.
- Let external apps request clipboard-preserving insertion of supplied text at the active cursor.
- Let external apps push/pop transient dictation context blocks.
- Move Agent Review Mode review ownership into Sheaf Chat.
- Remove the old `(2,7)` Dictator-owned review pad from the review workflow.
- Use a single Sheaf Chat-owned `(3,3)` cell for review-comment editing and serialized-review insertion.
- Preserve the useful review-button color language: off, grey, blue, green.
- Keep normal audio dictation independent from Agent Review Mode.

**Non-Goals:**

- Do not add a new audio recording mode for review comments.
- Do not make Dictator parse Git diffs, store review entries, or serialize reviews.
- Do not automatically submit the inserted review to the agent chat.
- Do not persist review drafts across service or browser restarts in the first version.
- Do not expose Dictator RPC to arbitrary remote network clients; this is a local control channel.

## Decisions

### Dictator RPC uses request/response envelopes plus events

Use a small JSON WebSocket protocol rather than REST endpoints or a hunk-specific polling API. Client-to-Dictator calls use `{id, method, params}` and receive `{id, result}` or `{id, error}`. Dictator-to-client notifications use `{method, params}` with no `id`.

This supports bidirectional Launchpad events and cursor insertion acknowledgements without inventing a new endpoint per interaction. It also leaves room for future apps that want Launchpad cells without review semantics.

Alternative considered: keep the existing hunk-review HTTP shape and add a paste endpoint. That keeps the current coupling and does not solve generic cell events or context push/pop.

### External apps own cells, not Launchpad modes

Dictator should maintain a registry of external cell owners. A client sets concrete cell colors for the coordinates it owns, receives press/release events for those cells, and loses ownership on disconnect or heartbeat timeout. Dictator consumes owned-cell hardware events and never falls through to static keystrokes for those coordinates.

This makes `(3,3)` a Sheaf Chat-owned review/comment cell, and Sheaf Chat also owns the existing hunk navigation and mutation cells through the same mechanism. Dictator does not infer what a color means.

Sheaf Chat owns the whole Agent Review control block — the same coordinates and colors the old Dictator-owned `HunkReviewLaunchpadControlLayer` rendered — so the on-pad layout is unchanged for the user; only ownership moves:

| Coordinate | Action | Color when available |
| --- | --- | --- |
| `(0,2)` | revert | red |
| `(1,2)` | previous hunk | yellow |
| `(2,2)` | stage | green |
| `(3,2)` | undo | white |
| `(0,3)` | previous file | yellow |
| `(1,3)` | next hunk | yellow |
| `(2,3)` | next file | yellow |
| `(3,3)` | review/comment/post | off, grey, blue, green |

Each navigation/mutation cell is lit with its color only when its action is currently available (from Agent Review state's `canGoUp`/`canGoDown`/`canGoPrevFile`/`canGoNextFile`/`canStage`/`canRevert`/`canUndo`) and is off otherwise, matching the prior behavior. On press, Sheaf Chat runs the matching Agent Review command; Dictator only forwards the generic cell event.

Alternative considered: add a generic command enum such as `reviewComment`, `stage`, `revert`. That would still bake app semantics into Dictator and recreate the boundary problem.

### Cursor insertion is a stateless RPC

Sheaf Chat calls `cursor.insertText` with the serialized review when the user presses the green review/post cell. Dictator inserts the supplied text using the same clipboard-preserving paste path used by Launchpad dictation and returns success/failure. Sheaf Chat clears its review only after a successful response.

`cursor.insertText` accepts up to 1 MiB of UTF-8 text. That is intentionally generous for serialized code-review payloads while still giving Dictator a concrete validation limit before it touches the pasteboard.

This replaces the paste-bin idea. A persistent paste bin would require lifecycle rules for ownership, stale content, and clearing. A single RPC call matches the actual interaction: the app already received the button press and knows the current text to insert.

Alternative considered: register paste text ahead of time at a Launchpad cell. That adds state in Dictator without buying meaningful reliability.

### Pushed context is independent from review ownership

Dictator maintains a transient per-client context stack. While a Sheaf Chat review comment text box is focused, Sheaf Chat pushes a block containing the focused hunk's file, hash, header, and patch. When focus leaves, Sheaf Chat pops it. Launchpad dictation context capture includes the currently active pushed blocks.

This recovers most of the lost hunk context without putting review audio or review state back into Dictator.

Alternative considered: pass context only in the review-comment UI. That helps display and serialization, but it does not help normal dictation into the text box.

### Sheaf Chat owns review state and comment UI

Sheaf Chat stores the active review draft in memory for the Agent Review session. Comment text is attached to hunk identity and patch hash. Reverted markers are also Sheaf Chat review entries. The current focused hunk is the only hunk whose comment text box is visible.

Reverted hunks are mandatory review output. If the user rejects a hunk by reverting it in Agent Review Mode, Sheaf Chat records that rejected-hunk marker and includes the hunk snapshot in the serialized review sent back to the agent.

The `(3,3)` cell is the only Launchpad review/comment/post cell. It is logically the old review button moved next to hunk controls, but it no longer records audio:

- off: no focused reviewable hunk and no review to post
- grey: focused reviewable hunk has no comment
- blue: focused reviewable hunk has a comment or visible draft
- green: no focused hunk, but a serialized review exists and can be inserted

Alternative considered: keep Dictator's red recording state and use the same cell to start recording. That contradicts the new plain-text-box flow and keeps audio coupled to review.

## Risks / Trade-offs

- [RPC scope can grow too broad] -> Keep first-version methods limited to Launchpad cells, cursor insertion, heartbeat, and context push/pop.
- [Owned cells can shadow static layout unexpectedly] -> Require ownership diagnostics and clear external cells on disconnect/timeout.
- [Cursor insertion can paste in the wrong app] -> Dictator inserts only when explicitly called, never submits Enter, and reports success/failure; Sheaf Chat remains responsible for when to call it.
- [Context stack can leak stale hunk context] -> Scope context ids to the client connection and clear all client contexts on disconnect; Sheaf Chat pops on blur/hide.
- [Multiple Sheaf Chat tabs can race for cells] -> Dictator rejects ownership requests for cells owned by another live client and returns a structured conflict error.
- [Hunk patch changes can stale comments] -> Sheaf Chat stores patch hash with each comment and marks stale entries in serialization or UI when the hunk hash no longer matches.

## Migration Plan

1. Add Dictator WebSocket RPC infrastructure and envelope tests.
2. Add external Launchpad cell ownership, rendering, event dispatch, disconnect cleanup, and diagnostics.
3. Add `cursor.insertText` over the RPC protocol using the existing clipboard-preserving insertion path.
4. Add RPC context push/pop and include active pushed blocks in Launchpad dictation context capture.
5. Remove Dictator-owned voice diff review state, review pad handling, hunk-provider command queues, and specialized review diagnostics.
6. Update Sheaf Chat Agent Review Mode to connect to Dictator RPC, own hunk review state, drive Launchpad colors, handle cell events, and call insertion.
7. Add the comment text-box lifecycle and hunk context push/pop in the Sheaf Chat UI.
8. Run Dictator Swift tests, Sheaf Chat tests, and a manual Launchpad/Sheaf Chat review smoke test.

Rollback is to disable the Sheaf Chat RPC client and leave Agent Review Mode usable from the browser UI only. Dictator's generic RPC can remain inert if no client owns cells.
