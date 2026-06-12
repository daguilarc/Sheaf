# Capability: Freshness

Project: `projects/realtime-agent`
ID prefix: `fr` — requirement IDs are append-only; never renumber or reuse.

## Purpose

The extension tracks which editor state the model has observed through
tools — file contents, the visible viewport, the cursor — and, when that
state changes for a non-agent reason, pushes a structured context message
into the conversation so the model knows it is stale. Pushes inform; they
never request a response.

## Requirements

### Requirement: fr-1 — Three staleness kinds

THE freshness service SHALL track three staleness kinds: per-file content (`file_changed_since_last_read`), the viewport (`viewport_changed_since_last_check`), and the cursor (`cursor_changed_since_last_check`). Viewport and cursor are single global states; files are tracked per workspace-relative path.

#### Scenario: File staleness tracked per path
- **WHEN** a file's content changes
- **THEN** the service tracks staleness per workspace-relative path for that file

#### Scenario: Viewport and cursor are global
- **WHEN** the viewport or cursor state changes
- **THEN** staleness is tracked as a single global state (not per file)

### Requirement: fr-2 — Observation marks from tool execution

Observation marks SHALL come from tool execution ([editor-tools](../realtime-agent-editor-tools/spec.md)): `code_read` and `modifyFile` mark the file; `read_visible_range` marks file, viewport, and cursor; `set_cursor_position` marks the cursor (plus viewport when a visible range was requested, plus file when the returned window has lines); `move_visible_range` marks the viewport (plus file/cursor conditionally, et-10). `rgrep` and `list_files` mark nothing. A mark clears the corresponding changed/notified flags, so the next change can notify again.

#### Scenario: code_read marks file
- **WHEN** `code_read` is executed
- **THEN** the file is marked as observed and the changed/notified flags are cleared

#### Scenario: modifyFile marks file
- **WHEN** `modifyFile` is executed
- **THEN** the file is marked as observed and the changed/notified flags are cleared

#### Scenario: read_visible_range marks file, viewport, and cursor
- **WHEN** `read_visible_range` is executed
- **THEN** the file, viewport, and cursor are all marked as observed with changed/notified flags cleared

#### Scenario: set_cursor_position marks cursor (and conditionally viewport and file)
- **WHEN** `set_cursor_position` is executed
- **THEN** the cursor is marked observed; viewport is also marked when a visible range was requested; file is also marked when the returned window has lines

#### Scenario: move_visible_range marks viewport
- **WHEN** `move_visible_range` is executed
- **THEN** the viewport is marked observed (plus file/cursor conditionally per et-10)

#### Scenario: rgrep and list_files mark nothing
- **WHEN** `rgrep` or `list_files` is executed
- **THEN** no observation marks are set

### Requirement: fr-3 — Staleness flagging rules

WHEN a text document changes, THE service SHALL flag the file stale only if that file was previously observed (fr-2); WHEN the visible ranges or selection of the *active* editor change, it SHALL flag viewport/cursor stale only if that state was ever observed this session; WHEN the active editor switches (including to no editor), it SHALL flag both viewport and cursor stale (payload file = the new file when one exists, else the previously tracked file).

#### Scenario: Text document changes for observed file
- **WHEN** a text document changes and that file was previously observed
- **THEN** the service flags the file as stale

#### Scenario: Text document changes for unobserved file
- **WHEN** a text document changes and that file was not previously observed
- **THEN** the service does not flag the file as stale

#### Scenario: Visible ranges or selection change for observed viewport/cursor
- **WHEN** the visible ranges or selection of the active editor change and that state was ever observed this session
- **THEN** the service flags viewport/cursor as stale

#### Scenario: Visible ranges or selection change for never-observed state
- **WHEN** the visible ranges or selection of the active editor change and that state was never observed this session
- **THEN** the service does not flag viewport/cursor as stale

#### Scenario: Active editor switches
- **WHEN** the active editor switches (including to no editor)
- **THEN** the service flags both viewport and cursor as stale, with payload file set to the new file when one exists, else the previously tracked file

### Requirement: fr-4 — At-most-one notification per stale kind

THE service SHALL send at most one notification per stale kind (per file, for file staleness) until the model re-observes that state; further changes while a notification is outstanding SHALL NOT re-notify.

#### Scenario: First change triggers notification
- **WHEN** a state change causes a stale flag for the first time (no outstanding notification)
- **THEN** the service sends one notification for that stale kind

#### Scenario: Further changes while notification is outstanding
- **WHEN** additional changes occur while a notification for that stale kind is already outstanding
- **THEN** the service does not send another notification

### Requirement: fr-5 — Agent-mutation guard suppresses staleness

WHILE an agent-mutation guard is open (`beginAgentMutation()`/`end()`, depth-counted), editor change events SHALL NOT flag staleness; an active-editor switch during a guard SHALL update the tracked current file without notifying. Guards are opened by the navigation and write tools and closed on the next macrotask.

#### Scenario: Change event during open guard
- **WHEN** an editor change event occurs while an agent-mutation guard is open
- **THEN** the service does not flag any staleness

#### Scenario: Active-editor switch during open guard
- **WHEN** the active editor switches while an agent-mutation guard is open
- **THEN** the tracked current file is updated but no notification is sent

### Requirement: fr-6 — Ignored documents

THE service SHALL ignore documents that are not `file`-scheme, documents with languageId `git` or `vscode-scm`, and documents outside every workspace root (containment computed against the roots, never via `asRelativePath`, so absolute paths cannot leak into pushes).

#### Scenario: Non-file-scheme document changes
- **WHEN** a change event occurs for a document that is not `file`-scheme
- **THEN** the service ignores the event

#### Scenario: git or vscode-scm document changes
- **WHEN** a change event occurs for a document with languageId `git` or `vscode-scm`
- **THEN** the service ignores the event

#### Scenario: Document outside workspace roots
- **WHEN** a change event occurs for a document outside every workspace root
- **THEN** the service ignores the event (containment computed against the roots, not via `asRelativePath`)

### Requirement: fr-7 — Notification delivery

Notifications SHALL be sent with `session.sendStructuredContext(message)` (no `createResponse` — the model is not asked to answer) using exactly the envelopes in Contracts, and recorded as chat context bubbles; a send failure is logged and not retried.

#### Scenario: Notification sent via sendStructuredContext
- **WHEN** a staleness notification is due
- **THEN** the service calls `session.sendStructuredContext(message)` with the exact envelope from Contracts and records it as a chat context bubble

#### Scenario: Send failure
- **WHEN** `sendStructuredContext` fails
- **THEN** the failure is logged and the notification is not retried

### Requirement: fr-8 — Service lifecycle bound to session

THE service lifecycle SHALL be bound to the session: attached with fresh empty state when a session starts, detached and fully cleared (listeners disposed, maps reset, guard depth zeroed) when the session stops or the connection is lost. Tool hooks route through a coordinator that is a no-op while no service is attached.

#### Scenario: Session starts
- **WHEN** a session starts
- **THEN** the freshness service is attached with fresh empty state

#### Scenario: Session stops or connection lost
- **WHEN** the session stops or the connection is lost
- **THEN** the service is detached and fully cleared: listeners disposed, maps reset, guard depth zeroed

#### Scenario: Tool hook with no service attached
- **WHEN** a tool hook fires while no freshness service is attached
- **THEN** the coordinator is a no-op

## Contracts

### Push envelopes (exact)

Serialized through the structured-context envelope
([session-lifecycle](../realtime-agent-session-lifecycle/spec.md) ses-13):

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
  [coverage](../../../projects/realtime-agent/docs/coverage.md)).
- Tests: `tests/vscode-extension/freshness/*.test.ts` (file, viewport,
  cursor, tab switch, outside-workspace, agent mutation, tool observations
  during session, service lifecycle, coordinator).

## Interactions

- [editor-tools](../realtime-agent-editor-tools/spec.md) — observation marks and mutation guards.
- [session-lifecycle](../realtime-agent-session-lifecycle/spec.md) — `sendStructuredContext`
  envelope and delivery.
- [vscode-extension](../realtime-agent-vscode-extension/spec.md) — service attach/detach on
  session start/stop; pushes rendered as context bubbles.
