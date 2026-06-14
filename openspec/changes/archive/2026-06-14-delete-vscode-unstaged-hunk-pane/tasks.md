## 1. Remove VS Code Hunk Extension Surface

- [x] 1.1 Delete `projects/vs-code-extension` and remove its Makefile targets, package metadata, build scripts, tests, docs, and install hooks.
- [x] 1.2 Remove repository-level references to `projects/vs-code-extension`, `vs-code-extension-unstaged-hunk-pane`, and the standalone hunk-pane extension from build, documentation, and developer workflows.
- [x] 1.3 Confirm the realtime-agent VS Code extension under `projects/realtime-agent` remains untouched except for references that incorrectly mention the deleted hunk-pane extension.

## 2. Remove Dictator VS Code Hunk Protocol

- [x] 2.1 Remove Dictator models, stores, routes, diagnostics, and tests that exist only for `/api/vscode-hunk/state`, `/api/vscode-hunk/heartbeat`, `/api/vscode-hunk/disconnect`, `/api/vscode-hunk/command`, `/api/vscode-hunk/command-result`, and `/api/vscode-hunk/diagnostics`.
- [x] 2.2 Remove VS Code instance focus/heartbeat selection and command queues from the hunk review path.
- [x] 2.3 Preserve provider-neutral voice diff review behavior for spoken comments, reverted hunk markers, undo-revert cleanup, serialization, and cancellation.

## 3. Keep Sheaf Chat Review Working Without VS Code Naming

- [x] 3.1 Update Sheaf Chat Agent Review Mode so any Dictator bridge it still uses no longer calls `/api/vscode-hunk/*` endpoints or sends VS Code-named instance identities.
- [x] 3.2 Update Dictator and Sheaf Chat tests around the remaining hunk-provider bridge so they assert provider-neutral names and Sheaf Chat provider behavior.
- [x] 3.3 Verify Sheaf Chat hunk navigation, stage, revert, undo, and external refresh still work after the VS Code hunk extension is removed.

## 4. Launchpad Cleanup

- [x] 4.1 Remove the VS Code hunk-control static layout reservation requirement from implementation, fixtures, and tests.
- [x] 4.2 Update Launchpad hunk-control routing so it no longer references VS Code as a supported provider.
- [x] 4.3 Update operations docs and diagnostics output so deleted VS Code hunk-control endpoints and provider states are absent.

## 5. Spec Cleanup And Validation

- [x] 5.1 Delete `openspec/specs/vs-code-extension-unstaged-hunk-pane/spec.md` and `openspec/specs/dictator-vscode-hunk-controls/spec.md` during implementation/archive so those capabilities are not present in the live spec set.
- [x] 5.2 Scrub live specs for stale references to the deleted VS Code hunk pane, `projects/vs-code-extension`, `/api/vscode-hunk/*`, and VS Code hunk-control Launchpad reservations.
- [x] 5.3 Run `openspec status --change delete-vscode-unstaged-hunk-pane` and the relevant Dictator, Sheaf Chat, and repository build/test commands.
