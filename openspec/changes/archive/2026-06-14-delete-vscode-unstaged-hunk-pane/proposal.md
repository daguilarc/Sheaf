## Why

The VS Code unstaged-hunk extension path has become more painful than useful: it adds a custom editor surface, a local controller protocol, and hardware state that duplicate the newer Sheaf Chat hunk review workflow. Removing it reduces the review stack to one supported hunk-review surface and prevents stale VS Code-specific requirements from shaping future work.

## What Changes

- **BREAKING** Remove the standalone `projects/vs-code-extension` unstaged-hunk pane capability and its spec contract.
- **BREAKING** Remove Dictator's VS Code-extension-specific hunk registry, command dispatch, diagnostics, and Launchpad hunk-control requirements.
- Update voice diff review requirements so review comments and reverted-hunk markers are no longer defined in terms of VS Code hunk-pane snapshots or VS Code command results.
- Keep the realtime-agent VS Code extension specs untouched; this change targets only the separate unstaged-hunk review extension and its Dictator bridge.

## Capabilities

### New Capabilities

- None.

### Modified Capabilities

- `vs-code-extension-unstaged-hunk-pane`: remove the capability from the live spec set.
- `dictator-vscode-hunk-controls`: remove the capability from the live spec set.
- `dictator-voice-diff-review`: remove VS Code hunk-pane/provider assumptions and keep review behavior provider-neutral.
- `dictator-launchpad`: remove any remaining requirements that reserve Launchpad coordinates for the VS Code hunk-control layer.

## Impact

- Deletes `projects/vs-code-extension` and its build/test surface.
- Removes Dictator `/api/vscode-hunk/*` models, endpoints, state stores, diagnostics, and Launchpad layer code that only serve the VS Code hunk extension.
- Simplifies voice diff review to consume the remaining focused hunk-review provider instead of preserving VS Code-specific mutation facts.
- Requires spec cleanup so `openspec/specs/` no longer contains the VS Code unstaged-hunk pane capability or Dictator VS Code hunk-control capability after archival.
