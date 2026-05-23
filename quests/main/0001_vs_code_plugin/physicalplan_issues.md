# Issues

## Issue QP-0001

- status: open
- owner_role: physical_plan_reviewer
- created_at: 2026-05-23T19:16:55Z
- updated_at: 2026-05-23T19:16:55Z
- title: Manual-mode sessions still auto-create an initial response
- details: Slice 0001 adds `turnMode` handling but does not plan any change to the existing `startAgentSession` startup sequence, which currently sends `session.update`, startup conversation items, and then an unconditional `response.create`. Slice 0003 starts the VS Code extension session in manual mode and does not list an explicit startup response request, so the current plan would make the model start responding as soon as the extension starts. That conflicts with the explicit-turn behavior in Spec 01 and Spec 03, where manual mode gives the extension control over when audio is committed and when `commitAudioAndCreateResponse()` requests a response. It also makes the response queue active immediately on session launch, which can change F19 behavior before the user has committed any audio.

  To resolve this, the physical plan must explicitly define startup response behavior for manual-mode sessions. The accepted plan needs either to suppress the unconditional initial `response.create` when `turnMode.type === "manual"` or introduce a clearly scoped configuration option whose default preserves existing server-VAD behavior while the VS Code extension opts out. The relevant slice must include tests showing that default server-VAD startup behavior is preserved and manual-mode extension startup does not auto-request a model response.
- resolution_notes: none

## Issue QP-0002

- status: open
- owner_role: physical_plan_reviewer
- created_at: 2026-05-23T19:16:55Z
- updated_at: 2026-05-23T19:16:55Z
- title: Tool outputs do not request the required follow-up response
- details: Spec 02 says that when the model calls a VS Code tool, the extension should send the `function_call_output` result and then request another model response so the model can continue, call another tool, or answer the user. The physical plan does not implement this behavior. Slice 0002 states that tool dispatch already sends `conversation.item.create` and that the server will implicitly continue from tool output without calling `response.create`; the current realtime-agent dispatcher only sends `function_call_output`. Slice 0004 then registers the navigation tools but does not add any follow-up response request after tool results.

  This is a functional gap: voice-driven read/navigation tool calls can stall after the first tool output because no slice owns the follow-up `response.create`. To resolve this, the plan must assign ownership for requesting the follow-up response after each tool output, most likely in realtime-agent `ToolDispatcher` or a narrowly scoped tool-response policy used by the VS Code extension. The updated plan must describe how this interacts with the response queue from slice 0002 and include tests proving that successful tool outputs and structured tool errors both send `function_call_output` followed by a queued or immediate `response.create` as appropriate.
- resolution_notes: none

## Issue QP-0003

- status: open
- owner_role: physical_plan_reviewer
- created_at: 2026-05-23T19:16:55Z
- updated_at: 2026-05-23T19:16:55Z
- title: Freshness hooks have a session-start ordering contradiction
- details: Slice 0006 says `FreshnessService` is instantiated after a session starts because it needs the active `RealtimeAgentSession`, and it also says `BuildVscodeToolCallSet` gains a `freshness` dependency so tools can call `markObserved*` and `beginAgentMutation()`. However, the tool call set must be built and passed into `startAgentSession` before the session exists, because tools are part of the session configuration sent during startup. The plan therefore leaves an unresolved circular dependency: the service needs the session before it exists, while the tools need freshness hooks before the service is created.

  This will cause implementation churn around `SessionController`, tool construction, or service lifecycle. To resolve it, the physical plan must introduce an executable ordering strategy, such as a stable `FreshnessHooks` proxy owned before session start that delegates to the currently active service, or a controller-owned freshness coordinator that can provide hooks to `BuildVscodeToolCallSet` before `startAgentSession` and attach the active session later. The updated plan must state when listeners attach/detach, how hooks behave when no session is active, and how tests cover tool observations during an active session.
- resolution_notes: none
