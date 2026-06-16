## 1. Zero-Context Hunk Discovery

- [x] 1.1 Change Agent Review Git diff loading to request zero unified context for hunk discovery.
- [x] 1.2 Ensure parsed hunk snapshots, hunk ids, patch hashes, file summaries, and inline file rows remain valid with zero-context hunk bodies.
- [x] 1.3 Add server tests proving two changed runs separated by one unchanged line become two ordered hunks, while adjacent changed lines remain one hunk.
- [x] 1.4 Add or update coverage proving binary and unsupported diffs remain excluded.

## 2. Zero-Context Hunk Mutation

- [x] 2.1 Update Agent Review stage, unstage, revert, and restore patch application to accept zero-context patches.
- [x] 2.2 Add regression tests proving stage and revert mutate only the selected smaller hunk when neighboring changes are separated by unchanged lines.
- [x] 2.3 Add undo coverage proving undo-stage and undo-revert still restore the selected zero-context hunk and preserve/remove review draft entries correctly.
- [x] 2.4 Confirm stale hunk id and patch hash validation still rejects mutation commands after the focused hunk changes.

## 3. Review UI Reveal Offset

- [x] 3.1 Update Agent Review hunk reveal logic so navigating to a hunk scrolls to an inline row up to three rows before the hunk's first row.
- [x] 3.2 Handle near-start hunks by using the earliest available inline row as the reveal target.
- [x] 3.3 Add UI tests for three-row leading context and near-start fallback behavior.
- [x] 3.4 Verify the offset behavior works for browser button navigation, Launchpad navigation, and state updates from the Agent Review WebSocket.

## 4. Validation

- [x] 4.1 Run the Sheaf Chat unit test suite for server and UI Agent Review coverage.
- [x] 4.2 Run targeted browser or integration coverage for Agent Review inline diff navigation if available in the local environment.
- [x] 4.3 Manually smoke-test an Agent Review session with separated nearby edits: navigate hunks, stage one hunk, revert another hunk, undo, add a comment, and confirm serialized review output references the smaller hunk snapshots.
