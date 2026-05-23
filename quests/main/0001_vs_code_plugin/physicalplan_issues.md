# Issues

## Issue QP-0001

- status: completed
- owner_role: physical_plan_reviewer
- created_at: 2026-05-23T19:16:55Z
- updated_at: 2026-05-23T19:23:03Z
- title: Manual-mode sessions still auto-create an initial response
- details: Slice 0001 adds `turnMode` handling but does not plan any change to the existing `startAgentSession` startup sequence, which currently sends `session.update`, startup conversation items, and then an unconditional `response.create`. Slice 0003 starts the VS Code extension session in manual mode and does not list an explicit startup response request, so the current plan would make the model start responding as soon as the extension starts. That conflicts with the explicit-turn behavior in Spec 01 and Spec 03, where manual mode gives the extension control over when audio is committed and when `commitAudioAndCreateResponse()` requests a response. It also makes the response queue active immediately on session launch, which can change F19 behavior before the user has committed any audio.

  To resolve this, the physical plan must explicitly define startup response behavior for manual-mode sessions. The accepted plan needs either to suppress the unconditional initial `response.create` when `turnMode.type === "manual"` or introduce a clearly scoped configuration option whose default preserves existing server-VAD behavior while the VS Code extension opts out. The relevant slice must include tests showing that default server-VAD startup behavior is preserved and manual-mode extension startup does not auto-request a model response.
- resolution_notes: Verified in the updated slice plans. Slice 0001 now explicitly gates the startup `response.create` on resolved turn mode, preserving it for default `server_vad` and omitting it for `manual`, with regression tests for both paths. Slice 0003 now states the VS Code extension does not request a response on startup and relies on F19 or the chat-pane Commit/Respond action for the first model response.

## Issue QP-0002

- status: completed
- owner_role: physical_plan_reviewer
- created_at: 2026-05-23T19:16:55Z
- updated_at: 2026-05-23T19:23:03Z
- title: Tool outputs do not request the required follow-up response
- details: Spec 02 says that when the model calls a VS Code tool, the extension should send the `function_call_output` result and then request another model response so the model can continue, call another tool, or answer the user. The physical plan does not implement this behavior. Slice 0002 states that tool dispatch already sends `conversation.item.create` and that the server will implicitly continue from tool output without calling `response.create`; the current realtime-agent dispatcher only sends `function_call_output`. Slice 0004 then registers the navigation tools but does not add any follow-up response request after tool results.

  This is a functional gap: voice-driven read/navigation tool calls can stall after the first tool output because no slice owns the follow-up `response.create`. To resolve this, the plan must assign ownership for requesting the follow-up response after each tool output, most likely in realtime-agent `ToolDispatcher` or a narrowly scoped tool-response policy used by the VS Code extension. The updated plan must describe how this interacts with the response queue from slice 0002 and include tests proving that successful tool outputs and structured tool errors both send `function_call_output` followed by a queued or immediate `response.create` as appropriate.
- resolution_notes: Verified in the updated slice plans. Slice 0002 now owns tool follow-up responses via `responseAfterOutput` / `AgentStartConfig.responseAfterToolOutput`, routes the follow-up `response.create` through the response queue, and covers success plus structured error outputs in validation. Slice 0003 enables the option for the VS Code extension, and slice 0004 adds an integration test for output plus follow-up response.

## Issue QP-0003

- status: completed
- owner_role: physical_plan_reviewer
- created_at: 2026-05-23T19:16:55Z
- updated_at: 2026-05-23T19:23:03Z
- title: Freshness hooks have a session-start ordering contradiction
- details: Slice 0006 says `FreshnessService` is instantiated after a session starts because it needs the active `RealtimeAgentSession`, and it also says `BuildVscodeToolCallSet` gains a `freshness` dependency so tools can call `markObserved*` and `beginAgentMutation()`. However, the tool call set must be built and passed into `startAgentSession` before the session exists, because tools are part of the session configuration sent during startup. The plan therefore leaves an unresolved circular dependency: the service needs the session before it exists, while the tools need freshness hooks before the service is created.

  This will cause implementation churn around `SessionController`, tool construction, or service lifecycle. To resolve it, the physical plan must introduce an executable ordering strategy, such as a stable `FreshnessHooks` proxy owned before session start that delegates to the currently active service, or a controller-owned freshness coordinator that can provide hooks to `BuildVscodeToolCallSet` before `startAgentSession` and attach the active session later. The updated plan must state when listeners attach/detach, how hooks behave when no session is active, and how tests cover tool observations during an active session.
- resolution_notes: Verified in the updated slice plans. Slice 0006 now introduces a stable `FreshnessCoordinator` and `FreshnessHooks` proxy that can be handed to `BuildVscodeToolCallSet` before session startup, then attached to a per-session `FreshnessService` after `startAgentSession` resolves. The plan defines no-op behavior before attach and after detach, listener lifecycle, and coordinator/tool-observation validation.

## Issue QP-0004

- status: completed
- owner_role: physical_plan_reviewer
- created_at: 2026-05-23T19:23:03Z
- updated_at: 2026-05-23T19:25:43Z
- title: Tab switches are incorrectly reset instead of notified as viewport changes
- details: Slice 0006 conflicts with Spec 03's viewport freshness behavior. The spec says that when the visible viewport changes due to user scrolling, editor reveal, **tab switch**, or another non-agent action, the extension must set `changedSinceLastCheck` and send one structured-context notification when `notificationSent` is false. The current physical plan says `onDidChangeActiveTextEditor` treats the new file as unobserved, resets viewport and cursor state, and does not push notifications. That means a user tab switch after the agent last checked visible-range context will be silently discarded rather than reported as `viewport_changed_since_last_check`.

  This is a functional gap because the agent can retain stale assumptions about which file/range is visible after a tab switch, exactly the case the spec calls out. To resolve this, the physical plan must define active-editor changes as non-agent viewport changes when the agent has previously observed viewport context, unless the change is covered by an agent-mutation guard. The updated plan should state what file is included in the structured-context payload for a tab switch, how cursor freshness is handled on active-editor changes, and include validation that a user-driven tab switch after `read_visible_range` produces one viewport freshness push without duplicate notifications.
- resolution_notes: Verified in the updated slice 0006 plan. The freshness state now tracks `everObserved` for viewport and cursor, treats user-driven active-editor changes/tab switches as stale viewport and cursor transitions after observation, preserves agent-originated tab-switch suppression through the mutation guard, defines payload-file behavior, and adds `tabSwitch.test.ts` coverage for pre-observation, post-observation, duplicate suppression, re-observation, agent-originated suppression, and no-active-editor cases.
