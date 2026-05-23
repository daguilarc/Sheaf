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

- A new `FreshnessCoordinator` (stable, owned by `SessionController`,
  exists for the extension's whole lifetime) that exposes a fixed
  `FreshnessHooks` reference. Tools always receive this reference at
  tool-set construction time and can call it before, during, or after
  any session. The coordinator delegates calls to whichever
  `FreshnessService` is attached to the currently active session — or
  no-ops when no session is active.
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
  freshnessCoordinator.ts # stable façade owned by SessionController;
                          # holds the active FreshnessService (or none)
                          # and exposes the FreshnessHooks proxy
  freshnessService.ts     # state + subscriptions + push gating
  types.ts                # FileFreshnessState, ViewportFreshnessState,
                          # CursorFreshnessState, FreshnessHooks
  contextBuilders.ts      # build StructuredContextMessage for each kind
```

Updates:

- `src/extension.ts` — construct one `FreshnessCoordinator` at
  activation, before any session, and pass `coordinator.hooks` into
  `BuildVscodeToolCallSet(...)`. The coordinator persists for the
  extension's lifetime.
- `src/sessionController.ts` — owns the coordinator. On
  `onSessionStarted`, instantiate a new `FreshnessService(session,
  chatModel)`, attach VS Code listeners inside the service, and call
  `coordinator.attach(service)`. On `onSessionStopped`, call
  `coordinator.detach()` which disposes the service's listeners and
  clears state. The coordinator continues to exist; the hooks
  reference held by the tool set is unchanged.
- `src/tools/index.ts` — `BuildVscodeToolCallSet` accepts a required
  `freshness: FreshnessHooks` dependency (slice 0004 already designed
  this dependency as optional; slice 0006 makes it required for the
  extension's tool set assembly). Each relevant tool calls
  `freshness.markObserved*` (read tools) or
  `freshness.beginAgentMutation()` / `endAgentMutation()` (movement
  tools). Tools never see the coordinator or the service; they only
  see the stable `FreshnessHooks` interface.

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

### Coordinator lifecycle and tool-set ordering

The tool call set must be built before `startAgentSession` is called,
because tools are part of the session configuration. The
`FreshnessService` cannot exist until a session exists. To resolve this
ordering, the slice introduces a `FreshnessCoordinator`:

```ts
export class FreshnessCoordinator {
  private current: FreshnessService | null = null;

  // Stable reference — handed to BuildVscodeToolCallSet at activation
  // time, reused across many sessions.
  readonly hooks: FreshnessHooks = {
    markFileObserved: (file) => this.current?.markFileObserved(file),
    markViewportObserved: (file) => this.current?.markViewportObserved(file),
    markCursorObserved: (file) => this.current?.markCursorObserved(file),
    beginAgentMutation: () => this.current
      ? this.current.beginAgentMutation()
      : { end: () => {} },
  };

  attach(service: FreshnessService): void { this.current = service; }
  detach(): void { this.current?.dispose(); this.current = null; }
}
```

Ordering during extension activation:

1. `activate()` constructs `FreshnessCoordinator` and `SessionController`.
2. `activate()` calls `BuildVscodeToolCallSet({ editorAccess,
   freshness: coordinator.hooks })`. The returned set is cached on the
   `SessionController`.
3. When the user toggles a session on, `SessionController.start()`
   calls `startAgentSession({ ..., toolCallSet: cachedSet, ... })`.
4. After the session resolves, `SessionController` builds
   `new FreshnessService(session, chatModel)`, calls
   `service.attachListeners()`, and `coordinator.attach(service)`. The
   tool hooks the model already holds now route to real state.
5. When the session stops, `coordinator.detach()` runs and the hooks
   silently no-op until the next session attaches.

While no session is attached, tools can still call the hooks. They
no-op safely:

- `markObserved*` is a state mutation; with no service, there is no
  state to mutate.
- `beginAgentMutation` returns an inert handle (`{ end: () => {} }`)
  so tools that wrap with try/finally still work.

This eliminates the circular dependency: hooks are constructed first,
the service is constructed last, and the proxy bridges the lifecycle
gap.

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

- On `SessionController.onSessionStarted`, the controller constructs a
  fresh `FreshnessService`, calls `service.attachListeners()` (which
  subscribes to the VS Code change events listed above and resets all
  state), then `coordinator.attach(service)`.
- On `SessionController.onSessionStopped`, the controller calls
  `coordinator.detach()`. The coordinator calls `service.dispose()`
  which removes all listeners and clears state. The coordinator and
  its `hooks` reference survive; the tool set continues to hold them
  unchanged across many session start/stop cycles.
- During extension deactivation, the coordinator is detached as part
  of normal disposal.

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
  - `coordinator.test.ts` — hook calls before any session attaches
    no-op safely (no throws, no recorded state). After
    `coordinator.attach(service)`, hook calls route to the service.
    After `coordinator.detach()`, subsequent hook calls no-op again.
    The same `coordinator.hooks` reference is used across
    attach/detach cycles, proving the tool-set ordering is sound.
  - `toolObservationsDuringSession.test.ts` — with a tool set built
    against `coordinator.hooks` and a single session attached, a
    simulated `code_read` call updates `FileFreshnessState` and a
    subsequent non-agent file change triggers exactly one push.
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
