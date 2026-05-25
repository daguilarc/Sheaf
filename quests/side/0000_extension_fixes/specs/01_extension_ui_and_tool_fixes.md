# Extension UI and Tool Fixes

## Overview

The VS Code extension should receive a small set of quality-of-life fixes for the
realtime chat UI and the `sheaf VS Code` tool surface. The changes are scoped to:

- session button color state
- realtime chat follow mode
- `list_files` result limiting behavior
- a new `rgrep_files` tool for `rgrep --files` style file discovery
- new LSP-backed tools that use VS Code language APIs

These changes extend the existing extension behavior without changing the
realtime session lifecycle or the existing `modifyFile` contract.

## Session Button Colors

The chat pane controls should visually communicate whether a realtime session is
running.

Behavior:

- When the session is inactive (`idle`), the start/stop button should use an
  inactive or neutral color treatment.
- When the session is active (`active`), the start/stop button should use a
  distinct active/running color treatment.
- During transient states (`starting` and `stopping`), the button remains
  disabled and should use a disabled/transient treatment that does not imply a
  stable running or stopped state.
- The commit/respond button remains enabled only while the session is active.
  Its color should continue to communicate a secondary action.
- Color choices should use VS Code theme variables where possible so the control
  remains legible in light, dark, and high-contrast themes.

Acceptance criteria:

- The start/stop button is visibly different when `sessionState` is `idle` versus
  `active`.
- The disabled transient states cannot be confused with a clickable active or
  idle state.
- Existing keyboard shortcuts and command behavior are unchanged.

## Chat Follow Mode

The realtime chat window should support follow mode. Follow mode means new chat
content automatically scrolls to the bottom as bubbles are appended or updated.

State:

```ts
export interface ChatFollowState
{
  following: boolean;
}
```

Behavior:

- Follow mode should be active by default when the chat view is first opened.
- If the user scrolls all the way to the bottom, follow mode becomes active.
- If the user scrolls up from the bottom, follow mode becomes inactive.
- When follow mode is active and a new snapshot renders, the bubble list should
  scroll to the bottom after DOM updates are applied.
- When follow mode is inactive, rendering a new snapshot must preserve the user's
  current scroll position as much as practical.
- The bottom threshold should allow a small tolerance so sub-pixel layout,
  fractional zoom, and font rendering do not prevent follow mode from activating.
  A threshold around 4 px is acceptable.
- The implementation should not request focus, move editor focus, or interrupt
  keyboard interaction outside the webview.

Indicator:

- Show a small, unobtrusive icon in the chat pane indicating whether follow mode
  is active.
- The indicator should not be a large primary action and should not compete with
  the session controls.
- The icon should have an accessible label or title such as `Follow mode on` or
  `Follow mode off`.
- It is acceptable for the indicator to be read-only in this slice. Toggling
  follow mode by clicking the indicator is optional and can be deferred.

Acceptance criteria:

- Opening the chat view and receiving messages scrolls to the newest content by
  default.
- Scrolling up disables auto-follow.
- Scrolling back to the bottom re-enables auto-follow.
- The chat pane displays a compact visual indicator for the current follow-mode
  state.

## List Files Limit

The existing `list_files` tool should have a hard maximum listing limit of 1,000
entries.

Tool name:

```text
list_files
```

Arguments:

```ts
export interface ListFilesArgs
{
  directory: string;
  recursive?: boolean;
  includeHidden?: boolean;
  maxEntries?: number;
}
```

Behavior changes:

- `maxEntries` may be omitted, but the effective maximum must never exceed
  1,000.
- If `maxEntries` is provided and is greater than 1,000, return a structured
  error instead of clamping silently.
- If listing discovers more than the effective maximum, return a structured
  error instead of returning a truncated result.
- When the discovered file count is greater than 1,000, the error message must be
  exactly:

```text
Please reduce max depth.
```

- The tool should avoid walking the entire workspace once it can prove the limit
  has been exceeded.
- Existing path validation, hidden-file behavior, ignored directory behavior, and
  ordering expectations remain in force for successful responses.

Result on success:

```ts
export interface ListFilesResult
{
  directory: string;
  recursive: boolean;
  truncated: false;
  entries: FileEntry[];
}
```

Error behavior:

```ts
export interface ToolError
{
  code: string;
  message: string;
  details?: Record<string, unknown>;
}
```

The preferred error code for exceeding the limit is `too_many_results`.

Acceptance criteria:

- `list_files` returns at most 1,000 entries.
- More than 1,000 discovered entries returns `code: "too_many_results"` and
  `message: "Please reduce max depth."`.
- Tests cover exact-bound behavior: exactly 1,000 entries succeeds, 1,001 entries
  fails.

## Rgrep Files Tool

The existing `rgrep` tool searches file contents. It does not currently expose a
mode equivalent to `rgrep --files`, so this quest should add a new tool rather
than overloading content search.

Tool name:

```text
rgrep_files
```

Purpose:

Return workspace-relative file paths that match the same file discovery scope the
content-search `rgrep` tool would search, without searching inside file contents.
This is the voice-tool equivalent of asking "what files would rgrep search?" or
using an `rgrep --files` style operation.

Arguments:

```ts
export interface RgrepFilesArgs
{
  directory?: string;
  fileGlob?: string;
  includeHidden?: boolean;
  maxFiles?: number;
}
```

Behavior:

- `directory` limits discovery to a workspace-relative directory. If omitted,
  discover files across the workspace.
- `fileGlob` optionally limits matched files using VS Code-compatible glob
  semantics. If omitted, use the existing all-file discovery pattern.
- `includeHidden` defaults to `false` and should preserve the extension's current
  hidden-file and common-ignore behavior.
- `maxFiles` defaults to an implementation-defined bounded value.
- `maxFiles` must be a positive integer.
- The tool must use the same VS Code workspace file discovery approach as the
  current `rgrep` implementation, not shelling out to an external command.
- Results should be sorted lexicographically by workspace-relative path.
- If more files are discovered than `maxFiles`, omit additional entries and set
  `truncated: true`.

Result:

```ts
export interface RgrepFilesResult
{
  directory?: string;
  fileGlob?: string;
  truncated: boolean;
  files: string[];
}
```

Error behavior:

- Invalid directories return the existing path-related tool errors.
- Invalid `maxFiles` returns `code: "invalid_range"`.
- The tool should use the shared `ToolError` shape.

Acceptance criteria:

- `rgrep_files` is registered in the `sheaf VS Code` tool call set.
- The built-in system prompt mentions `rgrep_files` as the file-listing companion
  to content-search `rgrep`.
- Tests cover workspace-wide discovery, directory-limited discovery, glob
  filtering, and truncation.

## LSP Tools

Add a small set of tools for querying language intelligence from the language
server associated with the current VS Code workspace.

These tools must not connect directly to an LSP server, speak the LSP protocol,
open sockets, spawn language-server processes, or inspect language-server
configuration files. They must use VS Code APIs and command providers so VS Code
continues to own language extension activation, workspace trust, language-server
selection, document synchronization, cancellation, and provider routing.

If VS Code has no language provider or language server available for the target
file/workspace, these tools must return a structured tool error instead of
falling back to text search or guessing.

Shared position type:

```ts
export interface LspPosition
{
  file: string;
  line: number;
  character?: number;
}
```

Position semantics:

- `file` is workspace-relative.
- `line` is 1-based.
- `character` is 0-based and defaults to `0`.
- Positions refer to the current VS Code text document buffer, not necessarily
  the file contents on disk.
- Files must resolve inside the open workspace.

Shared location result:

```ts
export interface LspLocation
{
  file: string;
  startLine: number;
  startCharacter: number;
  endLine: number;
  endCharacter: number;
  preview?: string;
}
```

Shared error behavior:

```ts
export type LspToolErrorCode =
  | "lsp_unavailable"
  | "invalid_position"
  | "invalid_range"
  | "file_not_found"
  | "path_outside_workspace"
  | "unsupported_document";
```

Use the existing `ToolError` shape:

```ts
export interface ToolError
{
  code: string;
  message: string;
  details?: Record<string, unknown>;
}
```

For unavailable language support, return:

```ts
{
  code: "lsp_unavailable",
  message: "No language server is available for this file."
}
```

The implementation may include compact details such as the file path and
language id. It must not dump large language-server outputs, VS Code logs, or
environment diagnostics into tool error details.

### Definition Tool

Tool name:

```text
lsp_definitions
```

Arguments:

```ts
export interface LspDefinitionsArgs
{
  position: LspPosition;
  maxResults?: number;
}
```

Behavior:

- Open or resolve the target document through VS Code.
- Call VS Code's definition provider command/API for the target position.
- Return locations for definitions, declarations, type definitions, or
  implementation targets only if the physical plan explicitly maps those modes.
  The initial tool should prefer definitions only.
- `maxResults` defaults to an implementation-defined bounded value and must be a
  positive integer.
- If the provider is unavailable, return `lsp_unavailable`.
- If the provider is available but no definition exists at the position, return
  an empty `locations` array.

Result:

```ts
export interface LspDefinitionsResult
{
  position: LspPosition;
  truncated: boolean;
  locations: LspLocation[];
}
```

### References Tool

Tool name:

```text
lsp_references
```

Arguments:

```ts
export interface LspReferencesArgs
{
  position: LspPosition;
  includeDeclaration?: boolean;
  maxResults?: number;
}
```

Behavior:

- Use VS Code's references provider for the target document and position.
- `includeDeclaration` defaults to `true`.
- `maxResults` defaults to an implementation-defined bounded value and must be a
  positive integer.
- Results should be sorted by file path, then start line, then start character.
- If more references are available than `maxResults`, omit the rest and set
  `truncated: true`.
- If the provider is unavailable, return `lsp_unavailable`.
- If the provider is available but no references exist, return an empty
  `locations` array.

Result:

```ts
export interface LspReferencesResult
{
  position: LspPosition;
  includeDeclaration: boolean;
  truncated: boolean;
  locations: LspLocation[];
}
```

### Hover Tool

Tool name:

```text
lsp_hover
```

Arguments:

```ts
export interface LspHoverArgs
{
  position: LspPosition;
  maxCharacters?: number;
}
```

Behavior:

- Use VS Code's hover provider for the target document and position.
- Convert hover markdown/code blocks into compact text or markdown suitable for a
  tool result.
- `maxCharacters` defaults to an implementation-defined bounded value and must
  be a positive integer.
- If returned hover content exceeds `maxCharacters`, truncate the rendered
  content and set `truncated: true`.
- If the provider is unavailable, return `lsp_unavailable`.
- If the provider is available but there is no hover at the position, return an
  empty `contents` array.

Result:

```ts
export interface LspHoverResult
{
  position: LspPosition;
  truncated: boolean;
  contents: string[];
}
```

### Document Symbols Tool

Tool name:

```text
lsp_document_symbols
```

Arguments:

```ts
export interface LspDocumentSymbolsArgs
{
  file: string;
  maxSymbols?: number;
}
```

Result shape:

```ts
export interface LspDocumentSymbol
{
  name: string;
  kind: string;
  detail?: string;
  range: LspLocation;
  selectionRange?: LspLocation;
  children?: LspDocumentSymbol[];
}

export interface LspDocumentSymbolsResult
{
  file: string;
  truncated: boolean;
  symbols: LspDocumentSymbol[];
}
```

Behavior:

- Use VS Code's document symbol provider for the target document.
- `maxSymbols` defaults to an implementation-defined bounded value and must be a
  positive integer.
- Preserve provider hierarchy where possible.
- If the provider returns flat symbol information, adapt it into the same result
  shape with no `children`.
- If more symbols are available than `maxSymbols`, omit the rest and set
  `truncated: true`.
- If the provider is unavailable, return `lsp_unavailable`.
- If the provider is available but the document has no symbols, return an empty
  `symbols` array.

### Workspace Symbols Tool

Tool name:

```text
lsp_workspace_symbols
```

Arguments:

```ts
export interface LspWorkspaceSymbolsArgs
{
  query: string;
  maxSymbols?: number;
}
```

Result:

```ts
export interface LspWorkspaceSymbolsResult
{
  query: string;
  truncated: boolean;
  symbols: LspDocumentSymbol[];
}
```

Behavior:

- Use VS Code's workspace symbol provider.
- `query` is required and may be an empty string only if VS Code providers handle
  that efficiently. If broad empty queries are too expensive for installed
  providers, return `invalid_range`.
- `maxSymbols` defaults to an implementation-defined bounded value and must be a
  positive integer.
- Results should be sorted according to provider order unless the physical plan
  finds a stronger existing local convention.
- If the provider is unavailable, return `lsp_unavailable`.
- If the provider is available but no symbols match, return an empty `symbols`
  array.

### Diagnostics Tool

Tool name:

```text
lsp_diagnostics
```

Arguments:

```ts
export interface LspDiagnosticsArgs
{
  file?: string;
  maxDiagnostics?: number;
}
```

Result:

```ts
export interface LspDiagnostic
{
  file: string;
  startLine: number;
  startCharacter: number;
  endLine: number;
  endCharacter: number;
  severity: "error" | "warning" | "information" | "hint";
  source?: string;
  code?: string;
  message: string;
}

export interface LspDiagnosticsResult
{
  file?: string;
  truncated: boolean;
  diagnostics: LspDiagnostic[];
}
```

Behavior:

- Use VS Code diagnostics APIs, not direct language-server protocol calls.
- If `file` is provided, return diagnostics for that workspace-relative file.
- If `file` is omitted, return diagnostics for workspace files only.
- `maxDiagnostics` defaults to an implementation-defined bounded value and must
  be a positive integer.
- Sort diagnostics by file path, severity, line, then character.
- If more diagnostics are available than `maxDiagnostics`, omit the rest and set
  `truncated: true`.
- If diagnostics support appears unavailable for the workspace, return
  `lsp_unavailable`.
- If diagnostics support is available but there are no diagnostics, return an
  empty `diagnostics` array.

### LSP Tool Registration

Register the LSP tools in the existing `sheaf VS Code` tool call set:

- `lsp_definitions`
- `lsp_references`
- `lsp_hover`
- `lsp_document_symbols`
- `lsp_workspace_symbols`
- `lsp_diagnostics`

The built-in prompt should describe these tools as VS Code language-intelligence
tools and should explicitly say they use VS Code's configured language support,
not direct LSP server connections.

Acceptance criteria:

- LSP tools use VS Code language APIs or VS Code provider commands only.
- No tool opens a direct LSP transport, launches a language server, or parses
  language-server config.
- Tools return `lsp_unavailable` when no relevant provider/language server is
  configured for the target file or workspace.
- Tools return empty result arrays when a provider is available but has no result.
- All file paths in results are workspace-relative.
- Tests cover provider success, no-provider `lsp_unavailable`, invalid
  positions, max-result truncation, and registration in `sheaf VS Code`.

## Documentation and Prompt Updates

Update the extension-facing docs and built-in prompt so the agent understands the
expanded tool surface.

Required updates:

- `docs/architecture/VSCODE_EXTENSION.md` lists `rgrep_files` and the LSP tools.
- `docs/product/PRD.md` and `docs/product/ROADMAP.md` reflect the new tools if
  they still enumerate the stable tool names.
- The built-in prompt mentions:
  - `list_files` fails with `Please reduce max depth.` when the request is too
    broad.
  - `rgrep` searches file contents.
  - `rgrep_files` lists searchable file paths.
  - LSP tools query VS Code's configured language support and report
    `lsp_unavailable` when no language server/provider is available.

## Test Expectations

The physical plan should include focused VS Code extension tests for:

- session button color classes across `idle`, `starting`, `active`, and
  `stopping`
- chat follow mode entering and exiting based on scroll position
- follow mode indicator rendering and accessible label/title
- `list_files` exact 1,000-entry success and 1,001-entry failure
- `rgrep_files` schema, registration, discovery, filtering, and truncation
- LSP tool schema, registration, provider success paths, unavailable-provider
  errors, invalid positions, truncation, and workspace-relative result paths

Manual smoke coverage should include opening the chat pane, starting and stopping
a session, confirming button color changes, verifying that incoming chat content
follows only while follow mode is active, and confirming at least one LSP tool
works in a workspace with language support installed.
