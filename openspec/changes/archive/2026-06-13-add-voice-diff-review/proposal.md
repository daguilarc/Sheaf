## Why

The hunk review pane already lets a human accept, revert, and navigate agent-authored changes from the Launchpad, but there is no lightweight way to accumulate spoken review comments against specific hunks and hand the resulting review back to the agent. This change adds a Dictator-owned in-memory diff review so voice comments and reverted-hunk markers can be collected during code review, then serialized into the agent chat at the cursor.

## What Changes

- Add a Dictator diff-review state consisting of ordered in-memory entries: either a hunk plus refined review comment, or a hunk plus a reverted marker.
- Add a Launchpad review pad at `(2,7)` with state-dependent colors:
  - red while recording a review comment
  - blue when the VS Code hunk review surface is focused on a hunk and a review can receive a comment
  - grey when focused on a hunk with no outstanding review yet
  - green when away from the hunk surface but an outstanding review can be posted
  - off otherwise
- Pressing the pad while focused on a hunk starts/stops the review-comment recording flow, using the existing transcription and refinement pipeline with a new configurable review prompt and reusable refiner context injection carrying the current hunk.
- Refined review text is appended to the active in-memory review as a comment on the current hunk, allocating a review if none exists.
- Reverting a hunk through the hunk controls appends a reverted-hunk entry to the active review; undoing that revert removes the matching review entry.
- Pressing the pad in away/green mode serializes the active review at the current cursor using clipboard paste, restores the prior clipboard contents, and clears the in-memory review; it does not synthesize Enter, submit the pasted text, or leave the review text in the user's clipboard.
- Include reverted hunks in the serialized output so the agent knows not to reintroduce rejected code; accepted hunks are omitted unless they have spoken comments.

## Capabilities

### New Capabilities
- `dictator-voice-diff-review`: Dictator-owned in-memory diff-review state, review-comment recording, hunk-context refinement through reusable context injection, review serialization, and cleanup semantics.

### Modified Capabilities
- `dictator-launchpad`: Adds the `(2,7)` review pad behavior and colors, plus contextual-backspace cancellation for review recordings.
- `dictator-vscode-hunk-controls`: Extends the VS Code hunk registry/protocol with current hunk patch context and mutation-result details needed to track reverted and undo-reverted hunks.
- `vs-code-extension-unstaged-hunk-pane`: Reports the focused/current hunk patch context and identifies successful revert/undo-revert operations for Dictator.
- `dictator-dictation-pipeline`: Adds a configurable review-refinement prompt slot and reusable structured context injection for hunk-aware review-comment refinement without using selected-text replacement semantics.

## Impact

- Affected code:
  - `projects/dictator/src/Sources/DictatorService/LaunchpadServiceController.swift`
  - `projects/dictator/src/Sources/DictatorService/VSCodeHunkControl.swift`
  - Dictator runtime config, prompt catalog, web config API/models, and tests
  - `projects/vs-code-extension/src/*` hunk model, Dictator client protocol, commands, and tests
  - `projects/dictator/src/prompts/system-prompts/`
- New or changed protocol fields on `/api/vscode-hunk/state`, `/api/vscode-hunk/command-result`, diagnostics, and extension polling responses.
- No persistent storage is required for reviews; restart or explicit post clears in-memory state.
- No breaking change is intended for existing hunk-control commands; unknown extra JSON fields remain backward-compatible where possible.
