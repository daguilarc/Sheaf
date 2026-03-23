# Addendum

## Purpose

This addendum explains the delta between the current single-tool-call
assumptions and the corrected model now required by the `memory_model` quest:
one `tool_call` turn may carry multiple requested tool calls as a JSON list.

## Behavioral Correction

The old spec incorrectly assumed that one assistant generation could request at
most one tool call.

The corrected model is:

- One assistant generation may request zero or more tool calls.
- If tools are requested, the request payload is an ordered JSON list of tool
  call records.
- A single requested tool call is still represented as a JSON list with one
  element.
- One assistant tool-request move appends exactly one `tool_call` turn.
- That `tool_call` turn stores the full ordered JSON list of requested calls.
- The next state-machine move executes the entire pending tool-call list
  sequentially.
- Each tool response is still persisted as its own turn.
- All tool responses for that batch are appended together in one transaction.

## Required Implementation Delta

### 1. Accept Ordered Tool-Call Lists

Where the current runtime expects one tool-call object, change it to accept an
ordered JSON list of tool-call objects.

Implementation expectations:

- Remove any protocol validation that rejects multiple tool calls from one
  generation.
- Treat the list order as execution order.
- Reject an empty list only when the generation is explicitly in the
  tool-request branch.

### 2. Persist One `tool_call` Turn Per Assistant Request

The database model remains turn-based, but one assistant move must now append
exactly one `tool_call` turn even when it requests multiple tool calls.

Implementation expectations:

- Persist the full ordered JSON list on one `tool_call` turn.
- Do not fan one assistant request out into multiple `tool_call` turns.
- Commit that single `tool_call` turn in one transaction as the output of that
  generation step.

### 3. Execute Pending Tool Calls From One Request Turn

The runtime currently treats `tail = tool_call` as "execute exactly one tool
call."

That behavior must change to:

- Load the ordered tool-call list from the pending `tool_call` turn for the
  current request.
- Execute those calls sequentially in stored order.
- Append the resulting `tool_response` turns in one transaction.
- Keep exactly one `tool_response` turn per requested call.
- Persist that response turn's full state-context metadata on the same row
  rather than emitting synthetic extra turns for additional state mutations.
- Roll back the whole response batch if any call in that batch fails before the
  transaction commits.

## 4. Keep Transport Replay Consistent With Persisted Turns

There are two different consumers here, but they should observe the same
assistant move boundaries.

Provider-facing reconstruction:

- When turns are reconstructed into assistant tool-request messages for the next
  model call, one `tool_call` turn should become one assistant message
  containing one ordered `tool_calls` JSON list.
- The matching `tool_response` turns for that batch must remain a contiguous
  block of `tool` messages immediately after that assistant tool-request
  message.
- State-context injections derived from those responses must come only after the
  full contiguous `tool` block, never between sibling tool responses.

Websocket and handshake delivery:

- When sending committed turns to the client, deliver the persisted `tool_call`
  turn itself as one assistant turn carrying the full ordered `tool_calls`
  list.
- Deliver the later final `assistant_message` as a plain assistant turn without
  repeating those same `tool_calls`.
- Handshake replay and live websocket delivery must use the same visible-turn
  shape so the client does not render duplicate tool-call bubbles.

## 5. Update State-Machine And Transaction Assumptions

The corrected move structure is:

1. Generation move:
   - append `user_message` if needed
   - call model
   - append either `assistant_message` or one `tool_call` turn containing the
     ordered requested tool-call list
2. Tool-execution move:
   - execute the full pending tool-call list from that `tool_call` turn
     sequentially
   - append all resulting `tool_response` turns together

Important consequence:

- One `DoWork` call still equals one state-machine move.
- A generation move appends one request turn.
- A tool-execution move may append multiple response turns atomically.

## 6. Update Tests

The existing single-call assumptions should be replaced with batch-aware tests.

Minimum coverage to add or update:

- generation result with multiple tool calls is accepted
- one persisted `tool_call` turn preserves request order inside its JSON list
- one tool step executes the full pending list sequentially
- all tool responses for one batch commit together
- provider-facing reconstruction maps one `tool_call` turn to one `tool_calls`
  list
- websocket and handshake delivery preserve the single persisted `tool_call`
  turn rather than repeating that batch on the later final assistant turn

## Non-Delta

These parts of the quest do not change:

- tool calls and tool responses are still first-class turns
- each tool response is still a separate turn
- context-state mutations still live only on `tool_response` turns
- same-thread queue gating still lasts until an `assistant_message` is committed
- compaction rules stay the same except that generation output may now be one
  `tool_call` turn containing a multi-call list
