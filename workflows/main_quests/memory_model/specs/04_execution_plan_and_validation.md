# Execution Plan And Validation

## Implementation Sequence

1. Replace chat schema DDL (`CREATE TABLE`) definitions with memory-model
   version.
2. Remove legacy tool-call tables and all ORM/query code that depends on them.
3. Update turn repository/data-access layer to write/read `turn_type`,
   `actor_name`, `tool_name`, `tool_calls_json`, `tool_call_id`, and
   `state_context_json`.
4. Update generation-result handling so tool requests are represented as an
   ordered JSON list of tool call records, then persisted on one `tool_call`
   turn containing that list.
5. Update filesystem tool responses (`read_file`, `list_directory`,
   `create_file`, `apply_patch`, `move_path`, `delete_path`) to emit compact state-context
   metadata operations.
6. Add close-context tools (`close_file_context`, `close_directory_context`) for
   explicit file/directory close operations.
7. Update context builder to linked-list reconstruction with compaction stop and
   backward-walk hash-table state resolution for read/close/rename, including
   prefix-aware directory rename propagation.
8. Update compaction pipeline to multi-pass behavior:
   - build full context first
   - choose remain-open/close sets
   - stage compaction summary/reopen plan before generation
   - commit compaction summary turn, synthetic reopen turns, and the next model
     output atomically
9. Update `DoWork` to a one-transition state machine where one generation step
   may append one `tool_call` turn containing a full ordered tool-call list and
   the next tool step executes that list sequentially, persisting all resulting
   `tool_response` turns in one transaction.
10. Keep transport/UI contracts stable by adapting server serialization layer,
    with grouped provider-facing `tool_calls` reconstruction and one visible
    assistant `tool_call` turn per persisted batch.
11. Delete obsolete code from old chat model implementation.

## Deletion Requirement

This quest is not done until the old chat system is gone.

Required cleanup:
- remove dead schema DDL for legacy tool-call tables
- remove dead repository methods for old tool-call persistence
- remove dead runner branches that assume tool calls are not turns
- remove dead context-storage paths that write/read `turn_context`
- remove dead tests that validate old-model-only behavior
- remove dead code that expects raw file bodies/listings in tool response text
- remove partial line-range read mode from `read_file` tool behavior

## Compatibility Boundary

Must stay stable:
- Obsidian UI behavior
- websocket event contract
- server request/response API surface

May change internally:
- DB schema and persistence strategy
- runner internal execution flow
- context reconstruction implementation

## Future Note (Out Of This Quest Diff)

Higher-level tools may be added later to generate consolidated summary files
from multiple source files, then close original files and keep the summary file
open. That orchestration is intentionally outside this quest's primitive
state-context operations and compaction implementation.

## Test Plan

### Schema Tests

- DB bootstrap creates replacement `turns` schema with new columns/checks.
- DB bootstrap does not create legacy tool-call tables.
- `turn_context` column is absent.
- `tool_calls_json` exists and is used for `tool_call` turns.
- `state_context_json` exists and is used for `tool_response` turns.
- schema enforces that only `tool_response` turns can carry state-context metadata.

### Runner/DoWork Tests

- One `DoWork` call advances exactly one state-machine transition.
- Fresh request first appends `user_message`, then either one `tool_call` turn
  containing a tool-call list or an `assistant_message` in the same transition.
- A generation that requests tools persists them as an ordered JSON list and
  appends one `tool_call` turn containing that list.
- Tail `tool_call` step executes the whole pending list sequentially and
  appends all `tool_response` turns for that request without also calling the
  model.
- All tool responses for one pending batch commit in one transaction.
- One requested tool call yields exactly one persisted `tool_response` row.
- Multi-target state mutations persist inside that response row's
  `state_context_json`, not in synthetic extra tool-response rows.
- Request is not finalized until `assistant_message` turn is committed.
- If tail is tool-loop type, queued user request for same thread is deferred.
- If tail is tool-loop type for one thread, unrelated threads still run.
- Restart continuation resumes unfinished tool loop from persisted turns.
- Queue behavior remains `message_queue` only (no queue kind split).
- `delete_path` emits context close operation for deleted keys.
- `close_file_context` / `close_directory_context` emit close operations without
  filesystem deletion.

### Context/Compaction Tests

- Context reconstruction walks linked list from tail and stops at compaction.
- Compaction output is represented as `compaction` turn.
- Post-compaction requests include compaction turn and newer turns only.
- Compaction turns and the next generation output commit atomically.
- Backward walk applies rename aliasing so old keys resolve to latest key.
- Directory rename rebases child keys by prefix mapping.
- Rename oscillation (`A -> B -> A`) resolves without alias loops.
- Close operations suppress previously-read context keys.
- Effective read state injects each canonical file/directory context exactly once.
- Injected file context includes metadata framing (path and "contents of file"
  style wording).
- Full-file read semantics are used for context injection; no partial ranges.
- Final context order keeps one batched assistant `tool_calls` message followed
  by a contiguous block of matching `tool` messages before any derived injected
  state blocks are appended.
- Turn-chain/alias cycles raise fatal corruption errors.
- Compaction pass emits summary turn plus synthetic reopen turns in
  topologically sorted directory order.

### Transport Compatibility Tests

- Existing API payloads consumed by Obsidian remain unchanged.
- Existing UI rendering tests pass without UI-layer changes.
- Provider-facing assistant tool-request payloads reconstruct one ordered
  `tool_calls` list from one persisted `tool_call` turn.
- Websocket delivery and handshake replay expose one assistant visible turn per
  persisted `tool_call` batch and do not repeat that batch on the later final
  assistant turn.
- Tool call summaries remain derivable from persisted turns.
- Tool response transport remains compatible while omitting raw file/list payloads.
- Compaction agent prompt explicitly avoids rewriting large summaries for files
  that remain open and will be reopened synthetically.

## Exit Criteria

- New schema and runner behavior are implemented according to this quest spec.
- Old chat system code and legacy tool-call tables are deleted.
- No migration/replay path for old chat DB remains.
- Fresh database bootstrap is the supported production path.
- Existing Obsidian client behavior remains compatible.
