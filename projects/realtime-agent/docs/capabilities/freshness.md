# Capability: Freshness

ID prefix: `fr`

## Purpose

The extension tracks which editor state the model has observed through
tools — file contents, the visible viewport, the cursor — and, when that
state changes for a non-agent reason, pushes a structured context message
into the conversation so the model knows it is stale. Pushes inform; they
never request a response.

## Requirements

- **[fr-1]** THE freshness service SHALL track three staleness kinds:
  per-file content (`file_changed_since_last_read`), the viewport
  (`viewport_changed_since_last_check`), and the cursor
  (`cursor_changed_since_last_check`). Viewport and cursor are single
  global states; files are tracked per workspace-relative path.
- **[fr-2]** Observation marks SHALL come from tool execution
  ([editor-tools](editor-tools.md)): `code_read` and `modifyFile` mark the
  file; `read_visible_range` marks file, viewport, and cursor;
  `set_cursor_position` marks the cursor (plus viewport when a visible
  range was requested, plus file when the returned window has lines);
  `move_visible_range` marks the viewport (plus file/cursor conditionally,
  et-10). `rgrep` and `list_files` mark nothing. A mark clears the
  corresponding changed/notified flags, so the next change can notify
  again.
- **[fr-3]** WHEN a text document changes, THE service SHALL flag the file
  stale only if that file was previously observed (fr-2); WHEN the visible
  ranges or selection of the *active* editor change, it SHALL flag
  viewport/cursor stale only if that state was ever observed this session;
  WHEN the active editor switches (including to no editor), it SHALL flag
  both viewport and cursor stale (payload file = the new file when one
  exists, else the previously tracked file).
- **[fr-4]** THE service SHALL send at most one notification per stale kind
  (per file, for file staleness) until the model re-observes that state;
  further changes while a notification is outstanding SHALL NOT re-notify.
- **[fr-5]** WHILE an agent-mutation guard is open
  (`beginAgentMutation()`/`end()`, depth-counted), editor change events
  SHALL NOT flag staleness; an active-editor switch during a guard SHALL
  update the tracked current file without notifying. Guards are opened by
  the navigation and write tools and closed on the next macrotask.
- **[fr-6]** THE service SHALL ignore documents that are not `file`-scheme,
  documents with languageId `git` or `vscode-scm`, and documents outside
  every workspace root (containment computed against the roots, never via
  `asRelativePath`, so absolute paths cannot leak into pushes).
- **[fr-7]** Notifications SHALL be sent with
  `session.sendStructuredContext(message)` (no `createResponse` — the
  model is not asked to answer) using exactly the envelopes in Contracts,
  and recorded as chat context bubbles; a send failure is logged and not
  retried.
- **[fr-8]** THE service lifecycle SHALL be bound to the session: attached
  with fresh empty state when a session starts, detached and fully cleared
  (listeners disposed, maps reset, guard depth zeroed) when the session
  stops or the connection is lost. Tool hooks route through a coordinator
  that is a no-op while no service is attached.

## Contracts

### Push envelopes (exact)

Serialized through the structured-context envelope
([session-lifecycle](session-lifecycle.md) ses-13):

```json
{"kind":"file_changed_since_last_read","source":"vscode","payload":{"file":"src/example.ts"},"summary":"src/example.ts changed since last read"}
{"kind":"viewport_changed_since_last_check","source":"vscode","payload":{"file":"src/example.ts"},"summary":"Visible range changed since last check"}
{"kind":"cursor_changed_since_last_check","source":"vscode","payload":{"file":"src/example.ts"},"summary":"Cursor position changed since last check"}
```

`payload.file` is the workspace-relative POSIX path of the affected file
(for viewport/cursor: the file whose editor state changed, falling back to
the previously tracked file on tab close).

### Clearing matrix

| Stale kind | Cleared by |
|---|---|
| File | `code_read`, `modifyFile` (own edit), window-returning navigation reads (et-9/10), `read_visible_range` |
| Viewport | `read_visible_range`, `set_cursor_position` with `returnVisibleRange`, `move_visible_range` |
| Cursor | `read_visible_range`, `set_cursor_position`, `move_visible_range` when the cursor is in the returned range |

## Design

- `src/vscode-extension/src/freshness/freshnessService.ts` — per-session
  state machine: `m_files` map, viewport/cursor states
  (`everObserved`/`changedSinceLastCheck`/`notificationSent`),
  `m_agentMutationDepth`, VS Code listeners
  (`onDidChangeTextDocument`, `onDidChangeActiveTextEditor`,
  `onDidChangeTextEditorVisibleRanges`, `onDidChangeTextEditorSelection`).
- `freshnessCoordinator.ts` — long-lived hook facade handed to the tool
  set at activation; `attach`/`detach` swap the per-session service.
- `contextBuilders.ts` — the three envelope builders.
- `vscodeFreshnessHost.ts` — event-source seam so tests can drive synthetic
  editor events (`tests/vscode-extension/helpers/fakeVscodeEvents.ts`).
- `notificationSent` is set before the async send resolves, so a failed
  send drops that notification until the state is re-observed (listed in
  [coverage](../coverage.md)).
- Tests: `tests/vscode-extension/freshness/*.test.ts` (file, viewport,
  cursor, tab switch, outside-workspace, agent mutation, tool observations
  during session, service lifecycle, coordinator).

## Interactions

- [editor-tools](editor-tools.md) — observation marks and mutation guards.
- [session-lifecycle](session-lifecycle.md) — `sendStructuredContext`
  envelope and delivery.
- [vscode-extension](vscode-extension.md) — service attach/detach on
  session start/stop; pushes rendered as context bubbles.
