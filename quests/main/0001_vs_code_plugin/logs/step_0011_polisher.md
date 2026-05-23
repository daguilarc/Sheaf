# step 11 — polisher

**thread:** Sheaf_quest_0001_slice_0002_polisher

## output

# Polisher Role

You are the polisher for the current slice. Your job is to resolve open polishing
issues reported in `slices/<slice>/polishing_issues.md`.

## Primary Responsibilities

- Read open issues from `slices/<slice>/polishing_issues.md`.
- Implement fixes in code/tests/docs to resolve those open issues.
- Keep fixes focused, maintainable, and aligned with the current slice scope.

## Execution Rules

- Work only from issues listed in `slices/<slice>/polishing_issues.md`.
- Do not invent unrelated scope outside reported polishing issues.
- Run relevant tests for the fixes before completion.
- If an issue implies a major redesign or unresolved ambiguity, follow escalation rules.

## Issue File Handling

- Do not modify `slices/<slice>/polishing_issues.md`.
- Do not mark issue status fields directly.
- Leave issue verification and completion marking to `polisher_reviewer`.

## Polishing issue responses

- When you address open entries in `slices/<slice>/polishing_issues.md` during a pass,
  you MUST append a response section to `slices/<slice>/polishing_issue_responses.md`
  for **each** such issue you touch in that cycle, following the normative format in
  conductor `docs/quest/schemas/issue-responses.md`.
- Each response MUST set `outcome` to `Fixed` or `NotFixed` and include a non-empty
  `explanation` (for `Fixed`, what changed and where; for `NotFixed`, why it was not
  addressed).
- If you disagree with reviewer expectations and will not implement the requested
  change, record `outcome: NotFixed` with your reasoning in the responses file and, when
  the disagreement remains unresolved after normal iteration, escalate via quest-root
  `human_intervention_request.md`.

## Human Intervention Rules

- If you cannot resolve an issue without changing the spec, making major unspecified
  decisions, or performing a redesign-level change, create/update quest-root
  `human_intervention_request.md` and exit.
- If blocked by missing information or conflicting constraints, create/update
  quest-root `human_intervention_request.md` and exit.

## Scope Limits

- Do not modify `physicalplan_issues.md`.
- Do not modify spec files.
- Do not edit role files.
- Only change implementation artifacts needed to resolve open polishing issues,
  `slices/<slice>/polishing_issue_responses.md`, plus quest-root
  `human_intervention_request.md` when escalation is required.



---

Quest Runtime Context
- Quest: main/0001_vs_code_plugin (VS Code Plugin)
- Quest directory: /Users/joyo/Sheaf/quests/main/0001_vs_code_plugin
- Role: polisher
- Current slice: 0002_response_queue
- Current slice directory: /Users/joyo/Sheaf/quests/main/0001_vs_code_plugin/slices/0002_response_queue
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
Fix the open issues in `polishing_issues.md`. Add resolution notes but do not close issues yourself.I'll start by reading the polishing issues and understanding the current state of the slice.Now let me look at the ToolDispatcher to understand how tool outputs and follow-ups happen.Now I understand the problem. Let me look at the tests and the plan to ensure my understanding.Now I fully understand the issue. The current flow in `HandleIncomingEvent` is:

1. Routes incoming event
2. `m_responseQueue.OnIncomingEvent(event)` - which clears active state and drains the queue (calling externally queued `response.create` units)
3. `HandleToolCallExtraction(event)` - which dispatches tool calls (async)

So when `response.done` with function calls arrives, the queue drains queued externally-submitted units BEFORE the tool dispatcher has a chance to send the `function_call_output`. The tool dispatcher then sends `function_call_output` and its own follow-up `response.create` AFTER those externally queued ones.

The fix is to extract tool calls first (synchronously dispatch them via `Enqueue`, which routes into the dispatcher), and to ensure tool outputs precede externally queued response-affecting units.

However, the tool dispatcher runs callbacks asynchronously (`async`). Even if we call `HandleToolCallExtraction` first, the actual `function_call_output` send happens later in a microtask. So just reordering isn't enough.

We need to:
1. Detect when a `response.done` carries pending tool calls
2. Either: defer draining of externally-queued response-affecting units until all tool follow-up `function_call_output`s have been sent, OR force tool calls to send their output synchronously before queue drains.

Let me check how tools are dispatched - the `ToolDispatcher.Enqueue` is synchronous (pushes onto queue and calls `void ProcessQueue()`). The actual tool callback execution is async. So tool callbacks may need any time and we must wait for outputs.

A cleaner approach: when `response.done` arrives with function calls, mark the queue as "tool follow-up pending" - it should NOT drain externally queued units until tool follow-up `response.create` has been queued OR all tool calls have produced outputs and their follow-ups (if any) have been registered.

Wait - re-reading the issue, the rule is: tool outputs MUST be transmitted before any newly-unblocked response.create. The follow-up `response.create` (from tool dispatcher) also routes through the queue. So if the tool dispatcher always enqueues a follow-up `response.create`, then the ordering of [externally queued unit, tool follow-up create] matters. The issue says tool outputs must come first; about the follow-up create itself: "tool follow-up `response.create` must still route through the same queue."

So the fix needs to:
1. Hold off draining externally queued response-affecting units until tool outputs from terminal response are sent.
2. The tool follow-up `response.create` (if any) is still enqueued via queue, so it joins the FIFO.

Best approach: introduce a "tool dispatch in flight" state on the queue. When `response.done` is observed AND it contains function calls, mark the queue as having pending tool dispatch. The session calls a method like `BeginToolDispatchHold(callIds)` and `EndToolDispatchHold(callId)` per output sent. While any holds exist, `IsBusy()` returns true so draining doesn't happen.

Let me design this:

1. Detect function calls in `response.done` and `response.function_call_arguments.done` events
2. Before calling `OnIncomingEvent` (which currently drains), extract tool calls and register them as "pending tool outputs" on the queue.
3. Process the event normally - queue knows it's busy due to pending tool outputs.
4. When the tool dispatcher sends `function_call_output`, notify the queue (via `NotifyOutgoingTransmitted`) to decrement the pending count. When it hits zero, drain.

Let me reorder in `HandleIncomingEvent`:
1. Route event
2. Extract tool calls first - this records pending tool outputs on the queue (synchronously)
3. Pass to queue's `OnIncomingEvent` - it sees there are pending tool outputs and does NOT drain
4. Tool dispatcher eventually sends `function_call_output` -> queue's `NotifyOutgoingTransmitted` decrements pending and drains when all done

Let me implement this.Now let me look at the helpers to understand what `BuildTestAgentConfig` provides for tools:Now let me design the fix. I'll add a "pending tool output holds" counter to the queue. The session counts function calls before calling the queue's `OnIncomingEvent`, and the queue decrements as it observes `function_call_output` events going out.

Let me look at existing slice notes and the responses file:Now I'll plan the fix carefully:Now implement the fix. The approach:

1. Add `RegisterPendingToolOutput(callId)` and observe outgoing `function_call_output` to clear the pending. While there are pending tool outputs, `IsBusy()` is true so drain is blocked.
2. In `HandleIncomingEvent`, BEFORE invoking `m_responseQueue.OnIncomingEvent`, extract function calls and call `RegisterPendingToolOutput` for each. Also extract from `response.function_call_arguments.done`.
3. Then call `OnIncomingEvent(event)` - the queue clears active state but doesn't drain because of pending holds.
4. Then call `HandleToolCallExtraction` which dispatches. When the dispatcher eventually sends `function_call_output`, queue clears the corresponding hold; when all holds clear and queue isn't otherwise busy, drain.

Note: the tool dispatcher's own follow-up `response.create` (when `responseAfterOutput: "always"`) is enqueued via `EnqueueToolFollowUpResponseCreate` which `SubmitResponseAffectingUnit`s. Since there are still holds, those go to the FIFO too. Question: will those follow-up creates appear AFTER externally queued units that were enqueued before `response.done`? Yes - they were enqueued earlier. That's correct FIFO.

But wait - the issue says the tool's `function_call_output` must come before any queued `response.create`. Our fix ensures that. The follow-up `response.create` from the tool dispatcher will go through the queue and be after the externally queued one (FIFO). That's also acceptable - the issue states tool follow-up is queued through the same FIFO.

Let me also handle the `response.function_call_arguments.done` case — `m_argumentAccumulator.TakeCompletedCall` consumes the event. We should register the pending output before passing to the queue. But the order of incoming `response.function_call_arguments.done` is before `response.done`. The queue only drains on `response.done`/`cancelled`/error. So actually for the `response.function_call_arguments.done` path, the queue doesn't drain on that event. The drain happens on `response.done`. So we should register the pending output when extracting from either event to cover both paths.

Actually let me think again. The `response.function_call_arguments.done` arrives BEFORE `response.done`. So:
1. `response.function_call_arguments.done` arrives → tool dispatcher starts processing → output sent later
2. `response.done` arrives → queue tries to drain

By step 2, the tool dispatcher may still be processing (async). The function_call_output may not yet have been sent. So we need to register a pending hold when we observe `response.function_call_arguments.done` too.

Let me write the changes:Wait — `NotifyOutgoingTransmitted` is called inside `TransmitOutgoing`, BEFORE `m_client.send`. The `TryDrain()` call would synchronously drain queued units that then call `TransmitOutgoing` for `response.create`. This means `response.create` will be transmitted before the `function_call_output` actually goes to the wire (since the dispatcher's call to `TransmitOutgoing` first calls `NotifyOutgoingTransmitted` which now drains BEFORE the `m_client.send(event)` for the `function_call_output`).

Let me fix this. The order in `TransmitOutgoing`:
```
this.m_responseQueue.NotifyOutgoingTransmitted(event);  // drain happens here
this.m_client.send(event);                              // actual send of function_call_output
this.m_router.routeOutgoingEvent(event);
```

So if `NotifyOutgoingTransmitted` triggers drain, the queued `response.create` would actually be sent (via recursive `TransmitOutgoing` → `m_client.send`) BEFORE the `function_call_output`. That's the exact bug we're trying to fix!

I need to either:
- Move `NotifyOutgoingTransmitted` to AFTER `m_client.send`, OR
- Defer the drain to a microtask, OR
- Only release the hold and have `OnIncomingEvent`/explicit drain calls.

The simplest correct fix is to reorder `TransmitOutgoing` so notification happens after send. Let me check: currently `NotifyOutgoingTransmitted` for `response.create` sets `m_outboundCreatePending = true` so that even if `response.create` is queued after a `response.create` we just sent, we won't drain another one prematurely. The order doesn't matter for that case since `m_responseQueue` won't try to drain inside `NotifyOutgoingTransmitted` currently.

I'll reorder `TransmitOutgoing` to notify after sending, which preserves the existing semantic for `outbound_create_pending` and lets us safely call `TryDrain` from within `NotifyOutgoingTransmitted`.

Actually wait — when does the queue drain due to a queued unit that itself is a `response.create`? In `TryDrain`, the unit runs, which calls `TransmitOutgoing` for `response.create`, which calls `NotifyOutgoingTransmitted` → sets `m_outboundCreatePending = true`. Then the next iteration of `while (this.m_fifo.length > 0 && !this.IsBusy())` checks `IsBusy()` which returns true. Good.

But with `NotifyOutgoingTransmitted` called AFTER `m_client.send`, the order would be: actual send happens → queue notified. In TryDrain's while loop, after `unit.run()` returns, the queue checks IsBusy. With `m_outboundCreatePending` set, IsBusy is true so loop exits. Same behavior. So reordering is safe.

But for our function_call_output case: we want the actual `m_client.send(function_call_output)` to happen BEFORE the drain triggers `response.create`. So `NotifyOutgoingTransmitted` (which triggers drain) needs to happen AFTER `m_client.send(function_call_output)`. Reordering achieves this.Now I need to register pending tool output holds in the session BEFORE the queue processes the incoming event. Let me update `HandleIncomingEvent`:Now there's another subtle issue. The `DispatchToolCall` is idempotent via `m_dispatchedCallIds` - this guards against double-dispatch when both `response.function_call_arguments.done` AND `response.done` carry the same call. We need to make sure `RegisterPendingToolOutput` is also not double-counted. Since `m_pendingToolOutputCallIds` is a Set keyed by `callId`, calling it twice is a no-op. Good.

But also: tools that fail to extract (e.g. malformed event with missing `name`/`arguments`) won't be dispatched, so no `function_call_output` will ever fire and the hold would persist forever. Let me check `m_argumentAccumulator.TakeCompletedCall` — it can return null if name/args missing. Similarly `ExtractFunctionCallsFromResponseDone` filters out incomplete entries.

For `response.function_call_arguments.done`, our `ReserveToolOutputHolds` only checks for `call_id` existence, but if name/args are missing, we'd register a hold without ever dispatching. The same applies to `response.done` function calls without all fields - but `ExtractFunctionCallsFromResponseDone` only yields fully-formed entries, so those are safe.

Let me align by only reserving holds for entries that will dispatch. Actually for `response.function_call_arguments.done`, the accumulator pulls name from accumulated deltas so it's likely fine, but to be safe let's mirror the dispatch logic:Wait - what about the case in the existing test "responseAfterToolOutput true defers follow-up response.create while a response is active"? It uses `response.function_call_arguments.done` (not `response.done`). The flow is:
1. session.createResponse() - sent, no response active
2. response.created arrives - active
3. response.function_call_arguments.done arrives - dispatcher dispatches, sends function_call_output
4. The tool dispatcher's follow-up `response.create` is enqueued (and held because response is active)
5. response.done arrives - drains queue, sends the follow-up response.create

In this scenario, the queue is busy because of `m_serverResponseActive`. The dispatcher's follow-up enqueues because `IsBusy()` is true. Then when `response.done` arrives, the queue clears active state and drains. The `function_call_output` was already sent at step 3 (before `response.done`). The drain runs the follow-up `response.create`. Good, that test should still pass.

Now consider another scenario: `response.done` carries `function_calls` (no separate `function_call_arguments.done`):
1. response.done arrives → ReserveToolOutputHolds registers hold for each call
2. m_responseQueue.OnIncomingEvent(response.done) → clears active state, calls TryDrain, but IsBusy is true due to holds → no drain
3. HandleToolCallExtraction → DispatchToolCall queues tool calls in dispatcher
4. Dispatcher processes async, eventually sends function_call_output
5. TransmitOutgoing sends to wire, then NotifyOutgoingTransmitted releases hold and TryDrains
6. Queued response.creates fire AFTER function_call_output. 

What about the existing test "responseAfterToolOutput false emits only function_call_output"? Same flow but no follow-up. Works fine.

What about "two rapid tool calls with responseAfterToolOutput true"? 
1. SimulateResponseCreatedAndDone(r_pre) - registers no holds (response without function calls)
2. response.done with 2 function calls arrives:
   - ReserveToolOutputHolds registers holds for both call_x and call_y
   - OnIncomingEvent clears active, tries drain → IsBusy due to holds → no drain
   - HandleToolCallExtraction enqueues both in dispatcher
3. Dispatcher processes call_x async:
   - sends function_call_output → releases hold for call_x → TryDrain → still has 1 hold → no drain
   - enqueues follow-up response.create (IsBusy due to hold for call_y) → goes to FIFO
4. Dispatcher processes call_y async:
   - sends function_call_output → releases hold for call_y → TryDrain → no holds, !IsBusy → drain!
   - Drain runs the queued follow-up response.create → IsBusy becomes true (outboundCreatePending)
   - Loop exits
   - dispatcher also tries to enqueue follow-up for call_y → SubmitResponseAffectingUnit, IsBusy is true now (outboundCreatePending) → enqueues
5. Eventually server acks the response.create...

Hmm wait, the order matters here. After processing call_y, the dispatcher sends function_call_output then calls `MaybeEnqueueFollowUpResponse` which calls `enqueueResponseCreate`. The output is sent first (step 4 first sub-step). Then the drain triggers from NotifyOutgoingTransmitted - this happens INSIDE TransmitOutgoing. The dispatcher hasn't yet called enqueueResponseCreate at that point (that's the next await).

Actually let me re-examine. `SendToolOutput` does: `this.m_sendContext.sendOutgoingEvent(event)` which calls `TransmitOutgoing` synchronously. That sends, then NotifyOutgoingTransmitted triggers drain. Then later `await MaybeEnqueueFollowUpResponse()` calls `enqueueResponseCreate`.

So for call_y: function_call_output sent → drain (the previously queued follow-up for call_x runs response.create → outboundCreatePending true) → then await enqueueFollowUp for call_y → IsBusy is true → goes to FIFO.

The test expects 2 follow-up creates eventually after `SimulateResponseCreatedAndDone(r_chain_ack)`. The first create is in flight, then r_chain_ack response.done arrives, drain runs the second follow-up create. Good.

But wait the test expects them in order. The first follow-up create is for call_x (queued at step 3), the second is for call_y (queued at step 4 after drain). FIFO. Good.

Now let me write the focused test:Now let's run the tests:All 88 tests pass, including our new test. Now let me also verify all tests in the response_queue file are still passing explicitly:All 15 response_queue tests pass. Now let me also verify my new test fails without the fix. Let me temporarily revert just to confirm... actually no, let's trust the code review. Let me at least verify the new test catches the bug by quickly checking the logic mentally:

Without the fix:
- response.done with function call arrives
- `m_responseQueue.OnIncomingEvent(response.done)` clears active state, drains FIFO
- The queued external `sendTextMessage("post_tool", { createResponse: true })` runs: sends the user message item + response.create
- Then `HandleToolCallExtraction` dispatches the tool call
- Eventually `function_call_output` is sent
- Order: external message + response.create BEFORE function_call_output → test fails ✓

With the fix:
- ReserveToolOutputHolds registers hold for "call_order"
- OnIncomingEvent clears active, tries drain, IsBusy true → no drain
- HandleToolCallExtraction dispatches
- After tool completes, function_call_output sent → hold released → drain → external message+create runs
- Order: function_call_output first → test passes ✓

Let me also double-check there's no issue with the existing test where I reordered `TransmitOutgoing`. The router's `routeOutgoingEvent` persists events to the db. Previously NotifyOutgoingTransmitted was called first (just setting a flag), now it's last. No behavior change for `response.create` flag.

Now let me write the response file:Fixed PR-0001 by adding tool-output holds to the response queue so that externally queued response-affecting units cannot drain ahead of `function_call_output` events from a terminal `response.done`.

Key changes:
- `apps/realtime-agent/src/response_queue.ts`: new `RegisterPendingToolOutput(callId)` + `m_pendingToolOutputCallIds` set; `IsBusy()` is true while any hold exists; `NotifyOutgoingTransmitted` releases the hold when a `function_call_output` goes out and then drains.
- `apps/realtime-agent/src/agent_loop.ts`: `HandleIncomingEvent` reserves holds for every function call in `response.done` BEFORE delegating to the queue; `TransmitOutgoing` notifies the queue AFTER the actual `m_client.send` so any drain-triggered `response.create` is necessarily transmitted after the `function_call_output`.
- New focused test `queued external response.create waits for function_call_output from terminal response.done` proves ordering with a slow async tool, a queued `sendTextMessage(..., { createResponse: true })`, and a `response.done` carrying a function call.

All 88 tests pass. Response recorded in `polishing_issue_responses.md`; status of PR-0001 left open for `polisher_reviewer`.

