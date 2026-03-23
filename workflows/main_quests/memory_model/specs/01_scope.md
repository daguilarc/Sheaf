# Scope

## Quest

- Name: `memory_model`
- Created: `2026-03-22`

## Summary

Replace the current chat persistence system with a new turn-centric memory model
where tool calls, tool responses, normal messages, and compactions are all
stored as first-class turns in a single linked-list structure.

This quest is a full replacement, not an upgrade path. Existing server chat
history, old chat tables, and old chat execution assumptions are disposable.

## Hard Constraints

- No schema/data migration for old chat history.
- No replay/upgrade compatibility work for old transcripts.
- Implementation is not complete until the old chat persistence path is deleted.
- After rollout, the server database is expected to be reset and started fresh.
- The external UI and Obsidian client/server protocol behavior remains unchanged.

## Goals

- Define a single canonical `turns` model that includes:
  - user/assistant message turns
  - assistant tool call turns
  - tool response turns
  - compaction turns
- Allow one assistant generation step to request an ordered batch of one or more
  tool calls, represented on a single `tool_call` turn as a JSON list of tool
  call records.
- Remove dedicated tool call/result tables and move their durable fields onto
  `turns`.
- Remove stored `turn_context` from `turns`; rebuild context by linked-list walk
  at execution time.
- Update worker (`DoWork`) behavior so execution continues through tool loop
  turns and queued user requests are blocked while a thread is mid-tool-loop.
- Model filesystem context state changes as turn-level operations (`read`,
  `close`, `rename`) for files and directories.
- Preserve current transport/API/UI contract by adapting server internals only.

## Required Outcomes

- A new `turn_type` field exists on `turns` and is used by execution logic.
- Tool requests are persisted in `turns` on `tool_call` turns as ordered JSON
  lists of tool call records.
- Tool response identity uses tool name as the actor for tool-response turns.
- One generation transition may append one `tool_call` turn containing multiple
  requested tool calls as one ordered JSON list.
- One tool-execution transition executes the full requested tool-call list
  sequentially and appends all resulting `tool_response` turns together in one
  atomic transaction.
- Tool responses persist their own state-context metadata directly on the same
  row as an ordered JSON list of context operations.
- File/directory tool responses return compact state metadata instead of raw
  file contents or full directory listings.
- New close-context tool calls are available to explicitly close file/directory
  context state without deleting data.
- `delete_path` must close corresponding context state so deleted paths are not
  retained as open context.
- Compaction output is persisted as a `compaction` turn and context walks stop at
  the nearest compaction turn.
- Compaction runs after full-context reconstruction and writes synthetic reopen
  turns for keys that remain open.
- Runner logic no longer treats tool calls as out-of-band metadata detached from
  turn history.
- Provider-facing assistant tool requests are reconstructed from one
  `tool_call` turn as one ordered JSON list of tool calls, and transport
  delivery preserves that same single visible assistant turn instead of
  repeating the batch on the later final assistant reply.
- Provider-facing prompt reconstruction must keep the `tool` messages for one
  assistant tool-call batch contiguous before any derived state-context
  injection blocks are appended.
- Legacy tool call tables and legacy chat model code paths are deleted.

## Non-Goals

- Redesigning Obsidian chat UI rendering behavior.
- Changing wire contract shape between client and server.
- Preserving backward compatibility with old server DB files.
- Building a one-off migration utility for old chat records.

## Answered Questions

- Tail terminology: `threads.tail_turn_id` is the canonical pointer to the
  newest committed turn. No `head` terminology should be used in this model.
- A single model generation may request multiple tool calls as one ordered JSON
  list.
- One assistant tool-request move appends exactly one `tool_call` turn, and that
  turn contains the full ordered JSON list of requested tool calls.
- Each resulting tool response is still persisted as its own turn, and the
  multiple `tool_response` turns for one requested batch commit atomically.
- Compaction is represented as its own turn type, not as a tool call.
