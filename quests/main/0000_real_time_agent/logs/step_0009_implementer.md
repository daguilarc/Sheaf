# step 9 — implementer

**thread:** sheaf_quest_0000_slice_0003_implementer

## output

# Implementer Role

You are the implementer for the current quest slice. Your job is to execute the
slice physical plan and deliver working code for that slice.

## Primary Responsibilities

- Implement the current slice according to `slices/<slice>/physicalplan/*.md`.
- Use existing APIs and patterns where appropriate.
- Keep changes clean, maintainable, and idiomatic for this repository.
- Ensure the slice is fully implemented before signaling completion.

## Implementation Expectations

- Follow the spec and physical plan as written.
- Keep scope limited to the current slice unless an explicit prerequisite is required.
- Add/update tests and validations needed to support the slice.
- Run relevant tests for the slice changes before signaling completion.
- Avoid unnecessary duplication and avoid over-generalizing abstractions.
- Remove obsolete code tied to replaced behavior unless otherwise specified.

## Completion Protocol

- Continue implementing until the full current slice plan is complete.
- When prompted:
  - If the full slice plan is complete, create `implementation_done.md` in the
    current slice directory with a brief completion summary.
  - If the slice is not fully complete, continue implementation work and do not
    create `implementation_done.md`.

## Escalation Rules

- If the physical plan cannot be completed without changing the spec, making major
  unspecified decisions, or resolving ambiguous requirements, create/update quest-root
  `human_intervention_request.md` with rationale and exit.
- If there is a critical blocker requiring human input, create/update quest-root
  `human_intervention_request.md` with clear details and exit.

## Scope Limits

- Do not modify `physicalplan_issues.md`.
- Do not mark reviewer-owned issues as `completed`.
- Do not edit role files.
- Focus on implementation artifacts for the current slice; use
  `human_intervention_request.md` only for escalation.


---

Quest Runtime Context
- Quest: main/0000_real_time_agent (Real Time Agent)
- Quest directory: /Users/joyo/Sheaf/quests/main/0000_real_time_agent
- Role: implementer
- Current slice: 0003_realtime_transport_events
- Current slice directory: /Users/joyo/Sheaf/quests/main/0000_real_time_agent/slices/0003_realtime_transport_events
- Quest documentation directory: /Users/joyo/conductor/docs/quest

Use the quest's `specs/` directory as the implementation specification for this quest. Use the quest documentation directory above as the stable reference for quest schemas, file formats, and workflow rules.

Quest Schemas Reference (`schemas.md`)
```markdown
# Quest Schemas

This document describes the quest runtime files Conductor reads and writes now.
Where older quests still use legacy formats, the compatibility rules are called
out explicitly.

## Quest State File

Path:

```text
<quest_dir>/state.md
```

Canonical format for active v2 quests:

```markdown
# State

- global_step: 18
- machine_name: quest
- machine_path: quests/main/0002_state_machine_abstraction
- state: ExecuteSlice
- updated_at: 2026-04-01T12:00:00Z

## Tags

- active_slice: 0001_example_slice
- quest_number: 2
- quest_slug: state_machine_abstraction
- quest_type: main
```

Rules:

- The first non-empty line is `# State`.
- The state block uses `- key: value` lines.
- Allowed state keys are `global_step`, `machine_name`, `machine_path`, `state`,
  and `updated_at`.
- Quest-root normalized state always uses `machine_name: quest`.
- `global_step` is required for committed v2 top-level quest state and increments
  once per successful top-level runner step commit.
- `machine_path` is repo-relative and points to the quest directory.
- `## Tags` is required, even when empty.
- Tags are string-to-string entries.
- The runner writes `quest_type`, `quest_number`, and `quest_slug` tags.
- During `ExecuteSlice`, `tags.active_slice` is required and must be a slice
  directory name such as `0001_example_slice`.
- Outside `ExecuteSlice` and `PrepareNextSlice`, `active_slice` is omitted.

Compatibility:

- Readers also accept the legacy quest format:

```markdown
# Quest State

state: ExecuteSlice
current_slice: 1
updated_at: 2026-04-01T12:00:00Z
active_slice: 0001_example_slice
global_step: 18
```

- `read_quest_state` auto-detects the format by heading.
- `create_quest` still scaffolds new quests with the legacy `# Quest State`
  layout.
- Once the v2 runner commits a top-level step, it rewrites quest-root `state.md`
  in normalized form.

Supported quest filesystem states:

- `PrePlanning`
- `PhysicalPlanning`
- `ReviewPhysicalPlan`
- `ExecuteSlice`
- `QuestDocumenting`
- `Completed`

The quest machine also uses `PrepareNextSlice` internally, but that logical node
does not persist as a distinct quest filesystem state.

## Slice State File

Path:

```text
<slice_dir>/state.md
```

Format:

```markdown
# Slice State

state: NotStarted|Implementing|PolishingReview|PolishingFix|Done
updated_at: <ISO-8601 UTC timestamp>
```

Rules:

- Slice state files remain in the legacy key/value format.
- The first non-empty line is `# Slice State`.
- The runner persists only the filesystem states above.
- The recursive slice machine also uses logical nodes such as `SliceSetup` and
  `Completed`, but those map onto the persisted slice states rather than changing
  the file schema.

## Step Commit Metadata

Each successful top-level runner step for the canonical v2 runner creates one git
commit whose message carries recursive state-machine metadata.

Commit message shape:

```text
quest-step: 18
state-machine-path: quests/main/0002_state_machine_abstraction
node: ExecuteActiveSliceNode
state-before: ExecuteSlice
state-after: ExecuteSlice

recursive-snapshot-json:
{
  "global_step": 18,
  "snapshot": {
    "child": {
      "child": null,
      "machine_name": "slice",
      "machine_path": "quests/main/0002_state_machine_abstraction/slices/0001_example_slice",
      "node_name": "SliceImplementingNode",
      "role": "implementer",
      "state_after": "Implementing",
      "state_before": "Implementing",
      "tags": {},
      "thread_name": "repo_quest_0002_slice_0001_implementer"
    },
    "machine_name": "quest",
    "machine_path": "quests/main/0002_state_machine_abstraction",
    "node_name": "ExecuteActiveSliceNode",
    "state_after": "ExecuteSlice",
    "state_before": "ExecuteSlice",
    "tags": {
      "active_slice": "0001_example_slice",
      "quest_number": "2",
      "quest_slug": "state_machine_abstraction",
      "quest_type": "main"
    }
  }
}
```

Rules:

- `quest-step` must equal JSON `global_step`.
- Header `state-machine-path`, `node`, `state-before`, and `state-after` must match
  the root JSON snapshot.
- The JSON payload must be pretty-printed multi-line JSON after the
  `recursive-snapshot-json:` marker.
- `snapshot.child` recursively represents nested machine execution for a slice step,
  or `null` for a quest-only step.
- `role` and `thread_name` appear when the step executed an agent-backed node.
- If metadata validation fails, the runner writes
  `logs/commit_metadata_validation_*.md`, creates
  `human_intervention_request.md`, and does not commit the step.
- On a noop top-level step with no filesystem changes, the runner skips the commit
  and does not increment `global_step`.

Compatibility:

- Older quests may still rely on `state_history.md` and older transition commit
  titles.
- Dashboard history readers merge commit metadata with `state_history.md` and prefer
  metadata when the same commit appears in both sources.

## Issue Response Files

Responder-written records of how open reviewer issues were handled. These files are
separate from reviewer-owned issue lists (`physicalplan_issues.md`,
`polishing_issues.md`).

Paths:

```text
<quest_dir>/physicalplan_issue_responses.md
<slice_dir>/polishing_issue_responses.md
```

Write authority:

- `physicalplan_issue_responses.md`: `physical_planner` only.
- `polishing_issue_responses.md`: `polisher` only for the current slice.

Read authority:

- `physical_plan_reviewer` must read `physicalplan_issue_responses.md` when
  verifying open physical plan issues.
- `polisher_reviewer` must read `polishing_issue_responses.md` when verifying open
  polishing issues.

Reviewers must not create, edit, or delete entries in either responses file.

Full normative schema: [`schemas/issue-responses.md`](schemas/issue-responses.md).

## Issue Files

Paths:

```text
<quest_dir>/physicalplan_issues.md
<slice_dir>/polishing_issues.md
```

Format:

```markdown
# Issues

## Issue QP-0001

- status: open|completed
- owner_role: physical_plan_reviewer|polisher_reviewer
- created_at: <ISO-8601 UTC timestamp>
- updated_at: <ISO-8601 UTC timestamp>
- title: <short title>
- details: <markdown text>
- resolution_notes: <markdown text or none>
```

Rules:

- `status` may only be `open` or `completed`.
- Reviewer roles are the only roles allowed to mark issues `completed`.
- `details` and `resolution_notes` may span multiple lines.
- `resolution_notes: none` means the field is unset.

## State History Files

Paths:

```text
<quest_dir>/state_history.md
<slice_dir>/state_history.md
```

Format:

```markdown
# State Transition History

## 2026-03-29T00:00:00Z

- previous_state: <state name>
- next_state: <state name>
- commit: <git commit hash>
- thread_name: <thread name or none>
- notes: <short summary>
```

Current behavior:

- `create_quest` still scaffolds quest-root `state_history.md`.
- Slice scaffolding still creates slice `state_history.md`.
- The canonical v2 runner does not append new transition rows for top-level step
  history.
- Older quests and older runner paths may still contain authoritative history rows,
  and dashboard readers continue to support them.

## Thread Registry

Path:

```text
<quest_dir>/thread_registry.json
```

Format:

```json
{
  "implementer": {
    "thread_name": "myrepo_quest_0002_slice_0001_implementer",
    "harness_kind": "cursor",
    "provider_thread_id": "provider-thread-id",
    "pass_id": 0,
    "round_count": 3,
    "created_at": "2026-03-29T00:00:00Z",
    "last_used_at": "2026-03-29T00:00:00Z"
  }
}
```

Current naming:

- Quest-scoped v2 roles use `<repo>_quest_<quest_number:04d>_<role>`.
- Slice-scoped v2 roles use
  `<repo>_quest_<quest_number:04d>_slice_<slice_number:04d>_<role>`.
- Older threads may still use the legacy slug-based pattern
  `<repo>_quest_<quest_slug>_<role>_0`.

## Execution Config

Path:

```text
<quest_dir>/state_execution_config.yaml
```

Shape:

```yaml
version: 2
harnesses:
  claude_code:
    cli_path: /path/to/claude
profiles:
  implementer:
    harness: cursor
    model: composer-2
    reasoning_effort: high
    idle_timeout_seconds: 3600
    modify_allow:
      - "$currentQuest/human_intervention_request.md"
      - "$currentSlice/implementation_done.md"
      - "$currentSlice/notes/**"
    modify_block:
      - "**"
```

Rules:

- `profiles` keys are role names.
- Allowed harness values are `codex`, `cursor`, and `claude_code`.
- `reasoning_effort` is optional. When present, it must be a string.
- `version: 2` adds optional per-profile `modify_allow` and `modify_block`
  repo-root-relative glob lists.
- `modify_allow` may use only `$currentQuest` and `$currentSlice`.
- `modify_block` must not contain `$` placeholders.
- When both lists match the same path, allow wins.
- The runner refuses to invoke a harness when the target repository working tree is
  not fully clean, including untracked files.
- After each harness turn, the runner compares the repository to the pre-turn
  snapshot, reverts changes outside the role's allowed paths, records those reverts
  in the step log, and sends a follow-up in the same thread telling the agent to
  continue within its allowed paths.
- `version: 1` configs keep legacy behavior: no path-rule enforcement and empty
  parsed allow/block lists.

## Human Intervention Request

Path:

```text
<quest_dir>/human_intervention_request.md
```

Minimum content:

```markdown
# Human intervention requested

**Reason:** <short reason>

<details>
```

Presence of this file blocks further automatic quest progress until a human resolves
the condition.

## Implementer Completion Marker

Path:

```text
<slice_dir>/implementation_done.md
```

Purpose:

- Signals that the implementer believes the full current slice plan is complete.
- The runner advances out of `Implementing` only when this file exists.

## Physical Plan Acceptance Marker

Path:

```text
<quest_dir>/physicalplan_accepted.md
```

Purpose:

- Signals that `physical_plan_reviewer` found no remaining open physical plan issues
  and accepts the quest-level plan review.
- The runner advances out of `ReviewPhysicalPlan` only when this file exists and
  `physicalplan_issues.md` has no open entries.

## Implementation Acceptance Marker

Path:

```text
<slice_dir>/implementation_accepted.md
```

Purpose:

- Signals that `polisher_reviewer` found no remaining open polishing issues and
  accepts the current slice implementation.
- The runner advances the slice to logical completion only when this file exists and
  `polishing_issues.md` has no open entries.
```

Task:
Implement the plan described in `0003_realtime_transport_events/physicalplan/`. Keep working until the full plan is complete. When the full plan is complete, create `implementation_done.md` in this slice with a brief completion summary.The user requests implementation of a quest slice for handling real-time transport events.I'll implement slice `0003_realtime_transport_events` per the physical plan — starting by reading the plan, specs, and existing code patterns.
I need to verify whether a WebSocket package is already present in the project or if I need to add one.No WebSocket package was selected in slice 0001.No WebSocket package has been selected yet.

Since Node 20+ includes a built-in WebSocket API, I can use that instead of adding the `ws` package. This allows for easier testing with an injectable factory while maintaining compatibility with Node's native WebSocket implementation. The physical plan remains: use an injectable WebSocket factory and reuse the selected package's WebSocket client.

Since Node 20 does not have a stable WebSocket API, the `ws` package will be used as it is the standard choice for Node server WebSocket clients and works well with the injectable factory pattern. A minimal WebSocket interface will be defined to ensure compatibility and maintainability.

An interface abstraction can be used with `ws` as the default for real connections and fake implementations for tests, aligning with the existing plan. The session configuration follows the spec with type "realtime", enabled audio/text input/output, transcription, and specific VAD settings.I have a good picture. Let me implement:

I need to implement several files and components for the realtime client functionality. First, I'll create the session configuration and event routing logic, then extend the types and update the main index file. For the WebSocket implementation, I'll use Node's built-in WebSocket if available, otherwise add the ws package. I also need to define an injectable WebSocket interface that matches the required methods like send, close, and readyState access. Finally, I'll write tests to ensure everything works correctly.

For the WebSocket implementation details, I'll check the Node version first to determine whether to use the built-in WebSocket or the external ws package. The interface definition shows it needs to support readyState, send, and close methods with proper typing.

The WebSocket implementation uses either the built-in Node WebSocket (available in Node 22+) or the `ws` package as a fallback. Since Node 20 requires an experimental flag for WebSocket and the project supports engines >=20, the `ws` package is added as a dependency for compatibility across all supported Node versions. A WebSocket factory function is implemented to select the appropriate WebSocket constructor based on the runtime environment.Let me read implementation_done from slice 0002 for style reference and plan the full implementation.

Event classification includes session lifecycle, input audio/turn boundaries, transcription deltas/finals, text output deltas/finals, tool calls, errors, and unknown events. An enum or union type will be created for IncomingEventClass.

The EventRouter requires sessionId, eventsRepo, and callbacks for each event class plus a generic onEvent callback. The routeIncomingEvent function will persist events and invoke appropriate callbacks based on classification. The routeOutgoingEvent function will check persistence requirements, persist if needed, classify events, and invoke callbacks.

The EventRouter handles incoming and outgoing events, while the RealtimeClient manages transport layer operations. The client processes messages and triggers onEvent handlers, which are connected to the router for event routing. For this implementation, both components are built independently, with the client's onEvent handler calling the router's routeIncomingEvent function.

The EventRouter operates as a separate module that handles event routing and persistence, while the RealtimeClient manages transport layer operations. The client connects to a WebSocket and processes messages, triggering onEvent handlers that route events through the EventRouter.

For testing, the RealtimeClient can be tested with a fake WebSocket implementation, and the EventRouter can be tested with persistence enabled. The RealtimeClient requires options including API key, model, and optional safety identifier or base URL, with an optional WebSocket factory for custom implementations. The client connects via a connect() method that establishes the WebSocket connection.

The RealtimeClient includes methods for sending events, handling events and errors, and closing the connection. If the socket is not open when sending an event, an error is reported via onError. Invalid JSON messages result in transport/protocol errors reported via onError to prevent crashes. The default URL uses the base URL with model parameter, defaulting to `wss://api.openai.com/v1/realtime`, and includes required headers with authorization and optional safety identifier.

The WebSocket factory uses the `ws` package to create WebSocket connections with specified headers. For testing purposes, a FakeWebSocket class can be implemented to simulate WebSocket behavior.

The EventRouter is configured with session ID, event repository, and optional callbacks for conversation and general events. It handles event routing and persistence within the realtime client architecture.

The EventRouter includes functions to route incoming and outgoing events, classify events, and handle persistence. It supports typed callback hooks for conversation and agent events, with classification-specific hooks or generic onEvent handlers. The RealtimeClientOptions type is added to support transport options, event callbacks, and session configuration types.

WebSocketFactory is a type for creating WebSocket connections with specified headers.  
IncomingEventClass and OutgoingEventClass are enums or unions representing event types for classification.  
EventRouterConfig defines the configuration for the EventRouter, including session ID, event repository, and optional callbacks.  
EventRouterCallbacks includes optional per-class handlers for routing events, with a generic onEvent callback.  

For session configuration, the buildSessionUpdateEvent function creates a session.update event with specified tool calls and audio settings, including transcription model and input format.

The session configuration includes turn detection settings such as server VAD with silence duration and response creation/interruption flags. Additionally, transcription settings are required, specifically using `audio.input.transcription` with a model as per OpenAI documentation.I'll use the GA session structure from the physical plan.

For the transcription model, I'll use `gpt-4o-mini-transcribe` as a reasonable default since the specification enables transcription without specifying a model. Alternatively, an empty object or minimal configuration could be used.

I'll implement all files using the `ws` package. For classification helpers, I'll define event type patterns including session lifecycle events (session.created, session.updated) and input audio/turn boundary events (input_audio_buffer.speech_started, input_audio_buffer.speech_stopped, input_audio_buffer.committed).

For transcription events, I'll handle `conversation.item.input_audio_transcription.delta` and `conversation.item.input_audio_transcription.completed`. For text output, I'll process `response.output_text.delta` and `response.output_text.done`. Tool calls will be handled through `response.function_call_arguments.delta` and `function_call` in `response.done`, with classification based on prefixes for simplicity. Errors will be handled with the `error` event type, and any unknown events will be categorized accordingly.

For outgoing events, I'll send `session.update` for session configuration changes and `conversation.item.create` for conversation input, excluding function call outputs.

Tool outputs will use `conversation.item.create` with `function_call_output` for complex cases. Response triggers will initiate `response.create`. Audio buffer updates will use `input_audio_buffer.append`. Unknown events will be handled with a fallback classifier.

The EventRouter will support optional handlers per class in `EventRouterConfig`. Package.json test scripts will be updated to include new test directories.

The test script will be updated to include new test directories, using either specific paths or a glob pattern for node --test. Implementation details for RealtimeClient message handling involve parsing incoming WebSocket messages and processing them as RealtimeEvents.

If the event type is missing or not a string, an error is thrown. All registered event handlers are executed for each event, and any errors during handling are caught and reported as RealtimeTransportError instances.

The connect promise resolves when the transport opens successfully and rejects if an error occurs during connection.

The RealtimeTransportError class is created to handle transport-related errors.

Code implementation follows TypeScript conventions, matching existing camelCase usage in the realtime-agent package rather than adopting C++ style naming.Implementing transport, session config, event routing, and tests. Adding the `ws` dependency for WebSocket support.
The realtime_client.ts file contains invalid TypeScript syntax due to incorrect use of semicolons after method signatures within an object literal.

Let me fix the WrapNodeWebSocket function in realtime_client.ts by removing method overload declarations for `on` and `off` within the object literal. I'll also simplify the event router options by using direct imports instead of import() types for EventsRepo.

Additionally, I need to fix the connect() flow by addressing handler attachment conflicts. The socket handlers are being attached both in the connect promise and through AttachSocketHandlers, which may cause issues with the onClose handler in the connect promise.

When connect succeeds, message handlers from AttachSocketHandlers should be preserved, but AttachSocketHandlers is called before open, which is acceptable.

The issue is that on connect rejection, AttachSocketHandlers gets called and remains attached to a failed socket. I need to refactor connect().

Another problem is duplicate close handlers: AttachSocketHandlers sets a close handler that nulls the socket and notifies close handlers, while the connect promise also has an onClose for rejection. After successful connect, if the socket closes, both handlers would fire. However, the connect promise's onClose is cleaned up on open, so that's okay.

Fix WrapNodeWebSocket by removing invalid semicolon syntax in method signatures and using a class-based approach for tests while employing a simple adapter object with proper methods for production use, avoiding overload declarations in object literals.

The `close`, `on`, and `off` methods were defined with invalid semicolon syntax in an object literal, which is not valid TypeScript. These methods have been corrected to properly handle socket events and listeners, ensuring correct behavior for message handling, close events, and general event management. The implementation now correctly routes messages through the socket and manages event listeners appropriately.

The `off` method may not work correctly for message listeners because the wrapped listener differs from the passed listener, though tests might not require `off` for messages. In `connect`, `off` is used for open/error/close with the same listener reference, but for close, the wrapped listener won't match, potentially causing issues with cleanup.

To address this, `connect` will be modified to avoid using `off` on the wrapped close handlerinstead, it will use `once` or store references. For the ws package, `socket.once('open', ...)` and `socket.once('error', ...)` will be used. A flag `let settled = false` will be introduced to manage state instead.Fixing syntax errors in `realtime_client.ts` and updating exports and tests.
Create test helpers for fake WebSocket and implement all tests.

Let me fix index.ts by merging duplicate type exports from types.js into the first export block to avoid redundancy. Then I'll create test files including test/realtime/helpers.ts with FakeWebSocket implementation.Merge duplicate exports in index.ts, then run build and test.All tests pass. I will run `make test-realtime-agent` if it exists at the root and create `implementation_done.md`.Slice `0003_realtime_transport_events` is implemented. Summary:

## Delivered

**Transport (`realtime_client.ts`)**
- `RealtimeClient` with `connect()`, `send()`, `onEvent()` / `onError()` / `onClose()`, and `close()`
- Default URL: `wss://api.openai.com/v1/realtime?model=<model>`
- Headers: `Authorization: Bearer …` and optional `OpenAI-Safety-Identifier`
- Injectable `webSocketFactory` for tests; production uses the `ws` package
- Invalid JSON is reported via `RealtimeTransportError` without crashing

**Session config (`session_config.ts`)**
- `buildSessionUpdateEvent()` builds `session.update` with realtime type, text-only `output_modalities`, 24kHz PCM input, transcription, server VAD (500ms, create/interrupt response), and tools from `ToolCallSet`

**Event routing (`event_router.ts`)**
- `routeIncomingEvent()` / `routeOutgoingEvent()` with persistence via slice 0002 repos
- Classification helpers for known classes plus `unknown` (never rejects unknown `type`)
- Outgoing `input_audio_buffer.append` is not persisted; typed and generic callbacks fire

**Tests** — 25 passing under `test/realtime/` and `test/events/`

`implementation_done.md` is in the slice directory. Later slices can wire `RealtimeClient.onEvent` → `EventRouter.routeIncomingEvent` in the agent loop.

