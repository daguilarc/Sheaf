## Context

The current VS Code hunk pane is already authoritative for worktree-vs-index hunks, current hunk selection, and stage/revert/undo commands. Dictator mirrors that state onto Launchpad hunk controls through `/api/vscode-hunk/*`, but it only dispatches mutation/navigation commands; it does not keep review state.

The desired workflow is a human-in-the-loop review pass over agent-authored code: accept good hunks, revert bad hunks, speak comments against hunks that need follow-up, then return to the agent chat and post one compact review. The review is intentionally transient. It is useful while reviewing the current diff, but does not need durable storage across service restarts.

## Goals / Non-Goals

**Goals:**

- Maintain one active Dictator-owned in-memory diff review with ordered entries.
- Record spoken comments against the currently focused hunk using the existing audio capture, STT, and LLM refinement flow.
- Provide the refiner with current-hunk patch context through a reusable context injection mechanism and a dedicated code-review prompt selected from runtime config.
- Track rejected hunks by adding entries when a hunk is reverted and removing them when the revert is undone.
- Use Launchpad `(2,7)` as a stateful review/post pad with red, blue, grey, green, and off states.
- Serialize the review into the current cursor target and clear the in-memory review.

**Non-Goals:**

- Persist reviews to disk or reload them after Dictator restarts.
- Track accepted/staged hunks unless the user records an explicit comment for them.
- Make Dictator compute Git diffs independently of the VS Code extension.
- Add GitHub PR review submission or inline comment APIs.
- Replace the existing standard, auxiliary, or Talon Lite dictation pads.

## Decisions

### Dictator owns the active review

Dictator gets a small `DiffReviewStore` or equivalent service object containing at most one active review. Entries are append-only during a review except for undo-revert removal. Each entry stores a hunk snapshot with repo root, file, hunk id, header, patch hash, and patch text plus either a comment or `reverted` marker.

Alternative considered: keep review state in the VS Code extension. That would be close to the hunk model, but posting the review happens after focus leaves VS Code, and Launchpad color/rendering already belongs to Dictator. Keeping review state in Dictator avoids an extension dependency during the final post.

### Extension remains authoritative for hunk context

The extension sends the current hunk's patch context in pane snapshots and command results. Dictator consumes this context for review comments and revert markers, but does not re-parse the repository or ask Git for hunk state.

Alternative considered: add a Dictator-side Git adapter. That would duplicate the extension's repository detection and risks disagreement with the pane's current hunk.

### Reusable refiner context blocks

Add a small structured context abstraction for refinement input, such as `RefinementContextBlock` with a `title`, optional metadata, and body text. The normal dictation pipeline can continue to build its existing app/site context, while special modes can pass extra blocks. Voice diff review contributes a `Current hunk` block containing file path, header, patch hash, and patch text.

The prompt builder renders context blocks in a stable delimited form before the raw transcript. This gives future modes a single path for injecting editor state, logs, selected diagnostics, or other task-specific context without adding one-off prompt string handling. Review refinement still explicitly disables selected-text replacement semantics.

Alternative considered: add hunk-specific string interpolation in the review flow. That would be quicker, but it would make the next context-bearing mode duplicate prompt assembly rules.

### Review recording reuses the Launchpad pipeline with a prompt override

The review pad starts a mode-specific recording that uses the same audio recorder and STT path as standard Launchpad dictation, then refines with `review_system_prompt` from runtime config. The refinement input includes the raw transcript plus a reusable context block for the hunk; it must not use selected-text replacement mode.

Alternative considered: add a new public HTTP endpoint for review refinement. The current launchpad flow already runs in-process and supports prompt overrides, so a public endpoint would expand API surface without a current caller.

### Pad state is derived from recording, hunk focus, and review presence

The `(2,7)` pad color is computed from the highest-priority state:

1. Red while a review recording or review refinement is active.
2. Blue when a focused healthy VS Code target has a current hunk and an active review exists.
3. Grey when a focused healthy VS Code target has a current hunk and no active review exists.
4. Green when there is an active review and no focused current hunk.
5. Off otherwise.

This makes comment capture available while looking at a hunk, and posting available only after leaving the hunk surface.

### Reverted hunks are review entries, staged hunks are not

Successful `revert` command results append a `reverted` entry. Successful undo results that restore a reverted hunk remove the matching `reverted` entry. Staging or leaving a hunk alone produces no entry by itself.

Alternative considered: record accepted hunks as explicit entries. The user explicitly does not need accepted hunks in the review, and including them would add noise to the agent instruction.

### Serialization is destructive

Posting serializes the current review, snapshots the existing clipboard, inserts the review at the current cursor through the existing clipboard insertion path, restores the prior clipboard contents, and clears the in-memory review only after insertion and clipboard restoration both succeed. It must not synthesize Enter or otherwise submit the pasted text; the user remains in control of when to send the agent chat message. A failed insert or clipboard-restore failure leaves the review active so the user can try again.

Alternative considered: clear before insertion to avoid duplicate posts. That risks losing the review if accessibility, clipboard insertion, or clipboard restoration fails.

## Risks / Trade-offs

- [Hunk patch text can be large] -> Keep entries in memory only, cap serialized output if needed, and prefer exact patch text for reverted hunks because it tells the agent what not to re-add.
- [The user can navigate away during recording] -> Snapshot the hunk at recording start; the final comment is attached to that snapshot, not whatever hunk is focused later.
- [A revert command can fail or be superseded by recompute] -> Only command-result success with revert facts appends a `reverted` entry.
- [Undo may not identify the restored hunk] -> Include undo-entry hunk identity in the extension command result; if identity is unavailable, leave review state unchanged and expose diagnostics.
- [Posting in the wrong app can paste text somewhere unintended] -> The pad only turns green when a review exists away from the hunk surface, does not synthesize Enter, and intentionally trusts the user's manual navigation to the intended target.
- [Posting uses the clipboard as a transport] -> Snapshot the existing clipboard before paste and restore it after paste; do not clear the review unless the clipboard has been restored.

## Migration Plan

1. Extend Dictator runtime config and prompt catalog with `review_system_prompt`, defaulting to `code_review_refiner_v1.md`.
2. Extend the VS Code hunk protocol to include current hunk patch context and mutation-result facts.
3. Add Dictator in-memory review state and serialization helpers with unit coverage.
4. Add the Launchpad `(2,7)` control layer behavior and contextual-backspace cancellation.
5. Add extension command-result details for revert and undo-revert.
6. Add tests across Swift Dictator and TypeScript extension code, then perform a manual Launchpad/VS Code smoke test.

Rollback is to remove or ignore the review pad and protocol fields; existing hunk controls continue to work because stage/revert/navigation command names remain unchanged.
