## Context

Sheaf Chat already resolves each session to a root directory and renders a file workspace for that root. The file browser is intentionally read-only today, while scoped tools mutate files only through agent tool calls.

Dictator already has a hunk-control and voice diff review workflow for the VS Code extension. In that topology the extension owns hunk discovery, current-hunk focus, and hunk mutations; Dictator owns Launchpad rendering, command dispatch, audio capture, review state, and final review serialization.

Agent Review Mode should reuse that topology with Sheaf Chat replacing the VS Code extension as a hunk target. Sheaf Chat should not gain audio responsibilities. Its responsibility is to expose Git-backed hunk snapshots, track focused hunk state, and perform explicit hunk mutations against the session root.

## Goals / Non-Goals

**Goals:**

- Offer Agent Review Mode when the Sheaf Chat session root is inside a Git repository.
- Let the file viewer browse unstaged hunks, focus a current hunk, and mark accepted hunks by staging them.
- Let Launchpad navigate, stage, and revert Sheaf Chat hunks through Dictator.
- Let Dictator's existing audio review attach spoken comments and reverted markers to Sheaf Chat hunk snapshots.
- Keep all review state and hunk streams transient; do not persist them to chat history.

**Non-Goals:**

- Do not add audio recording, transcription, review refinement, or review posting to Sheaf Chat.
- Do not replace the VS Code hunk pane or remove its Dictator integration.
- Do not review committed diffs, untracked files, or staged-only changes in the first version.
- Do not expose a broad Git API from Sheaf Chat.
- Do not automatically submit the final review to the agent chat.

## Decisions

### Sheaf Chat owns Git-backed hunk state for its session root

Sheaf Chat should compute unstaged hunks from the session root's Git repository and expose a narrow review model: ordered files, ordered hunks, the current hunk, action availability, and command results. The service should use exact hunk patches for stage/revert operations and then recompute state from Git.

Alternative considered: have Dictator read the repository directly. That would duplicate Sheaf Chat's session-root resolution and weaken the boundary around which chat root is being reviewed.

### Use a dedicated Agent Review WebSocket

Agent Review Mode should use a dedicated transient WebSocket rather than `/ws/chat`. The chat socket is an envelope protocol with persisted history and session replay rules. Review hunk state is live operational state with side effects and does not belong in chat history.

Alternative considered: extend `/ws/chat` with review frames. That would require threading non-persisted command semantics through the chat protocol and makes bootstrap/replay behavior harder to reason about.

### Sheaf Chat talks to Dictator as a hunk target provider

When Agent Review Mode is active, Sheaf Chat should maintain a local connection to Dictator that advertises a provider id, session identity, focus state, current hunk snapshot, action availability, and command handling. Dictator should route Launchpad hunk-control actions to the focused healthy provider, whether that provider is VS Code or Sheaf Chat.

Alternative considered: make the browser connect directly to Dictator. That would put Dictator addressing and control credentials into the browser and make it harder for Sheaf Chat to guard the Git side effects.

### Hunk snapshots are provider-neutral

Dictator voice review should consume a provider-neutral hunk snapshot containing source provider, repo root, root-relative file path, hunk id, hunk header, patch hash, and patch text. VS Code can continue sending the same data with provider `vscode`; Sheaf Chat sends provider `sheaf-chat`.

Alternative considered: add a Sheaf Chat-specific review path in Dictator. That would fork voice review logic and make future hunk providers repeat the same integration work.

### Staging is acceptance; reverting is rejection

In Agent Review Mode, staging the current hunk is the "check off" action. Successful stage results remove that hunk from the unstaged review stream and create no voice-review entry by themselves. Successful revert results also remove the hunk from the worktree, and Dictator records a reverted-hunk marker when it receives the command result.

Alternative considered: track accepted hunks in Dictator. That would add noise to the final agent review, and the Git index already represents accepted hunks.

### Git operations are narrow and recomputed

After every stage, revert, undo, or external file-change signal, Sheaf Chat should recompute hunks from Git instead of patching its in-memory model. Hunk ids and patch hashes are used to detect stale commands and to describe the focused hunk to Dictator; Git remains the source of truth.

Alternative considered: maintain a long-lived incremental hunk graph. That would be more responsive, but it is fragile around external edits and index changes.

## Risks / Trade-offs

- [Partial hunk staging can fail when the worktree changes] -> Require patch-hash validation before applying a command, return a stale-state command result, and recompute hunks.
- [Running Git from a web service has side effects] -> Restrict commands to the resolved session root's repository, avoid shell interpolation, use argument arrays, and expose only hunk-specific stage/revert/undo commands.
- [The index is shared with other tools] -> Treat the index as authoritative after each command and surface recomputed state immediately.
- [Large diffs may make the UI or Dictator payloads heavy] -> Cap individual hunk payloads for display and diagnostics while preserving exact patches for command execution where feasible.
- [Multiple Sheaf Chat tabs can review the same root] -> Let the service own one live review model per session/root and broadcast recomputed snapshots to all review sockets.
- [Focus can move while audio is recording] -> Dictator snapshots the hunk at recording start, as it already does for VS Code.

## Migration Plan

1. Add Sheaf Chat Git hunk discovery and a transient Agent Review WebSocket.
2. Add the Agent Review Mode UI affordance and hunk-focused file viewer state.
3. Add Sheaf Chat's Dictator hunk-provider client and command handling.
4. Generalize Dictator voice review hunk snapshots and Launchpad target routing.
5. Add tests for Git repo detection, hunk snapshots, stage/revert/undo behavior, WebSocket frames, and provider routing.
6. Manually smoke-test with a Sheaf Chat session rooted in a Git repo and Dictator/Launchpad connected.

Rollback is to hide the Agent Review Mode entry point and disable the Sheaf Chat hunk-provider connection. Existing chat, file browsing, VS Code hunk controls, and Dictator voice review remain usable.

## Open Questions

- Should the first version include staged-but-not-committed hunks as a separate review lane, or strictly unstaged hunks only?
- Should Sheaf Chat expose undo for both stage and revert, or only revert to support Dictator's rejected-hunk cleanup path?
- What Dictator endpoint/config should Sheaf Chat use for local provider registration when Dictator is not managed by Conductor?
