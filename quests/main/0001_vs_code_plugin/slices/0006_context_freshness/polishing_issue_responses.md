# Issue responses

## Response QP-0001 2026-05-23T22:27:25Z

- issue_id: QP-0001
- outcome: Fixed
- explanation: Replaced the `asRelativePath`-based membership inference with an
  explicit workspace containment check driven by the host's workspace roots.

  Changes:

  - `apps/vscode-extension/src/freshness/vscodeFreshnessHost.ts`: dropped
    `asRelativePath` from `VscodeFreshnessHost` and added
    `getWorkspaceRoots(): string[]`. The production host now derives roots from
    `vscode.workspace.workspaceFolders` instead of relying on
    `vscode.workspace.asRelativePath(..., false)`, whose non-empty fallback for
    outside-workspace URIs was the root cause of the leak.
  - `apps/vscode-extension/src/freshness/freshnessService.ts`:
    `WorkspaceFileRelative(doc)` now performs an explicit containment check
    using `node:path.relative(root, doc.uri.fsPath)` against every configured
    workspace root, returning `undefined` for any URI that resolves outside all
    roots (or when no roots are configured). The relative path is built
    directly from the matched root, so even if VS Code's display helper would
    have returned an absolute path, no outside-workspace path can be emitted
    in `payload.file`. `OnDidChangeActiveTextEditor` now distinguishes
    "no active editor" (`undefined`) from "active editor exists but is outside
    the workspace": the latter is treated as a non-event (no push, no
    `currentFile` update), preserving the spec's "close all tabs" fallback for
    the genuine `undefined` case only.
  - `apps/vscode-extension/test/helpers/fakeVscodeEvents.ts`: removed the
    `asRelativePath` fake (whose empty-string outside-root return masked the
    production bug), added `getWorkspaceRoots()`, `setWorkspaceRoots()`,
    `clearWorkspaceRoots()`, and `makeOutside{FileUri,Document,Editor}()`
    helpers so tests can simulate outside-workspace URIs the same way
    production VS Code would surface them (an absolute fs path that is not
    inside any root).
  - `apps/vscode-extension/test/freshness/outsideWorkspace.test.ts` (new):
    covers an outside-workspace tab switch after observation (no viewport or
    cursor push, no absolute path leak in any prior push payload), an
    outside-workspace `onDidChangeTextDocument` (no file push), outside-
    workspace `onDidChangeTextEditorVisibleRanges` and
    `onDidChangeTextEditorSelection` (no pushes), the no-workspace-roots case
    (every URI treated as outside), and a multi-root workspace case (a file
    in any configured root produces a correct root-relative push).

  Verified by `npm run lint` and `npm run test` in
  `apps/vscode-extension/` (68 tests pass, including the 5 new
  outside-workspace tests and all pre-existing freshness, tab-switch,
  coordinator, lifecycle, and tool-observation tests).
