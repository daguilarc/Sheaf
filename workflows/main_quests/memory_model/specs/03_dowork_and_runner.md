# DoWork And Runner Contract

## Intent

Define how `DoWork` executes queued user requests when tool calls and tool
responses are persisted as turns in the same thread ledger.

## State Machine Contract

`DoWork` no longer drains an entire request in one invocation. One `DoWork`
call equals exactly one state-machine transition for one queued row.

Allowed transitions:

1. Tail is empty and queue row is fresh:
   - append `user_message`
   - reconstruct context
   - optionally plan compaction
   - call model
   - atomically append either one assistant-requested `tool_call` turn
     containing an ordered JSON list of one or more tool calls, or one
     `assistant_message` turn
2. Tail is `user_message`:
   - reconstruct context
   - optionally plan compaction
   - call model
   - atomically append either one assistant-requested `tool_call` turn
     containing an ordered JSON list of one or more tool calls, or one
     `assistant_message` turn
3. Tail is `tool_call`:
   - load the ordered JSON list from the pending `tool_call` turn at thread tail
   - execute those tool calls sequentially in stored order
   - append the resulting `tool_response` turns together in one transaction
4. Tail is `tool_response`:
   - reconstruct context
   - optionally plan compaction
   - call model
   - atomically append either one assistant-requested `tool_call` turn
     containing an ordered JSON list of one or more tool calls, or one
     `assistant_message` turn

Queue completion happens only when the transition appends an
`assistant_message`.

Protocol requirement:
- One assistant tool-request move must append exactly one `tool_call` turn, even
  when that turn requests multiple tool calls.
- If a generation requests tools, the request payload is an ordered JSON list of
  tool call objects.
- A single requested tool call is represented as a JSON list with one element,
  not as a bare object.
- Runtime must preserve the list order when persisting and executing tool calls.
- An empty tool-call list is invalid; a generation either emits a non-empty list
  of tool calls or emits an `assistant_message`.

## Processing Gate For Queued User Requests

If a thread tail is `user_message`, `tool_call`, or `tool_response`, only the
queue row that originated that in-flight request is runnable for that thread.
New queued user requests for the same thread must wait until an
`assistant_message` turn is committed.

This prevents interleaving fresh user prompts into an unfinished tool loop
without globally blocking unrelated threads.

## Runnable Work Selection

Implementation requirement:
- Keep `message_queue` shape and derive continuation state from tail turn type.
- Do not introduce queue row kinds (for example `user_request` /
  `continuation`) for this quest.
- Continuation is a per-thread gate, not a global worker monopoly. A thread in
  tool-loop continuation blocks only newer queued rows for that same thread.
  Other threads may still run between continuation steps.

## Canonical Per-Request Flow

Across repeated `DoWork` calls for one queued request:

1. First transition appends `user_message` if the request is fresh.
2. Every generation transition rebuilds context by walking turns backward to
   the nearest compaction boundary.
3. If compaction is needed, runtime must compute the compaction summary and
   reopen set before the model call, but persist them only in the same atomic
   transaction as the model output for that transition.
4. A generation transition appends either:
   - one `tool_call` turn containing an ordered JSON list of requested tool
     calls, or
   - one `assistant_message` turn
5. A tool transition executes the requested tool-call list from the pending
   `tool_call` turn sequentially and appends all resulting `tool_response`
   turns in one transaction. For each requested tool call, runtime appends
   exactly one `tool_response` row, and that row carries the full ordered
   state-context metadata list for that tool invocation.
6. The queue row remains in `message_queue` between transitions and is merely
   unlocked after non-final steps.
7. The queue row is deleted only when an `assistant_message` turn is committed.

Atomicity requirement:
- If compaction triggers before a generation step, the `compaction` turn,
  synthetic reopen turns, and the resulting `tool_call` turn or
  `assistant_message` must commit in one transaction.

Tool-batch execution requirement:
- The tool-execution transition must execute the pending calls from the
  `tool_call` turn in stored order.
- All resulting `tool_response` rows for that batch must commit together in one
  transaction.
- If any tool execution or response persistence in the batch fails, rollback the
  whole response batch for that transition.

## Tool Response Payload Contract For State Context

Tool outputs that affect context state must return compact metadata rather than
raw file/directory payloads in the tool result text.

Required mapping to actual tool names:

- `read_file`:
  - emits `state_context_json = [{"context_type":"file","key":<file path>,"operation":"read"}]`
  - always reads full file content (no partial line-range mode)
  - does not return full file body in the tool result text
- `list_directory`:
  - emits `state_context_json = [{"context_type":"directory","key":<directory path>,"operation":"read"}]`
  - does not return full directory listing in the tool result text
- `create_file` and `apply_patch`:
  - emit one `state_context_json` list on the same `tool_response` row
  - each affected target file contributes its own `read` or `close` operation record
  - this represents that latest file state should be context-available without synthetic extra turns
- `move_path`:
  - emits one `rename` record inside `state_context_json`
  - record uses `context_type = file` for file moves, `directory` for directory moves
  - record includes `key = <source path>` and `target_key = <destination path>`
- `delete_path`:
  - emits one `close` record inside `state_context_json`
  - record uses matching `context_type` (`file` or `directory`) and `key = <deleted path>`
  - ensures deleted contexts do not remain injected as open state

New close tools:
- Add `close_file_context` and `close_directory_context` as first-class tools.
- These tools emit one `close` record inside `state_context_json`.
- Close tools should not delete filesystem data; they only mutate chat context
  state.

## Context Builder Algorithm (State Context Aware)

Context reconstruction walks backward from thread tail and applies state context
operations using hash tables and prefix-aware directory rename resolution:

- `file_alias_map`: maps file keys to latest renamed file keys.
- `dir_alias_map`: maps directory roots to latest renamed directory roots.
- `state_map`: first-seen effective state per canonical key (`read` or `close`).
- `injections_by_turn_id`: state keys that should be injected after a specific
  turn in chronological reconstruction.

First-seen means first encountered during backward walk (newest operation), so
latest effective state wins and older superseded operations are ignored.

### Pseudocode

```text
function BuildContext(thread_id, tail_turn_id):
    rows_rev = []
    current_turn_id = tail_turn_id
    seen_turn_ids = set()

    while current_turn_id is not null:
        if current_turn_id in seen_turn_ids:
            raise CorruptTurnChainError(
                "cycle detected in turns.prev_turn_id chain"
            )
        seen_turn_ids.add(current_turn_id)

        turn = LoadTurn(thread_id, current_turn_id)
        if turn is null:
            break

        rows_rev.append(turn)
        if turn.turn_type == "compaction":
            break

        current_turn_id = turn.prev_turn_id

    # Newest -> oldest for state operation resolution.
    file_alias_map = Map[file_key -> file_key]()
    dir_alias_map = Map[dir_key -> dir_key]()
    state_map = Map[(type, key) -> "read" | "close"]()
    injections_by_turn_id = Map[turn_id -> List[(type, key)]]()

    function ResolveDirectoryKey(dir_key):
        node = CanonicalizePath(dir_key)
        chain_seen = set()
        while node in dir_alias_map:
            if node in chain_seen:
                raise CorruptStateContextError(
                    "cycle detected in state context rename aliases"
                )
            chain_seen.add(node)
            next_node = dir_alias_map[node]
            if next_node == node:
                break
            node = next_node
        return node

    function ResolveFileKey(file_key):
        path = CanonicalizePath(file_key)
        chain_seen = set()
        while path in file_alias_map:
            if path in chain_seen:
                raise CorruptStateContextError(
                    "cycle detected in file rename aliases"
                )
            chain_seen.add(path)
            next_path = file_alias_map[path]
            if next_path == path:
                break
            path = next_path

        # Apply directory-level aliases by longest-prefix match.
        while true:
            matched = false
            for source_dir in SortByLengthDesc(Keys(dir_alias_map)):
                if IsSamePathOrChild(path, source_dir):
                    target_dir = ResolveDirectoryKey(dir_alias_map[source_dir])
                    path = RebasePath(path, from_prefix=source_dir, to_prefix=target_dir)
                    matched = true
                    break
            if not matched:
                break
        return path

    function ResolveKey(context_type, context_key):
        if context_type == "directory":
            return (context_type, ResolveDirectoryKey(context_key))
        return (context_type, ResolveFileKey(context_key))

    for turn in rows_rev:
        mutations = ParseStateContextJson(turn.state_context_json)
        if mutations is empty:
            continue

        for mutation in Reverse(mutations):
            context_type = mutation.context_type
            context_key = mutation.key
            operation = mutation.operation

            if operation == "rename":
                if context_type == "directory":
                    from_dir = ResolveDirectoryKey(context_key)
                    to_dir = ResolveDirectoryKey(mutation.target_key)
                    if from_dir != to_dir:
                        dir_alias_map[from_dir] = to_dir
                else:
                    from_file = ResolveFileKey(context_key)
                    to_file = ResolveFileKey(mutation.target_key)
                    if from_file != to_file:
                        file_alias_map[from_file] = to_file
                continue

            canonical_key = ResolveKey(context_type, context_key)
            if canonical_key in state_map:
                continue

            if operation == "close":
                state_map[canonical_key] = "close"
                continue

            if operation == "read":
                state_map[canonical_key] = "read"
                if canonical_key not in injections_by_turn_id.get(turn.id, []):
                    injections_by_turn_id.setdefault(turn.id, []).append(canonical_key)

    # Build final context in chronological order with explicit interleaving.
    rows = Reverse(rows_rev)
    context = []
    pending_injections = []
    for turn in rows:
        context.append(BasicContext(turn))
        pending_injections.extend(injections_by_turn_id.get(turn.id, []))
        if turn.turn_type == "tool_response" and NextTurnType(rows, turn) == "tool_response":
            continue

        # Flush injections only after a complete contiguous tool-response batch.
        for canonical_key in pending_injections:
            if state_map.get(canonical_key) != "read":
                continue
            (injection_type, injection_key) = canonical_key
            if FileOrDirectoryExists(injection_type, injection_key):
                context.append(
                    ReadFileOrDirectoryWithMetadata(
                        injection_type,
                        injection_key
                    )
                )
            else:
                context.append(
                    "Cannot read " + injection_key + ", it may have been moved or deleted"
                )
        pending_injections = []

    return context
```

Notes:
- The algorithm resolves renames forward to final keys while walking backward.
- Close operations suppress context injection for that canonical key.
- Each effective file/directory key is injected at most once.
- Freshest effective operation wins; older operations are ignored.
- Directory renames are prefix-aware so child files/directories are rebased.
- Rename oscillation (for example `A -> B` then `B -> A`) resolves safely
  because canonical resolution collapses no-op inverse steps.
- Cycle detection in either turn chain or rename aliases is fatal and must fail
  execution for that thread until repaired.

## Compaction Process (Multi-Pass)

Compaction decision is made only after full context is built.

### Pass 0: Build Full Context

1. Reconstruct full context using algorithm above, including injected open file
   and directory blocks.
2. Measure context size.
3. If under threshold, skip compaction.

### Pass 1: Open-State Selection

Ask the compaction agent to output:
- `remain_open`: canonical file/directory keys to keep open after compaction
- `close`: canonical file/directory keys to close after compaction

The system prompt for this pass must clearly state:
- injected file blocks already exist and do not need to be rewritten verbatim (if remaining open)
- the goal is to preserve working state efficiently, not duplicate file content
- Files that do not remain open can be summarized or ommitted.

### Pass 2: Summary Generation

Generate compacted summary from full context with explicit guidance:
- include decisions, constraints, and active tasks
- avoid copying large file contents that remain open
- reference open keys by path rather than re-summarizing their entire body

Persist a `compaction` turn with this summary text.

### Pass 3: Synthetic Reopen Turns

In the same database transaction as compaction, append synthetic
`tool_response` turns with:
- `state_context_json` contains one `read` operation record for the reopened key
- actor set to synthetic context restorer identity

Transactional requirement:
- One atomic transaction must include:
  - compaction summary turn insert
  - all synthetic reopen turn inserts
  - thread tail update to the final reopen turn (or compaction turn if none)
- If any insert/update fails, rollback entire compaction pass.

Ordering requirement:
- sort reopen keys topologically by directory depth:
  - parent directories first
  - then children
  - lexical tie-break inside same depth

Resulting turn order after compaction:
1. `compaction` summary turn
2. synthetic reopen turns for all remaining-open state keys

When replaying backward from tail, runner sees reopen state turns first and then
the compaction boundary, producing the intended post-compaction context.

## Crash/Restart Continuation

After restart:

- Queue lock reset still occurs at startup.
- If a thread tail is `tool_call` or `tool_response`, runner resumes continuation
  before taking new user requests for that thread.
- Any partially finished tool loop is continued from persisted turns, not from
  in-memory event buffers.

## Commit And CAS Rules

For each state-machine transition:

- Read `threads.tail_turn_id` in transaction.
- Require expected tail match (CAS).
- If the transition appends one turn, insert that turn with
  `prev_turn_id = current_tail`.
- If the transition appends a batch, insert each new turn in order, chaining
  each `prev_turn_id` to the previously inserted turn.
- Update `threads.tail_turn_id` to the last inserted turn ID for that
  transition.
- Commit once for the whole transition.

If CAS fails:
- abort that transition append
- reload tail/context
- continue safely from authoritative ledger state

## Thread Blocking Rule

While a thread is mid-tool-loop (`tail.turn_type` in `tool_call`, `tool_response`):

- Do not claim or execute queued user request rows for that thread.
- Other threads remain runnable and should continue processing normally.

## Transport Compatibility

Even with internal loop changes:

- websocket stream behavior stays best-effort
- client contract remains unchanged
- handshake/sync still rehydrates from committed turns

Provider-facing reconstruction rule:
- Any assistant tool-request payload like `tool_calls` is derived from the
  `tool_call` turn's stored JSON list rather than from old side tables.

Transport replay rule:
- Live websocket delivery and handshake replay both expose the persisted
  `tool_call` turn itself as one assistant visible turn carrying the full
  ordered `tool_calls` list.
- The later final `assistant_message` must not repeat the same `tool_calls`
  batch.
