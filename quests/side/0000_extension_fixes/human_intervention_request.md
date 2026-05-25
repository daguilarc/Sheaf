# Human intervention requested

**Reason:** The LSP-tool portion of the quest cannot be planned to completion without a confirmed VS Code API strategy for `lsp_unavailable`.

The quest spec requires all LSP-backed tools to:

- return `lsp_unavailable` when no relevant language provider / language server is available
- return an empty result array when a provider is available but has no result

After reviewing the current extension seams and the locally available VS Code type surface in `apps/vscode-extension/node_modules/@types/vscode/index.d.ts`, I could not confirm a stable, supported way to distinguish those two cases for these APIs:

- definition provider
- references provider
- hover provider
- document symbol provider
- workspace symbol provider
- diagnostics

What I verified locally:

- The repo already uses a thin `EditorAccess` abstraction plus a `MemoryEditorAccess` test harness for tool logic.
- VS Code type definitions in the workspace expose provider registration APIs and `languages.getDiagnostics(...)`, but they do not expose an obvious provider-availability inspection API for third-party language features.
- The local type surface does not document the runtime return-shape distinction needed to know whether `vscode.execute*Provider`-style commands return `undefined`, `[]`, or some other sentinel when no provider exists versus when a provider exists but returns no result.

Why this blocks the physical plan:

- The quest instructions explicitly forbid leaving major implementation decisions unspecified.
- Choosing a heuristic here would directly determine whether the implemented tools satisfy or violate the spec’s required `lsp_unavailable` behavior.
- The diagnostics tool is especially ambiguous because `languages.getDiagnostics()` is always callable, but the spec still requires an `lsp_unavailable` branch when diagnostics support is unavailable for the workspace.

Requested clarification:

1. Is there an approved VS Code API contract we should rely on for distinguishing “no provider available” from “provider available but no result” for these provider-execution commands?
2. If VS Code does not expose that distinction reliably, what fallback behavior is acceptable for this quest?
3. For `lsp_diagnostics`, what concrete condition should count as “diagnostics support appears unavailable” versus “support is available but there are simply no diagnostics”?

Once that behavior is clarified, I can finish the slice breakdown and the physical plan docs.
