# Turn Schema

## Intent

Define the replacement schema contract for the chat memory model. This spec
intentionally edits canonical `CREATE TABLE` statements directly rather than
describing `ALTER TABLE` migration steps.

## Replacement Rule

- Existing server chat database content is disposable.
- Old chat/tool-call schema is removed.
- New schema is created fresh from updated `CREATE TABLE` statements.

## `turns` Table (Replacement)

```sql
CREATE TABLE turns (
    id TEXT PRIMARY KEY,                          -- UUID
    thread_id TEXT NOT NULL,                      -- parent thread UUID
    prev_turn_id TEXT NULL,                       -- null for first turn in thread
    turn_type TEXT NOT NULL,                      -- user_message, assistant_message, tool_call, tool_response, compaction
    actor_name TEXT NOT NULL,                     -- user/assistant/tool-name/compactor identity
    message_text TEXT NOT NULL,                   -- visible text or structured result text
    tool_call_id TEXT NULL,                       -- correlates one tool_response to one requested call inside prior tool_calls_json
    tool_name TEXT NULL,                          -- set for tool_response turns
    tool_calls_json TEXT NULL,                    -- serialized ordered tool-call list on tool_call turns
    state_context_json TEXT NULL,                 -- serialized ordered state-context operation list on tool_response turns
    stats_json TEXT NULL,                         -- optional usage and metadata payload
    model_name TEXT NULL,                         -- model used for assistant/tool planning turns
    created_at TEXT NOT NULL,                     -- ISO-8601 UTC timestamp
    FOREIGN KEY (thread_id) REFERENCES threads(id) ON DELETE CASCADE,
    FOREIGN KEY (prev_turn_id) REFERENCES turns(id),
    FOREIGN KEY (model_name) REFERENCES models(name),
    CHECK (prev_turn_id IS NULL OR prev_turn_id <> id),
    CHECK (
        turn_type IN (
            'user_message',
            'assistant_message',
            'tool_call',
            'tool_response',
            'compaction'
        )
    ),
    CHECK (
        (turn_type = 'tool_response' AND tool_name IS NOT NULL)
        OR (turn_type <> 'tool_response' AND tool_name IS NULL)
    ),
    CHECK (
        (turn_type = 'tool_call' AND tool_calls_json IS NOT NULL)
        OR (turn_type <> 'tool_call' AND tool_calls_json IS NULL)
    ),
    CHECK (
        (turn_type = 'tool_response' AND tool_call_id IS NOT NULL)
        OR (turn_type <> 'tool_response' AND tool_call_id IS NULL)
    ),
    CHECK (
        state_context_json IS NULL
        OR turn_type = 'tool_response'
    )
);
```

## Required Column Semantics

- `turn_type` is execution-authoritative and must drive runner behavior.
- `actor_name` replaces speaker-only assumptions:
  - `user_message`: end-user identifier (existing logical user identity)
  - `assistant_message`: assistant identity
  - `tool_call`: assistant identity (the agent requested the call batch)
  - `tool_response`: tool name (per user requirement)
  - `compaction`: compaction subsystem identity (for example `compactor`)
- `tool_calls_json` stores the exact ordered JSON list of requested tool calls
  for that `tool_call` turn.
- Each element of `tool_calls_json` includes the requested tool-call identity,
  tool name, and arguments for one requested call.
- At the model/protocol boundary, assistant tool requests are represented as an
  ordered JSON list of tool call records. Persistence stores that list on one
  `tool_call` turn rather than fanning it out into multiple request turns.
- `message_text` on tool-response turns stores tool result text (or serialized
  response text) that should become available to context reconstruction.
- `state_context_json` stores the exact ordered JSON list of state-context
  operations emitted by that `tool_response` turn.
- Each state-context operation record includes:
  - `context_type`: `file` or `directory`
  - `key`: canonical operated path
  - `operation`: `read`, `close`, or `rename`
  - `target_key`: rename destination when `operation = rename`
- `state_context_json` is allowed only on `tool_response` turns.

## Removed Fields

- `turn_context` is removed from `turns`.
- Context is reconstructed from linked-list traversal at runtime.

## State Context Operations In Turns

Each relevant tool response records an ordered JSON list of normalized
state-context operations in `state_context_json`:

- `read`: marks a file or directory state as active for context injection.
- `close`: marks a file or directory state as closed so context builder excludes
  it.
- `rename`: remaps one key to another key so older references resolve to the
  latest key during backward walk.
- `delete_path` should emit `close` so deleted contexts are not retained as open.

One requested tool call still yields exactly one `tool_response` turn. If a
single tool call affects multiple state keys, that single response row carries
multiple state-context operation records in `state_context_json` rather than
emitting synthetic extra tool-response rows.

## Tool Call Batch Semantics

One generation step may request one or more tool calls.

- The request payload is an ordered JSON list of tool call records.
- The runtime persists that list on exactly one `tool_call` turn.
- The next tool-execution step executes the requested calls sequentially in list
  order and appends exactly one `tool_response` turn for each requested call in
  order.
- No unrelated turn types may interleave inside the immediately-following
  `tool_response` batch for that request turn.

## Removed Tables

- Legacy tool-call-specific tables are deleted entirely.
- Any data previously persisted there must be represented as `tool_call` and
  `tool_response` turn rows.

Implementation note:
- This includes removing old read/write code paths that query or populate those
  legacy tables.

## Indexes

```sql
CREATE INDEX idx_turns_thread_created
    ON turns(thread_id, created_at);

CREATE INDEX idx_turns_prev_turn
    ON turns(prev_turn_id);

CREATE INDEX idx_turns_thread_type_created
    ON turns(thread_id, turn_type, created_at);

CREATE INDEX idx_turns_tool_call_id
    ON turns(tool_call_id);

```

## Context Reconstruction Contract

When building model context for a thread:

1. Start from `threads.tail_turn_id`.
2. Walk `prev_turn_id` backwards.
3. Include each visited turn in reconstruction order.
4. Stop when first `compaction` turn is encountered (include it, then stop).
5. Reverse to chronological order before generating model input.

This makes compaction turns durable context boundaries.

Context reconstruction also applies `state_context_json` operation semantics while
walking turns so file/directory context snapshots are derived at runtime.

Compaction-specific expectation:
- A compaction pass appends one `compaction` summary turn followed by synthetic
  `tool_response` reopen turns (`state_context_json` contains `read`) for contexts
  that remain open.

## Invariants

- `threads.tail_turn_id` always points to the latest committed turn.
- `prev_turn_id` chain always stays within the same `thread_id`.
- One `tool_call` turn represents one ordered tool-request batch from one
  assistant move.
- A contiguous run of `tool_response` turns committed by the next tool-execution
  transition represents the ordered results for that pending request batch.
- `tool_response.tool_call_id` must reference one requested call entry from a
  prior `tool_calls_json` payload in the same thread.
- No mixed old/new schema runtime behavior is supported.
