## Context

The repository currently has two hunk-review directions: a standalone VS Code extension under `projects/vs-code-extension` that reports unstaged hunk state to Dictator, and Sheaf Chat Agent Review Mode, which computes hunk state directly for chat sessions and bridges focused hunk state to Dictator. The VS Code extension path carries its own project, protocol, state registry, diagnostics, Launchpad layer, undo semantics, and spec files.

The desired end state is simpler: Sheaf Chat remains the supported hunk review surface, while Dictator's voice review and Launchpad review controls stay provider-neutral around the remaining focused hunk target. No live spec should continue to require or describe the separate VS Code unstaged-hunk pane.

## Goals / Non-Goals

**Goals:**

- Remove the standalone VS Code unstaged-hunk extension project and all code that exists only to serve it.
- Remove Dictator's `/api/vscode-hunk/*` protocol surface, connected-instance registry, VS Code hunk-control diagnostics, and VS Code-only command dispatch.
- Remove the `vs-code-extension-unstaged-hunk-pane` and `dictator-vscode-hunk-controls` capabilities from the live OpenSpec set.
- Scrub live Dictator specs so voice diff review and Launchpad hunk controls no longer mention VS Code as a hunk-review provider.
- Keep Sheaf Chat Agent Review Mode and the realtime-agent VS Code extension intact.

**Non-Goals:**

- Replacing Agent Review Mode's Git hunk implementation.
- Removing the realtime-agent VS Code extension under `projects/realtime-agent`.
- Removing generic Launchpad dictation, keystroke, or voice diff review features.
- Preserving backward compatibility for the deleted VS Code hunk extension or its protocol endpoints.

## Decisions

1. Delete the standalone extension rather than hiding it behind configuration.

   The extension is a separate review surface with separate build and protocol machinery. Keeping it disabled would leave its contracts, tests, and maintenance burden in the repo. The implementation should delete `projects/vs-code-extension` and remove package/workflow references instead of making runtime flags.

   Alternative considered: leave the project but remove activation. That still leaves stale specs and code paths that future work has to reason about.

2. Remove the VS Code-specific Dictator capability instead of converting it into the provider-neutral bridge.

   Provider-neutral hunk review now belongs in the remaining Sheaf Chat/Dictator bridge. The `dictator-vscode-hunk-controls` capability is named and shaped around VS Code windows, heartbeats, pane state, and `/api/vscode-hunk/*`; preserving it would keep the unwanted provider in the spec surface.

   Alternative considered: rename the capability to generic hunk controls. That is a larger design change and risks mixing deletion with new architecture. This proposal only removes the obsolete provider and cleans up existing provider-neutral references.

3. Return hunk-control Launchpad coordinates to normal layout ownership unless another active provider explicitly owns them.

   The current Launchpad spec reserves `(0,2)` through `(3,3)` for a VS Code hunk-control layer and says they must not send F13-F20. With the VS Code layer gone, the layout decoder should not reserve those coordinates for that deleted layer. Any remaining Sheaf Chat hunk controls must be described as provider-neutral behavior, not as a VS Code static layout reservation.

   Alternative considered: keep the reservation for possible future hunk controls. The user asked to obliterate the VS Code hunk-pane pain, and a VS Code-named reservation would violate that cleanup.

## Risks / Trade-offs

- [Hidden dependency on `/api/vscode-hunk/*`] -> Search code, docs, tests, and specs for `vscode-hunk`, `projects/vs-code-extension`, and `vs-code-extension-unstaged-hunk-pane`; remove or rewrite every live reference.
- [Launchpad tests assume reserved coordinates] -> Update fixtures and tests together so deleted hunk-control coordinates either become ordinary static pads or are unbound by ordinary layout choice, not by a VS Code reservation.
- [Voice review loses reverted-hunk facts accidentally] -> Keep the provider-neutral Sheaf Chat command result path and its reverted/undo facts, while removing only VS Code-specific command-result handling.
- [OpenSpec archive leaves empty capability shells] -> During implementation/archive, delete the live spec directories for the two removed capabilities and validate that `openspec/specs/` no longer contains them.

