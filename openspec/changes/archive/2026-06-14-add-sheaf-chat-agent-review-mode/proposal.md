## Why

Sheaf Chat already gives agents and reviewers a shared file-viewing surface, but it does not help the human review unstaged agent edits hunk-by-hunk. VS Code hunk review and Dictator voice review already prove the workflow; this change brings the same accept/reject navigation loop to Sheaf Chat when the session root is a Git repository.

## What Changes

- Add an Agent Review Mode entry point to the Sheaf Chat file viewer when the session root resolves inside a Git repository.
- Add a Sheaf Chat hunk-review backend that computes unstaged hunks, tracks the currently focused hunk, and supports stage/revert operations that mutate the underlying worktree/index.
- Add a browser-to-service review WebSocket so the UI receives hunk snapshots, mutation results, and external navigation commands without overloading the persisted chat WebSocket.
- Add a Sheaf Chat-to-Dictator bridge so Dictator and Launchpad can detect the focused hunk, jump between hunks, and stage or revert hunks in the Sheaf Chat session.
- Generalize Dictator's active hunk target from "VS Code hunk pane" to "focused hunk review target" so audio review remains owned by Dictator and works with Sheaf Chat hunk snapshots.
- Preserve the existing voice-review topology: Sheaf Chat never records, transcribes, refines, serializes, or posts audio review comments.

## Capabilities

### New Capabilities

- `sheaf-chat-agent-review-mode`: Sheaf Chat's Git-backed Agent Review Mode, including hunk discovery, review WebSocket, focused-hunk state, and stage/revert side effects.

### Modified Capabilities

- `sheaf-chat-file-browser`: Adds the Agent Review Mode affordance and hunk-focused file viewer behavior.
- `dictator-voice-diff-review`: Generalizes review comments from VS Code-only hunk snapshots to any focused hunk review target, including Sheaf Chat.
- `dictator-launchpad`: Routes hunk navigation and stage/revert commands to the focused Sheaf Chat hunk target when Agent Review Mode is active.

## Impact

- Affected projects: `projects/sheaf-chat` and `projects/dictator`.
- New Sheaf Chat service surface for Git hunk review, likely a dedicated non-persisted WebSocket plus narrow REST or WebSocket commands for hunk mutation.
- New local Git subprocess usage under the Sheaf Chat session root; operations must stay root-scoped and must only affect unstaged hunks selected by the review session.
- Dictator's hunk target model and Launchpad command dispatch need to support both VS Code and Sheaf Chat providers.
- Tests should cover Git repo detection, hunk snapshot protocol, stage/revert mutation semantics, focused-hunk reporting, and Dictator target routing.
