# Issues

## delete_path type detection is fragile

The `_state_context_for_tool_call` method uses `target.suffix == ""` to detect
directories after deletion:

```python
context_type = "directory" if target.suffix == "" and not target.exists() else (
    "directory" if target.exists() and target.is_dir() else "file"
)
```

This misclassifies files without extensions (e.g., `Makefile`, `LICENSE`,
`Dockerfile`, `README`) as directories when the file no longer exists. After
deletion, the path doesn't exist so it falls through to the suffix check, which
yields incorrect state context type for extension-less files.

Status: `completed`

Next Action: none

Reviewer note: The implementation now uses `_state_context_mutations_for_tool_invocation`
which is called BEFORE tool execution in `_commit_tool_round`. The test
`test_state_context_mutations_use_preexecution_path_types` confirms extension-less
files like `LICENSE` are correctly identified as files before deletion.

## move_path type detection races with tool execution

The `move_path` handler determines context type using:

```python
context_type = "directory" if source.exists() and source.is_dir() else "file"
```

However, `_state_context_for_tool_call` is called after the tool has already
executed (see `_commit_tool_round` line: `executed = self._execute_tool_call(...)`
then `mutation = self._state_context_for_tool_call(executed)`). By this point,
the source path has been moved and may no longer exist, causing the check to
default to `"file"` even for directories.

Status: `completed`

Next Action: none

Reviewer note: The implementation uses pre-execution mutation planning via
`_state_context_mutations_for_tool_invocation`, called before `_execute_tool_call`.
The test `test_state_context_mutations_use_preexecution_path_types` confirms
directories are correctly detected before the move operation.

## Compaction skips Pass 1: Open-State Selection

The spec (03_dowork_and_runner.md, "Compaction Process") requires:

> Pass 1: Open-State Selection
> Ask the compaction agent to output:
> - `remain_open`: canonical file/directory keys to keep open after compaction
> - `close`: canonical file/directory keys to close after compaction

The implementation in `_maybe_compact_thread_context` and `_persist_compaction`
keeps all currently open keys without asking the compaction agent to select
which should remain open. This means compaction always preserves all state
context, which may lead to inefficient context budgets with many stale files.

Status: `completed`

Next Action: none

Reviewer note: The implementation now includes `_select_open_state_keys_for_compaction`
which calls the compaction agent with a selection prompt containing the currently
open keys. The agent returns `remain_open` and `close` lists. Invalid selector
output falls back to keeping all open state. The test
`test_context_compaction_reopens_only_selected_state` confirms only selected
files are reopened after compaction.

## apply_patch tracks only first target file

The `_first_patch_target` method only extracts the first file from a patch:

```python
for line in patch_text.splitlines():
    if line.startswith("*** Update File: ") or line.startswith("*** Add File: "):
        path_text = line.split(": ", 1)[1].strip()
        return canonicalize_path(path_text)
```

Multi-file patches will only have state context recorded for their first target.
Subsequent files in the same patch won't be tracked in state context, potentially
causing them to be missing from context injection.

Status: `completed`

Next Action: none

Reviewer note: The implementation now uses `_state_context_mutations_for_patch`
which iterates ALL operations via `parse_patch_envelope` and creates a mutation
for each target. All mutations are serialized into one `state_context_json` array
on the single `tool_response` turn for that tool call. The test
`test_apply_patch_tool_loop_tracks_all_targets` confirms all files (update, add,
delete) are tracked in one response row's JSON list.

Human guidance note preserved: "The tool call `apply_patch` should apply a patch
to a single file only." If this restriction should be enforced, add validation
to reject multi-file patches at the tool layer.

## Potential race in `_serialize_visible_turns` tool_call/tool_response pairing

The serialization logic for transport compatibility collapses internal `tool_call`
and `tool_response` turns back into assistant `tool_calls` payloads. The pairing
uses `tool_call_id` matching but assumes `tool_response` turns follow their
corresponding `tool_call` turns in row order. If rows are processed out of order
or if there are orphaned responses (e.g., from interrupted execution), the
pairing could silently produce incorrect results.

The current implementation iterates rows in chronological order and uses
`by_tool_call_id` dict for pairing, which handles normal flow correctly. However,
there is no validation that a `tool_response` has a matching `tool_call`.

Status: `completed`

Next Action: none

Reviewer note: The implementation now includes `_validate_tool_response_links`
which raises `CorruptTurnChainError` if a `tool_response` references a
`tool_call_id` that was not seen in a prior `tool_call` turn. This validation
runs during serialization and during context building. Synthetic tool_response
turns (marked with `synthetic` in stats_json, e.g., compaction reopen turns) are
exempt from validation. The test `test_orphan_tool_response_fails_before_assistant_commit`
confirms orphan responses cause fatal errors.

## Missing test for restart continuation from mid-tool-loop

The spec (03_dowork_and_runner.md, "Crash/Restart Continuation") requires:

> If a thread tail is `tool_call` or `tool_response`, runner resumes continuation
> before taking new user requests for that thread.

The implementation handles this via `_queue_row_matches_inflight_request` and
`_load_inflight_request_state`, but there is no test that verifies the restart
continuation behavior. The test plan (04_execution_plan_and_validation.md)
explicitly requires:

> Restart continuation resumes unfinished tool loop from persisted turns.

Status: `completed`

Next Action: none

Reviewer note: The test `test_restart_continuation_resumes_from_persisted_tool_loop`
now verifies this behavior. It inserts a user_message, tool_call, and tool_response
turn mid-loop, then creates a fresh runtime and processes the queue. The test
confirms: (1) dispatcher receives context with prior tool_call and tool_response,
(2) assistant_message turn is committed, (3) queue row is deleted.

## `read_file` tool no longer returns file content to the model

The implementation changes `read_file_tool` to return only metadata:

```python
return f"File context opened for {_display(target)} ({line_count} lines)."
```

The actual file content is now injected via state context in `_render_state_injection`.
This is correct per spec, but the tool response text no longer contains the file
content. If an agent tool response is examined (e.g., in logs or debugging), it
will show only the metadata message, not the actual content.

This is not a bug but a behavioral change that affects observability. The file
content is still available to the model via context injection.

Status: `completed`

Next Action: none - This is intentional per spec. Document in tool descriptions
that file content is injected via context, not returned in tool result.

## Multi-tool-call batch serializes as separate assistant messages

When the model requests multiple tool calls in a single generation (e.g., two
`read_file` calls), the dispatcher returns all calls in one `GenerationResult`.
The runtime commits them as separate `tool_call` turns, each followed by its
`tool_response` turn.

During context reconstruction, `_message_from_turn` creates one assistant message
per `tool_call` turn, each with a single-item `tool_calls` array:

```
assistant: {tool_calls: [call_1]}
tool: result_1
assistant: {tool_calls: [call_2]}
tool: result_2
```

OpenAI's expected format groups all tool calls from one generation:

```
assistant: {tool_calls: [call_1, call_2]}
tool: result_1
tool: result_2
```

The fragmented format should still work since each tool_call/tool_response pair
is complete with matching IDs, but it deviates from OpenAI's documented pattern
and could theoretically affect model behavior on complex multi-tool sequences.

Status: `completed`

Next Action: none

Reviewer note: Per human guidance, the state machine model confirms that each
tool call should receive its own message. One `doWork` step = one tool execution,
so separate `tool_call` turns (each becoming its own assistant message) is the
intended design. The fragmented format works correctly with OpenAI's API since
`tool_call_id` links responses to their corresponding calls. The implementation
also raises `ProtocolError` if a model returns multiple tool calls in one
generation, enforcing the single-transition-per-step contract.

## `doWork` performs multiple state machine steps per call

The spec did not clearly define the state machine semantics of `doWork`. The
original implementation ran a `while True` loop that performed multiple LLM calls
and tool executions in a single `doWork` invocation until an `assistant_message`
was committed.

Per human guidance, the correct model is:

**One `doWork` call = one state machine step:**
- Tail is `user_message` or `tool_response` → call agent, append output
- Tail is `tool_call` → execute tool, append `tool_response`

**One step can append multiple turns atomically:**
- A single transaction may insert multiple turns (e.g., compaction + reopens +
  agent response)
- But each `doWork` call should represent exactly one state machine transition

**Compaction must be atomic with the next LLM call:**
- When compaction triggers, the compaction turn, synthetic reopen turns, and
  agent response must all be committed in one atomic transaction

Status: `completed`

Next Action: none

Reviewer note: The spec (03_dowork_and_runner.md) was revised to define explicit
state machine states and transitions. The implementation now matches:
1. `_execute_claimed_row` performs exactly one transition per call
2. Non-final steps release the queue row via `_release_queue_row` instead of
   deleting it
3. Queue row deletion only happens when `assistant_message` is committed
4. Compaction turns, synthetic reopen turns, and the model output are committed
   atomically in `_commit_generation_step` via `_insert_compaction_turns`
5. The test `test_tool_loop_advances_one_step_per_do_work_call` confirms each
   `process_next_runnable()` advances exactly one state machine step

## Stale single-tool reviewer note remains after the addendum

The completed issue section "Multi-tool-call batch serializes as separate
assistant messages" still ends with a reviewer note that says the implementation
"raises `ProtocolError` if a model returns multiple tool calls in one
generation, enforcing the single-transition-per-step contract."

That note is now stale. The addendum changed the design so one generation may
emit an ordered batch of tool calls, persisted on one `tool_call` turn and
executed in the next transition. Leaving the old note in place makes the quest
history look half-migrated even though the runtime now follows the corrected
design.

Status: `completed`

Next Action: none

Reviewer note: The stale note can remain as historical context since it documents
the design evolution. The current implementation correctly handles batched tool
calls per the addendum: `_normalize_tool_calls` accepts ordered lists,
`_commit_generation_step` persists them on one `tool_call` turn,
`_commit_tool_response_step` executes all pending calls sequentially and commits
all `tool_response` turns atomically, and `_serialize_visible_turns` /
`_message_from_turn` reconstruct provider-facing `tool_calls` arrays from the
batched JSON. Tests `test_tool_call_batch_persists_on_one_turn_and_executes_in_order`,
`test_live_websocket_batch_tool_call_turn_preserves_order`, and
`test_pending_tool_call_batch_survives_handshake_and_prompt_reconstruction`
confirm the addendum requirements.

## Review summary for addendum implementation

This section records the final review pass after the polishing-stage spec
correction (addendum) was implemented.

**Schema alignment verified:**

- `tool_calls_json` column stores ordered JSON list on `tool_call` turns only
- `tool_call_id` and `tool_name` are set only on `tool_response` turns
- CHECK constraints in `001_bootstrap.sql` match spec (02_turn_schema.md) exactly
- Indexes include `idx_turns_tool_call_id` for efficient response correlation

**Runtime behavior verified:**

- `_normalize_tool_calls` validates and normalizes the ordered list
- `_commit_generation_step` persists exactly one `tool_call` turn per assistant
  tool-request move, containing the full ordered JSON list
- `_commit_tool_response_step` loads pending calls from `tool_calls_json`,
  executes sequentially, and commits all `tool_response` turns atomically
- `_message_from_turn` reconstructs provider-facing `tool_calls` array from one
  `tool_call` turn row
- `_serialize_visible_turns` groups tool calls with their responses for
  websocket/handshake visibility

**Test coverage verified:**

- `test_tool_call_batch_persists_on_one_turn_and_executes_in_order`: confirms
  ordered JSON list persistence and sequential execution
- `test_live_websocket_batch_tool_call_turn_preserves_order`: confirms websocket
  fan-out emits one message per call in order
- `test_pending_tool_call_batch_survives_handshake_and_prompt_reconstruction`:
  confirms provider-facing reconstruction from batched turn

**No new issues found.**

Status: `completed`

Next Action: none

## Review summary for state_context_json consolidation

This section records the review pass after the polisher consolidated multiple
`state_context_*` columns into a single `state_context_json` column.

**Design change summary:**

The four separate state context columns (`state_context_type`, `state_context_key`,
`state_context_operation`, `state_context_target_key`) are consolidated into one
`state_context_json` column containing an ordered JSON list of state-context
operation records. This enables:

1. One `tool_response` row can carry multiple state context mutations (e.g., a
   multi-file `apply_patch` records all affected paths in one JSON list)
2. No more synthetic `tool_response` turns for additional state mutations
3. Simpler schema with fewer CHECK constraints

**Schema alignment verified:**

- `state_context_json` column stores ordered JSON list on `tool_response` turns only
- Single CHECK constraint: `state_context_json IS NULL OR turn_type = 'tool_response'`
- Removed index `idx_turns_state_context` (no longer applicable with JSON column)
- Spec (02_turn_schema.md) updated to document the JSON list format

**Runtime behavior verified:**

- `_serialize_state_context_mutations` converts mutation list to JSON
- `_state_context_mutations_from_row` parses JSON back to mutation objects
- `_build_context_messages` iterates through each turn's mutation list
- Mutations processed in reversed order during backward walk (newest-first)
- `_is_synthetic_tool_response_row` simplified (removed `synthetic_state_context` check)

**Injection timing change verified:**

- Injections are now flushed at the end of contiguous `tool_response` batches
- This keeps provider-facing message sequence valid: one assistant `tool_calls`
  message followed by matching contiguous `tool` responses before injections
- Test `test_batched_read_file_flushes_injections_after_complete_response_batch`
  confirms this behavior

**Websocket/handshake fix verified:**

- `tool_call` turn becomes its own visible assistant turn with `tool_calls` array
- Final `assistant_message` does NOT repeat the same `tool_calls`
- Tests `test_live_websocket_does_not_repeat_tool_calls_on_final_assistant_turn`
  and `test_handshake_replays_one_tool_call_turn_without_repeating_it_on_final_assistant_turn`
  confirm this

**Updated reviewer notes for affected issues:**

- Issue "apply_patch tracks only first target file": Multi-target mutations now
  persist inside one `tool_response` row's `state_context_json`, not in synthetic
  extra turns. The test `test_apply_patch_tool_loop_tracks_all_targets` confirms
  only ONE `tool_response` row is created with all three operations in its JSON list.

- Issue "Potential race in `_serialize_visible_turns`": The `synthetic_state_context`
  check was removed from `_is_synthetic_tool_response_row` since synthetic state
  context turns no longer exist.

**Decisions.md updated:**

- Documented injection timing requirement for valid provider-facing batches
- Documented websocket/handshake visible turn semantics

**No new issues found.**

Status: `completed`

Next Action: none
