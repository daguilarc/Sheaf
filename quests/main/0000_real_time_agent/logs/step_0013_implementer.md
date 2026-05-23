# step 13 — implementer

**thread:** sheaf_quest_0000_slice_0004_implementer

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
- Current slice: 0004_tool_dispatch_agent_loop
- Current slice directory: /Users/joyo/Sheaf/quests/main/0000_real_time_agent/slices/0004_tool_dispatch_agent_loop
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
Implement the plan described in `0004_tool_dispatch_agent_loop/physicalplan/`. Keep working until the full plan is complete. When the full plan is complete, create `implementation_done.md` in this slice with a brief completion summary.The user wants me to act as an implementer for a quest slice.Implementing slice 0004 per the physical plan. Reading the plan and exploring the codebase.
I will examine the physical plan and review the quest specifications and existing implementation from prior slices.I need to read more files: realtime_client.ts and event_router.I need to examine existing tests to identify patterns, particularly focusing on realtime client tests and event router tests.I need to verify if there are any existing implementation drafts in the logs or other slices.I need to implement tooling.ts with ToolRegistry, ToolDispatcher, and tool result event construction.I have formed a clear understanding and will now proceed to design the implementation plan.

The implementation plan involves creating a `ToolRegistry` with methods to manage tools, including validation for unique names and conversion to realtime descriptors. A `ToolDispatcher` will handle tool execution through a FIFO queue, processing requests asynchronously and sending appropriate responses or errors based on outcomes.

The implementation plan includes defining interfaces for extracted tool calls, tool errors, and agent session dependencies. It also specifies the structure of `agent_loop.ts` with a `startAgentSession` function that returns a `RealtimeAgentSession` object containing session ID, startup, and audio frame sending capabilities.

The implementation plan includes adding a stop method for graceful shutdown and a getSessionId method. For startup, tool names must be validated before connecting. A session row is created using SessionsRepo.createSession, which internally generates the UUID, so no pre-generated ID is needed. The session configuration is built from buildSessionUpdateEvent, followed by connecting the RealtimeClient and creating the EventRouter.Let me design the startup conversation items.

I'll use standard Realtime API patterns for the startup conversation items.

For the system prompt, I'll send a message with role "system":
```json
{
  "type": "conversation.item.create",
  "item": {
    "type": "message",
    "role": "system",
    "content": [{ "type": "input_text", "text": systemPrompt }]
  }
}
```

For the initial context, I'll send a user message:
```json
{
  "type": "conversation.item.create",
  "item": {
    "type": "message",
    "role": "user",
    "content": [{ "type": "input_text", "text": initialContext }]
  }
}
```

I'll send two separate conversation items for clarity: first a system prompt, then the user's initial context. This approach ensures proper ordering and matches the standard Realtime API patterns. Alternatively, I could combine both into a single user message, but separating them provides better structure and aligns with typical implementation practices.

I'll send the system prompt and initial context as separate conversation items to maintain proper order. First, a system message with the system prompt, followed by a user message with the initial context. This ensures the correct startup sequence and satisfies validation requirements.

The system message will contain the system prompt, and the user message will contain the initial context, maintaining the required order for unit test validation.

I'll track outgoing events in tests, logging default conversation callbacks to stdout.

For tool call extraction, I'll accumulate `response.function_call_arguments.delta` by `call_id` and finalize on `response.function_call_arguments.done`. On `response.done`, I'll process function call items in the output.

From the OpenAI Realtime API, function call deltas include `call_id`, `name`, and partial JSON `delta` data. The `response.done` output contains completed function call items.

I'll implement tool call extraction logic in the agent loop using a function call accumulator to gather deltas by call ID and finalize arguments on completion.

The accumulator will track function call arguments by call ID, handling delta events and finalizing when the full arguments are received. This approach handles partial JSON arguments from the Realtime API and ensures proper function call processing.

Accumulate deltas into arguments and set the name if present in the event. For `response.done`, process completed function call items by dispatching each `function_call` item to the `ToolDispatcher`. Handle cases where arguments may be incomplete by waiting for the full payload in `response.done`, ensuring proper extraction of function calls from both delta events and completed payloads.

On `response.done`, dispatch function calls with full arguments, and on `function_call_arguments.done`, dispatch if arguments are complete. Function call arguments are typically streamed via deltas and finalized with `.done` events. Accumulate `response.function_call_arguments.delta` by `call_id`, then extract and dispatch on `response.function_call_arguments.done` or `response.done`. Deduplicate entries with the same `call_id` that appear in both `response.done` and `function_call_arguments.done`.

Use a Set to track dispatched tool call IDs to avoid duplicates.

Tool results are sent as `function_call_output` items with a JSON string output. Errors are formatted as JSON strings with an error object containing a message and code.

Agent session dependencies include API key, optional safety identifier, base URL, database, and WebSocket factory.

For testing purposes, inject the database and webSocketFactory dependencies.

The `startAgentSession` function initializes and returns a `RealtimeAgentSession` instance, which connects immediately upon creation. The session handle provides methods to send audio frames, stop the session, and retrieve the session row.

The session object includes a `start()` method that can be called if not auto-started, and it manages the underlying WebSocket connection and real-time communication with the agent. It also supports stopping the session and retrieving session metadata.

The session maintains state and handles audio frame transmission through the `sendAudioFrame` method, while `stop` allows graceful termination with a reason. The `getSession` method retrieves the current session row if available.

- Use `m_ended` flag to prevent double ending and `m_abortController` for cancellation.
- On unexpected client close, end session with `connection_lost` unless already gracefully stopped.
- On stop, close client and end session with provided reason.
- Graceful stops should not be treated as `connection_lost`.

For tool dispatching, the `ToolDispatcher` uses a queue to manage calls. When a call is enqueued, it notifies of a queued lifecycle event and adds the call to the queue. The dispatcher processes the queue asynchronously, ensuring only one call runs at a time. It pumps queued calls until the queue is empty, managing execution sequentially.

The tool dispatcher executes calls sequentially from a queue, notifying lifecycle events and handling success or failure with appropriate outputs. Each tool call involves parsing arguments, resolving the tool, and executing its callback.

To prevent duplicates, tool names are validated to ensure uniqueness within the tool call set. A `DuplicateToolNameError` is thrown if any duplicate names are detected during validation.

If a tool name is duplicated, a `DuplicateToolNameError` is thrown during registry construction. 

The following types are added: `ExtractedToolCall` for tool call data, `ToolDispatchErrorPayload` for error details, `AgentSessionDeps` for session dependencies, and `RealtimeAgentSession` for session management.

The `sendAudioFrame` method accepts PCM data as either a base64 string or buffer, while `stop` terminates the session gracefully with a reason. A `SessionEndReason` type defines possible end states including connection loss.

Default callbacks log event types and session IDs. The `buildFunctionCallOutputEvent` helper is added to construct tool output events.

Buffers passed to `sendAudioFrame` are converted to base64 format for transmission.

Comprehensive tests cover duplicate tool name detection before session initiation and validate correct startup sequencing.

Track session operations including database storage, connection, updates, and event creation. Test session metadata fields and FIFO tool execution order with delayed callbacks. Verify event persistence and routing while tools are pending, and ensure successful tool execution emits correct outputs. Handle missing tools, malformed arguments, and callback errors appropriately. Manage unexpected socket closures by ending sessions with connection_lost status.

### Test: stop("operator_shutdown") -> ended_at and reason

Testing the stop functionality with reason "operator_shutdown" requires exposing internal hooks or using fake WebSocket and event lists. To test startup order:

1. Create a fake WebSocket that delays opening until explicitly triggered.
2. Initiate the session, which should create a database row before attempting to connect.
3. Verify the database entry exists before the socket opens.
4. After connection, confirm the sequence of sent messages.

Implement `startAgentSession` as an async function that returns only after full initialization.

For duplicate name validation, initiate `startAgentSession` and expect a rejection, ensuring the socket array remains empty.

Files will be implemented using TypeScript conventions with camelCase. Helper functions for extracting tool calls will remain in agent_loop.ts to avoid unnecessary changes to event_router. The default conversation callback logs event types with session IDs and directions.

Only the default conversation callback should be invoked for non-tool model output events when no caller-provided callback is given. The EventRouter already calls `onConversationEvent` for all events. In `agent_loop`, `onConversationEvent` should be set to a wrapper that uses a user-provided callback if available, or a default logger for non-tool events. This filtering can be done using `classifyIncomingEvent`.Implementing `tooling.ts`, `agent_loop.ts`, types, tests, and exports.
I used a hack to access the private `SendOutgoing` method by casting it to a key of `RealtimeAgentSessionImpl`.Refactoring startup sequencing to avoid private-method hacks.
Update types.ts with additional exports, index.ts, and package.I need to fix the index export to match the actual type name ToolErrorPayload instead of ToolDispatchErrorPayload.Now write the main agent_loop.test.ts with all the integration tests.

The start flow requires fixing because `connect()` is asynchronous and the socket must be opened afterward. Tests need to open the socket after `connect()` starts. The pattern from client tests shows calling `client.connect()`, opening the socket, then awaiting the connect promise. For `startAgentSession`, the code should first call `startAgentSession(config, deps)`, then open the socket from `context.sockets[0]`, and finally await the session. The duplicate names test should fail before connection, so sockets should remain empty.

For startup order, tests should verify: 1) Session exists in DB before socket messages are sent, 2) After full start: first message is session.update, then conversation items, then response.create, and 3) Session row has correct metadata.

For "session row persisted before connect," we can delay socket open and check DB has session while connect is pending.

```ts
test("startup order persists session before connecting", async () => {
  const ctx = CreateAgentLoopTestContext();
  try {
    const startPromise = startAgentSession(BuildTestAgentConfig(), ctx.deps);
```

Tests should verify that the session is persisted in the database before the socket connects. This can be done by delaying the socket opening and confirming the database has the session row while the connection is still pending. Since the session ID is not available until the session completes, alternatives include listing sessions from the database or checking that the socket has not yet opened.getConnection() can be used for raw queries in tests.I need to fix the session metadata test that incorrectly calls startAgentSession twice.

The session metadata test was incorrectly calling startAgentSession twice, but the current implementation properly handles this by awaiting startAgentSessionAfterConnect which manages the socket connection and promise correctly. The unused OpenDatabaseAtPath import should be removed from helpers.

Run build and test to identify errors. Fix the "session metadata" test, ensuring the model "gpt-realtime-2" matches DEFAULT correctly. For DuplicateToolNameError, startAgentSession throws at ToolRegistry.FromToolCallSet before database operations, which is the correct order. The registry creation happens first in startAgentSession, confirming the error occurs before database initialization.Fix buildToolErrorPayload to exclude details when undefined, or update the failing test accordingly.All 43 tests pass. Implementation is complete, and the physical plan checklist has been verified.

The physical plan checklist confirms all items are complete, with tooling.ts, agent_loop.ts, and event_router extension verified. The plan to extend types.ts with agent runtime, tool lifecycle, and shutdown result types is partially implemented, as tool lifecycle was already present. Adding AgentSessionDeps, RealtimeAgentSession, and SessionStopResult to types.ts is optional for cleanliness but not required for test success.

Minimal types are added to types.ts and re-exported from agent_loop for consistency. Interfaces are moved to types.ts with imports in agent_loop, and DuplicateToolNameError is exported from tooling in index. A test for FIFO is added at the agent_loop level, complementing existing tooling and lifecycle tests. Implementation_done.md is created.Moving session types into `types.ts` per the physical plan.
Remove the unused RealtimeAgentDb import from agent_loop since it is still needed for the deps.database check.Slice **0004_tool_dispatch_agent_loop** is implemented. Summary:

## Delivered

**`tooling.ts`**
- `ToolRegistry` — unique tool names, resolve by name, Realtime tool descriptors
- `ToolDispatcher` — FIFO serial queue, lifecycle callbacks (`queued` → `started` → `succeeded`/`failed`)
- `buildFunctionCallOutputEvent` / `buildToolErrorPayload` — structured `function_call_output` events

**`agent_loop.ts`**
- `startAgentSession(config, deps)` — full startup: persist session → connect → `session.update` → system/user conversation items → `response.create`
- Tool calls from `response.function_call_arguments.*` (with delta accumulation) and `response.done` function-call items
- `sendAudioFrame` — `input_audio_buffer.append` (not persisted)
- `stop(reason)` — graceful shutdown; unexpected close → `ended_reason = "connection_lost"`
- Default conversation logging when `onConversationEvent` is omitted (skips tool-call events)

**Tests** — 18 new tests in `test/tooling/` and `test/agent_loop/`; **43 total passing**

**Exports** — `startAgentSession`, `RealtimeAgentSession`, `ToolRegistry`, `ToolDispatcher`, and related types from `src/index.ts`

`implementation_done.md` is in the slice directory. Slice **0005** can build the CLI on `startAgentSession`.

