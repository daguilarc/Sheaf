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
    tool_call_id TEXT NULL,                       -- correlates tool_call <-> tool_response
    tool_name TEXT NULL,                          -- set for tool_call and tool_response turns
    tool_arguments_json TEXT NULL,                -- serialized tool args on tool_call turns
    state_context_type TEXT NULL,                 -- file | directory for state-context operations
    state_context_key TEXT NULL,                  -- canonical path key being operated on
    state_context_operation TEXT NULL,            -- read | close | rename
    state_context_target_key TEXT NULL,           -- rename destination key
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
        (turn_type IN ('tool_call', 'tool_response') AND tool_name IS NOT NULL)
        OR (turn_type NOT IN ('tool_call', 'tool_response') AND tool_name IS NULL)
    ),
    CHECK (
        (turn_type = 'tool_call' AND tool_arguments_json IS NOT NULL)
        OR (turn_type <> 'tool_call' AND tool_arguments_json IS NULL)
    ),
    CHECK (
        (turn_type IN ('tool_call', 'tool_response') AND tool_call_id IS NOT NULL)
        OR (turn_type NOT IN ('tool_call', 'tool_response') AND tool_call_id IS NULL)
    ),
    CHECK (
        state_context_type IS NULL
        OR state_context_type IN ('file', 'directory')
    ),
    CHECK (
        state_context_operation IS NULL
        OR state_context_operation IN ('read', 'close', 'rename')
    ),
    CHECK (
        (state_context_operation IS NULL AND state_context_type IS NULL AND state_context_key IS NULL AND state_context_target_key IS NULL)
        OR (state_context_operation IS NOT NULL AND state_context_type IS NOT NULL AND state_context_key IS NOT NULL)
    ),
    CHECK (
        (state_context_operation = 'rename' AND state_context_target_key IS NOT NULL)
        OR (state_context_operation <> 'rename' AND state_context_target_key IS NULL)
    ),
    CHECK (
        state_context_operation IS NULL
        OR (state_context_operation IS NOT NULL AND turn_type = 'tool_response')
    )
);
```

## Required Column Semantics

- `turn_type` is execution-authoritative and must drive runner behavior.
- `actor_name` replaces speaker-only assumptions:
  - `user_message`: end-user identifier (existing logical user identity)
  - `assistant_message`: assistant identity
  - `tool_call`: assistant identity (the agent requested the call)
  - `tool_response`: tool name (per user requirement)
  - `compaction`: compaction subsystem identity (for example `compactor`)
- `tool_arguments_json` stores the exact tool-call arguments payload that was
  executed.
- `message_text` on tool-response turns stores tool result text (or serialized
  response text) that should become available to context reconstruction.
- `state_context_*` columns are set only for turns that represent a context
  state operation and are allowed only on `tool_response` turns.
- `state_context_key` stores the operated file/directory key.
- `state_context_target_key` is used only for rename operations.

## Removed Fields

- `turn_context` is removed from `turns`.
- Context is reconstructed from linked-list traversal at runtime.

## State Context Operations In Turns

Each relevant tool response records one normalized state context operation in
the `turns` row:

- `read`: marks a file or directory state as active for context injection.
- `close`: marks a file or directory state as closed so context builder excludes
  it.
- `rename`: remaps one key to another key so older references resolve to the
  latest key during backward walk.
- `delete_path` should emit `close` so deleted contexts are not retained as open.

This makes context-state evolution durable and replayable from the turn chain.

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

CREATE INDEX idx_turns_state_context
    ON turns(thread_id, state_context_type, state_context_key, created_at);
```

## Context Reconstruction Contract

When building model context for a thread:

1. Start from `threads.tail_turn_id`.
2. Walk `prev_turn_id` backwards.
3. Include each visited turn in reconstruction order.
4. Stop when first `compaction` turn is encountered (include it, then stop).
5. Reverse to chronological order before generating model input.

This makes compaction turns durable context boundaries.

Context reconstruction also applies `state_context_*` operation semantics while
walking turns so file/directory context snapshots are derived at runtime.

Compaction-specific expectation:
- A compaction pass appends one `compaction` summary turn followed by synthetic
  `tool_response` reopen turns (`state_context_operation = read`) for contexts
  that remain open.

## Invariants

- `threads.tail_turn_id` always points to the latest committed turn.
- `prev_turn_id` chain always stays within the same `thread_id`.
- `tool_response` turn for a `tool_call_id` must reference a prior
  `tool_call` turn in same thread.
- No mixed old/new schema runtime behavior is supported.
