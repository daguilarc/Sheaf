# DoWork And Runner Contract

## Intent

Define how `DoWork` executes queued user requests when tool calls and tool
responses are persisted as turns in the same thread ledger.

## Core Behavior Change

`DoWork` no longer treats tool activity as side-band metadata inside one
assistant turn. Instead, each tool step mutates the thread tail with committed
turn rows:

1. `tool_call` turn appended.
2. Tool executes.
3. `tool_response` turn appended.
4. Loop continues until assistant emits `assistant_message`.

The final assistant message ends the queued user request.

## Processing Gate For Queued User Requests

If a thread tail is `tool_call` or `tool_response`, new queued user requests for
that thread are not runnable yet. Runner must continue the in-flight assistant
execution for that same thread until an `assistant_message` turn is committed.

This prevents interleaving fresh user prompts into an unfinished tool loop.

## Runnable Work Selection Priority

`DoWork` selection order:

1. Continuation work (threads with in-flight tool loop state).
2. Fresh queued user requests whose `response_to_turn_id` matches current
   thread tail and whose thread is not in tool-loop continuation state.

Implementation requirement:
- Keep `message_queue` shape and derive continuation state from tail turn type.
- Do not introduce queue row kinds (for example `user_request` /
  `continuation`) for this quest.

## Canonical Per-Request Execution Loop

For one claimed queued user request:

1. Append committed `user_message` turn.
2. Set local execution cursor to current tail.
3. Reconstruct context by walking turns backwards to nearest compaction.
4. Call model.
5. Branch:
   - If model emits tool call:
     - append `tool_call` turn with `tool_name` and `tool_arguments_json`
     - execute tool
     - append `tool_response` turn with `actor_name = tool_name`
     - go back to step 3
   - If model emits assistant text for user:
     - append `assistant_message` turn
     - finalize request (delete queue row, send completion event)

The loop only exits when an `assistant_message` turn is committed.

## Tool Response Payload Contract For State Context

Tool outputs that affect context state must return compact metadata rather than
raw file/directory payloads in the tool result text.

Required mapping to actual tool names:

- `read_file`:
  - emits `state_context_type = file`
  - emits `state_context_operation = read`
  - emits `state_context_key = <file path>`
  - always reads full file content (no partial line-range mode)
  - does not return full file body in the tool result text
- `list_directory`:
  - emits `state_context_type = directory`
  - emits `state_context_operation = read`
  - emits `state_context_key = <directory path>`
  - does not return full directory listing in the tool result text
- `create_file` and `apply_patch`:
  - emit `state_context_type = file`
  - emit `state_context_operation = read`
  - emit `state_context_key = <target file path>`
  - this represents that latest file state should be context-available
- `move_path`:
  - emits `state_context_operation = rename`
  - emits `state_context_type = file` for file moves, `directory` for directory
    moves
  - emits `state_context_key = <source path>`
  - emits `state_context_target_key = <destination path>`
- `delete_path`:
  - emits `state_context_operation = close`
  - emits matching `state_context_type` (`file` or `directory`)
  - emits `state_context_key = <deleted path>`
  - ensures deleted contexts do not remain injected as open state

New close tools:
- Add `close_file_context` and `close_directory_context` as first-class tools.
- These tools emit `state_context_operation = close` with matching
  `state_context_type` and `state_context_key`.
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
        if turn.state_context_operation is null:
            continue

        context_type = turn.state_context_type
        context_key = turn.state_context_key
        operation = turn.state_context_operation

        if operation == "rename":
            if context_type == "directory":
                from_dir = ResolveDirectoryKey(context_key)
                to_dir = ResolveDirectoryKey(turn.state_context_target_key)
                if from_dir != to_dir:
                    dir_alias_map[from_dir] = to_dir
            else:
                from_file = ResolveFileKey(context_key)
                to_file = ResolveFileKey(turn.state_context_target_key)
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
    for turn in rows:
        context.append(BasicContext(turn))

        # Inject blocks tied to this turn directly after the turn's message.
        for canonical_key in injections_by_turn_id.get(turn.id, []):
            if state_map.get(canonical_key) != "read":
                continue
            (injection_type, injection_key) = canonical_key
            if FileOrDirectoryExists(injection_type, injection_key):
                context.append(
                    ReadFileOrDirectoryWithMetadata(
                        injection_type,
                        injection_key,
                        # Include natural language framing in injected blocks.
                        # Example: "File: /repo/a.py. This is the contents of this file: ..."
                    )
                )
            else:
                context.append(
                    "Cannot read " + injection_key + ", it may have been moved or deleted"
                )

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
- `state_context_operation = read`
- `state_context_type` and `state_context_key` from `remain_open`
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

For each appended turn in loop:

- Read `threads.tail_turn_id` in transaction.
- Require expected tail match (CAS).
- Insert new turn with `prev_turn_id = current_tail`.
- Update `threads.tail_turn_id` to new turn ID.
- Commit.

If CAS fails:
- abort that append
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

Any existing API field like `tool_calls` can be derived from contiguous
`tool_call`/`tool_response` turn segments rather than old side tables.
