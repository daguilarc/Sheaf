# Physical Plan Issue Responses

## Response to QP-0001

- issue_id: QP-0001
- outcome: Fixed
- updated_at: 2026-05-23T19:30:00Z
- explanation: |
  Updated slice 0001
  (`slices/0001_session_api_and_turn_mode/physicalplan/plan.md`) to add a
  new "Startup response behavior" subsection and a new bullet under
  "Scope" that explicitly covers initial-response suppression. The plan
  now states that `startAgentSession` gates the unconditional
  `BuildInitialResponseCreateEvent()` send on the resolved turn mode:
  `server_vad` retains today's startup sequence (preserving the existing
  CLI behavior), and `manual` emits only `session.update` plus the two
  startup conversation items with no trailing `response.create`. The
  validation section adds two regression tests — one asserting that the
  default `server_vad` startup still emits the trailing
  `response.create`, and one asserting that the manual-mode startup
  sequence does not.

  Slice 0003
  (`slices/0003_vscode_extension_scaffold/physicalplan/plan.md`) was
  updated in the manual-mode session-start steps to call out explicitly
  that the extension does not request a response on startup; the first
  model response is triggered only when the user presses F19 (or the
  chat-pane Commit/Respond button). The slice 0003 validation list now
  includes a `SessionController` test that asserts no `response.create`
  is sent during startup, paired with the slice 0001 regression test.

## Response to QP-0002

- issue_id: QP-0002
- outcome: Fixed
- updated_at: 2026-05-23T19:30:00Z
- explanation: |
  Updated slice 0002
  (`slices/0002_response_queue/physicalplan/plan.md`) to take ownership
  of the follow-up `response.create` after each tool output. Renamed
  the slice to "Response Queue and Tool Follow-up Responses", added the
  follow-up policy to the objective and scope, and added a full design
  subsection "Tool-call interaction and follow-up responses" that
  replaces the earlier (incorrect) claim that the server would
  implicitly continue.

  Specifically:
  - `ToolDispatcherOptions` gains
    `responseAfterOutput?: "never" | "always"` defaulting to `"never"`
    so the existing CLI and tests are unaffected.
  - `AgentStartConfig.responseAfterToolOutput?: boolean` is forwarded
    by `startAgentSession` to the dispatcher.
  - When `"always"`, the dispatcher emits one queued
    `response.create` after every tool output (success or structured
    error — `tool_not_found`, `invalid_arguments`, `callback_failed`).
    The follow-up is routed through the new response queue with
    `queuePolicy: "enqueue"`, so it never overlaps an active response
    and FIFO is preserved across rapid tool calls.
  - `ToolDispatcherSendContext` gains an `enqueueResponseCreate()`
    method backed by the session's queue, so the dispatcher does not
    learn about queue internals.

  The slice 0002 validation list now includes five tool-follow-up
  tests covering default-off behavior, default-on success, each error
  payload variant, and rapid-call FIFO ordering.

  Slice 0003
  (`slices/0003_vscode_extension_scaffold/physicalplan/plan.md`) was
  updated to set `responseAfterToolOutput: true` in the extension's
  `AgentStartConfig`, with a comment explaining why.

  Slice 0004
  (`slices/0004_navigation_and_reading_tools/physicalplan/plan.md`)
  notes the wiring inherited from slice 0003 and adds an integration
  test asserting that a successful tool call and a structured tool
  error each emit `function_call_output` followed by a queued
  `response.create`. This guards the QP-0002 contract end-to-end.

## Response to QP-0003

- issue_id: QP-0003
- outcome: Fixed
- updated_at: 2026-05-23T19:30:00Z
- explanation: |
  Updated slice 0006
  (`slices/0006_context_freshness/physicalplan/plan.md`) to introduce a
  `FreshnessCoordinator` that owns a stable `FreshnessHooks` reference.
  This eliminates the circular dependency between tool-set construction
  (which must happen before `startAgentSession`) and `FreshnessService`
  (which needs the active session).

  Concretely:
  - A new "Coordinator lifecycle and tool-set ordering" subsection
    spells out the runtime order: `activate()` constructs the
    coordinator, `BuildVscodeToolCallSet({ ..., freshness:
    coordinator.hooks })` is called once, and the resulting set is
    cached on `SessionController`. When a session starts, the
    controller instantiates `FreshnessService`, attaches listeners,
    and calls `coordinator.attach(service)`. On session stop, the
    controller calls `coordinator.detach()`, which disposes the
    service and clears state. The coordinator and its hooks survive
    across many sessions.
  - The hooks behavior when no session is active is defined: each
    `markObserved*` is a no-op, and `beginAgentMutation` returns an
    inert handle with a no-op `end()` so callers' try/finally blocks
    still work.
  - The "Lifecycle" subsection is rewritten to describe coordinator
    attach/detach and the listener attach/dispose pairing inside the
    service.
  - The "Key Files / Systems Affected" section adds
    `freshnessCoordinator.ts` and updates the description of
    `extension.ts`, `sessionController.ts`, and `tools/index.ts` to
    reflect the new ordering.
  - The validation section adds `coordinator.test.ts` (pre-attach,
    attached, post-detach, hook-reference stability across cycles)
    and `toolObservationsDuringSession.test.ts` (end-to-end:
    coordinator-built hooks routed through a `code_read` call into a
    real `FreshnessService` produce exactly one push on a subsequent
    non-agent file change).

  Slice 0004
  (`slices/0004_navigation_and_reading_tools/physicalplan/plan.md`)
  was updated so the tools'
  `BuildVscodeToolCallSet({ editorAccess, freshness?: FreshnessHooks })`
  signature accepts an optional `freshness` parameter that defaults to
  a no-op hooks object. Slice 0006 supplies the real
  coordinator-backed hooks. The placeholder `FreshnessHooks` interface
  lives in `tools/types.ts` and is re-exported by slice 0006's
  `freshness/types.ts`, so the tools can be built and unit-tested
  before slice 0006 lands and the extension can supply the real hooks
  once the coordinator exists.

## Response to QP-0004

- issue_id: QP-0004
- outcome: Fixed
- updated_at: 2026-05-23T19:45:00Z
- explanation: |
  Updated slice 0006
  (`slices/0006_context_freshness/physicalplan/plan.md`) so user tab
  switches generate viewport and cursor freshness pushes instead of
  being silently reset.

  Specifically:
  - `ViewportFreshnessState` and `CursorFreshnessState` gain an
    `everObserved: boolean` flag (default `false`, flips `true` on the
    first `markViewportObserved` / `markCursorObserved`). This
    distinguishes "agent has never asked" from "agent did ask, state
    now stale", which is the discrimination needed for tab switches.
  - The old "State storage" paragraph that said active-editor changes
    silently reset both flags is rewritten; the new wording defers
    push decisions to a new "Active-editor changes (tab switches)"
    subsection.
  - The new "Active-editor changes (tab switches)" subsection defines
    the full handler for `onDidChangeActiveTextEditor`:
    1. If an agent-mutation guard is active, update
       `currentFile` references silently — this covers
       `set_cursor_position` opening a new file.
    2. Otherwise, update `currentFile` to the new editor's file, and
       for each of viewport and cursor that has `everObserved`,
       set `changedSinceLastCheck = true` and run the usual
       `maybeNotify*` gating. `payload.file` carries the **new active
       file path** so the agent learns which file is now visible.
    3. When the new editor is `undefined` (all tabs closed),
       `payload.file` falls back to the previously observed file so
       the agent learns its last-known viewport file is no longer
       visible.
    4. The existing `notificationSent` gating prevents duplicate
       pushes from subsequent tab switches; re-observation reopens
       the gate.
  - The "Notification gating" section updated to flip `everObserved
    = true` inside `markObserved*`.
  - "Change-event filtering" cross-references the new subsection
    instead of restating the (now incorrect) reset behavior, and
    explicitly notes that visible-range and selection listeners are
    ignored while an agent-mutation guard is active.
  - Cursor freshness behavior on active-editor changes is symmetric
    with viewport (the spec ties cursor staleness to non-agent action
    too).
  - File freshness (`FileFreshnessState`) is explicitly unaffected by
    tab switches because contents do not change on switch.
  - A new `tabSwitch.test.ts` covers pre-observation no-push,
    post-observation single push (viewport + cursor) with
    `payload.file` set to the new file, duplicate suppression across a
    second tab switch, re-observation reopening the gate,
    agent-originated tab-switch suppression via the mutation guard,
    and the all-tabs-closed payload fallback.
