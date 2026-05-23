# Slice 0006 — Context Freshness Notifications

## Objective

Track when files, the active viewport, and the cursor have changed
since the agent last observed them, and push structured-context
notifications via `session.sendStructuredContext(...)` so the model
knows its prior reads may be stale. Agent-originated changes never
produce notifications.

This completes Spec 03's freshness behavior.

## Scope

In scope:

- A new `FreshnessService` in `apps/vscode-extension/src/freshness/`
  that owns:
  - Per-file `FileFreshnessState` map.
  - Single `ViewportFreshnessState`.
  - Single `CursorFreshnessState`.
- Subscriptions to:
  - `vscode.workspace.onDidChangeTextDocument`
  - `vscode.window.onDidChangeActiveTextEditor`
  - `vscode.window.onDidChangeTextEditorVisibleRanges`
  - `vscode.window.onDidChangeTextEditorSelection`
- Integration with slice 0004 tools: every navigation/read tool that
  successfully observes a file, the cursor, or a visible range calls a
  `FreshnessService.markObserved*` method before returning its result.
- An "agent-originated change" marker passed by `set_cursor_position`
  and `move_visible_range` so the resulting VS Code change events do
  not flip freshness back to stale.
- One structured-context push per file/viewport/cursor freshness
  transition, gated by `notificationSent`.
- Chat-pane hook: every push also calls
  `chatModel.recordContextPush(message)` (from slice 0005) so the user
  sees the push.

Out of scope:

- Sending diffs or partial-file deltas.
- Coalescing multiple file changes into one notification.
- Future "language-server context" pushes.

## Key Files / Systems Affected

New files:

```
apps/vscode-extension/src/freshness/
  freshnessService.ts     # state + subscriptions + push gating
  types.ts                # FileFreshnessState, ViewportFreshnessState,
                          # CursorFreshnessState
  contextBuilders.ts      # build StructuredContextMessage for each kind
```

Updates:

- `src/extension.ts` — instantiate `FreshnessService` after the session
  starts and dispose it on session stop. The service needs the active
  `RealtimeAgentSession` and `ChatModel`.
- `src/sessionController.ts` — expose a `getActiveSession()` accessor
  and a state listener so the freshness service can attach/detach with
  the session lifecycle. Pass `{ markAgentOriginated }` into the tool
  set so navigation tools can flag their own mutations.
- `src/tools/index.ts` — `BuildVscodeToolCallSet` accepts a
  `freshness` dependency. Each relevant tool calls
  `freshness.markObserved*` (read tools) or
  `freshness.beginAgentMutation()` / `endAgentMutation()` (movement
  tools).

## APIs To Reuse As-Is

- `session.sendStructuredContext(message)` — added in slice 0001. The
  freshness service uses it with no special options (no
  `createResponse: true`); spec explicitly says freshness pushes do not
  request a response.
- VS Code change-event APIs listed above.
- `ChatModel.recordContextPush` from slice 0005.

## APIs To Extend / Modify

- `SessionController` gets an emitter
  `onSessionStarted(listener)` (signature: `(session: RealtimeAgentSession)
  => void`) and `onSessionStopped(listener)` so the freshness service
  attaches per session.
- `BuildVscodeToolCallSet` signature gains a `freshness?:
  FreshnessHooks` parameter:

```ts
export interface FreshnessHooks {
  markFileObserved(file: string): void;
  markViewportObserved(file: string): void;
  markCursorObserved(file: string): void;
  beginAgentMutation(): { end: () => void };
}
```

The hooks are optional so tools remain testable in isolation without
the service.

## Design Notes

### State storage

`FreshnessService` keeps an in-memory `Map<string,
FileFreshnessState>` keyed by workspace-relative path. Files that have
never been observed are not tracked: notifications fire only after at
least one observation, since the spec rule is "changed since last
read". Untracked files are not pushed when they change.

Viewport and cursor freshness are single-instance because the spec
ties them to the active editor. If the active editor changes, both
flags reset to `{ changedSinceLastCheck: false, notificationSent:
false }` and the `currentFile` reference updates. The current active
file is used when building the structured-context payload.

### Agent mutation marker

`beginAgentMutation()` increments an internal counter; `end()`
decrements it. While the counter is > 0, all VS Code change events are
treated as agent-originated and update the "observed" snapshot in
place (i.e., they update the last-known state without raising any
stale flag). This handles the case where applying a cursor move
triggers an async `onDidChangeTextEditorSelection` event after the
tool's `markCursorObserved` already ran.

Practical pattern in `set_cursor_position`:

```ts
const guard = freshness.beginAgentMutation();
try
{
  // perform reveal + selection set
  // ...
}
finally
{
  // Allow the event loop to flush change events before clearing.
  setImmediate(() => guard.end());
}
```

`setImmediate` deferral gives VS Code time to fire the synchronous-
looking events. This is documented inline.

### Notification gating

For each kind:

1. `markObserved*(file)` sets `changedSinceLastCheck = false` and
   `notificationSent = false`, and updates `lastKnown*` snapshot.
2. A non-agent change handler sets `changedSinceLastCheck = true`.
3. After every state mutation, the service calls
   `maybeNotify*(state)`. If `changedSinceLastCheck` and
   `!notificationSent`, build the structured context, call
   `session.sendStructuredContext(message)`, set
   `notificationSent = true`, and record the push to the chat model.
4. Errors from `sendStructuredContext` (e.g., session disconnected) are
   logged via the extension output channel and do not crash the
   listener.

### Cross-tool observation rules

- `code_read` → `markFileObserved(file)` on success.
- `list_files` → no observation (does not read file contents).
- `rgrep` → no observation per-file. The spec ties freshness to "the
  agent read [the file]" via read tools; rgrep matches are not full
  reads. Document this decision in `freshnessService.ts`. Future
  refinement may add partial-read tracking, but the spec does not
  require it.
- `read_visible_range` → `markFileObserved(file)`,
  `markViewportObserved(file)`, `markCursorObserved(file)`.
- `set_cursor_position` → `markCursorObserved(file)`. If
  `returnVisibleRange` is provided, also
  `markViewportObserved(file)` and `markFileObserved(file)` for the
  returned region.
- `move_visible_range` → `markViewportObserved(file)`. If
  `returnVisibleRange` and the cursor is in view, also
  `markCursorObserved(file)`. `markFileObserved(file)` when the
  returned region contains real lines.

### Structured-context payloads

`contextBuilders.ts`:

```ts
export function buildFileChangedMessage(file: string): StructuredContextMessage
{
  return {
    kind: "file_changed_since_last_read",
    source: "vscode",
    payload: { file },
    summary: `${file} changed since last read`,
  };
}

export function buildViewportChangedMessage(file: string): StructuredContextMessage
{
  return {
    kind: "viewport_changed_since_last_check",
    source: "vscode",
    payload: { file },
    summary: "Visible range changed since last check",
  };
}

export function buildCursorChangedMessage(file: string): StructuredContextMessage
{
  return {
    kind: "cursor_changed_since_last_check",
    source: "vscode",
    payload: { file },
    summary: "Cursor position changed since last check",
  };
}
```

### Change-event filtering

- `onDidChangeTextDocument`: ignore events whose document URI is not
  inside the workspace. Ignore events where the document language is
  `git` or `vscode-scm` (these are pseudo-documents). Apply per the
  observed-file map.
- `onDidChangeActiveTextEditor`: when the active file changes, treat
  the new file as unobserved (no notification), reset viewport/cursor
  states, but do not push notifications.
- `onDidChangeTextEditorVisibleRanges`: tied to the current active
  editor's file.
- `onDidChangeTextEditorSelection`: tied to the current active
  editor's file. Multi-cursor changes count as cursor changes.

### Lifecycle

- On `SessionController.onSessionStarted`, the freshness service
  attaches its VS Code listeners and resets all state.
- On `SessionController.onSessionStopped`, it disposes listeners and
  clears state.

## Validation

- Tests under `apps/vscode-extension/test/freshness/`:
  - `fileFreshness.test.ts` — observe → change → push once. Second
    change without re-observation does not push. Re-observe →
    change → push again. Multiple files tracked independently.
  - `viewportFreshness.test.ts` — observe via `read_visible_range`
    fake call, simulate viewport change, expect one push.
  - `cursorFreshness.test.ts` — observe via `set_cursor_position`
    fake call, simulate user cursor move, expect one push.
  - `agentMutation.test.ts` — wrapping a mutation in
    `beginAgentMutation`/`end` suppresses pushes for the resulting
    change events.
  - `serviceLifecycle.test.ts` — service detaches listeners on
    session stop; no pushes after detach.
- All tests run against a fake `vscode` event emitter rig defined in
  `test/helpers/fakeVscodeEvents.ts`.

## Risks / Open Concerns

- `setImmediate`-based agent-mutation deferral is heuristic. If a
  change event arrives after the deferral window, it will be treated
  as a user change. In practice, VS Code's selection/visible-range
  events fire synchronously with the action, so a single
  `setImmediate` is sufficient. If integration testing reveals flakes,
  the implementer can extend the window or hook the specific events
  during the mutation rather than counting elapsed time.
- Workspace-relative path canonicalization is shared with the
  navigation tools; this slice imports from
  `apps/vscode-extension/src/tools/pathPolicy.ts` rather than
  duplicating it.
- rgrep is intentionally not treated as a full-file read. If the
  reviewer wants rgrep to suppress freshness pushes for matched
  files, the change is local to `rgrep.ts`. Flagged here for
  visibility; not escalating.
