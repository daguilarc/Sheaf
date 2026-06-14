## 1. Sheaf Chat Review Backend

- [x] 1.1 Add session-root Git repository detection and Agent Review availability responses.
- [x] 1.2 Implement unstaged text hunk discovery with provider-neutral hunk snapshots, patch hashes, file summaries, and action availability.
- [x] 1.3 Add the `/ws/agent-review` upgrade path, validation, bootstrap frame, live state frames, command-result frames, and non-persistence guarantees.
- [x] 1.4 Implement current-hunk focus, navigation commands, review socket fan-out, and focus clearing on mode exit or last socket close.
- [x] 1.5 Implement hunk stage, revert, and undo commands with patch-hash validation, root-scoped Git invocation, recompute-after-command behavior, and mutation facts.
- [x] 1.6 Refresh Agent Review state after scoped edit/file-change notifications under the reviewed session root.

## 2. Sheaf Chat UI

- [x] 2.1 Add Agent Review Mode availability loading to the chat/file workspace.
- [x] 2.2 Add the Agent Review Mode entry/exit control when review mode is available and hide mutation controls when unavailable.
- [x] 2.3 Render hunk-focused file viewer state, including current-hunk reveal, visual hunk focus, and stale/error states.
- [x] 2.4 Wire UI navigation, stage, revert, and undo controls to Agent Review WebSocket commands.
- [x] 2.5 Keep touch and non-touch layouts usable without breaking existing explorer, tabs, file links, and chat panels.

## 3. Dictator Bridge

- [x] 3.1 Add Sheaf Chat's local Dictator hunk-provider client with connection status, focused-hunk snapshots, action availability, and command-result forwarding.
- [x] 3.2 Generalize Dictator hunk target selection so Launchpad can route to healthy focused VS Code or Sheaf Chat providers.
- [x] 3.3 Generalize Dictator voice diff review hunk snapshots, diagnostics, and serialization to include source provider.
- [x] 3.4 Route Launchpad hunk-control commands to the selected provider and preserve no-keyboard-fallback behavior when commands are unavailable.
- [x] 3.5 Ensure successful Sheaf Chat revert and undo-revert results update Dictator voice-review rejected-hunk markers, while successful stage results do not.

## 4. Tests And Verification

- [x] 4.1 Add Sheaf Chat unit tests for Git repository detection, path/root scoping, hunk parsing, and patch-hash stale-command handling.
- [x] 4.2 Add Sheaf Chat integration tests for `/ws/agent-review` bootstrap, navigation, stage, revert, undo, and live recompute broadcasts.
- [x] 4.3 Add UI tests for Agent Review Mode entry, focused-hunk rendering, and hunk command controls on desktop and touch layouts.
- [x] 4.4 Add Dictator tests for provider-neutral target selection, Launchpad command routing, review pad colors/actions, and voice-review provider diagnostics.
- [x] 4.5 Run the Sheaf Chat and Dictator test suites, then perform a manual smoke test with Dictator connected to a Sheaf Chat session rooted in a Git repo.
