# Decisions

- 2026-03-22: Main quest created.
- 2026-03-22: This quest is a full replacement of chat memory internals; no old
  chat history migration or replay compatibility will be implemented.
- 2026-03-22: Tool calls and tool responses are modeled as first-class turns in
  `turns`, and legacy tool-call tables are removed.
- 2026-03-22: `turn_context` is removed from `turns`; context is reconstructed by
  walking `prev_turn_id` backwards until a `compaction` turn boundary.
- 2026-03-22: Filesystem context is modeled as turn-level state operations
  (`read`, `close`, `rename`) persisted on `turns` with file/directory keys.
- 2026-03-22: Context-building uses backward-walk state resolution so effective
  file/directory keys are injected once and close/rename semantics are honored.
- 2026-03-22: Only `tool_response` turns may mutate state context fields.
- 2026-03-22: `delete_path` emits context close state; close-context tools are
  added to close files/directories without deleting filesystem data.
- 2026-03-22: Compaction is multi-pass: build full context first, then compact,
  then append synthetic reopen turns for remain-open keys.
- 2026-03-22: The runtime now collapses internal `tool_call` and
  `tool_response` turns back into assistant `tool_calls` payloads at the
  transport boundary so the existing client contract stays stable.
- 2026-03-22: OpenAI tool-call execution moved out of the dispatcher and into
  the server runtime so each tool step can be committed as first-class turns.
- 2026-03-22: Runtime validation enables SQLite foreign-key enforcement on each
  connection so turn-chain conflicts fail during commit instead of silently
  accepting invalid `prev_turn_id` references.
- 2026-03-22: State-context mutations are planned from tool intent before
  filesystem writes run, and each real `tool_response` persists its full
  ordered state-context metadata on the same row so one real tool call never
  needs synthetic extra response turns for additional touched paths.
- 2026-03-22: Compaction now runs an explicit open-state selection pass before
  summary persistence; invalid selector output falls back to keeping currently
  open state rather than dropping context blindly.
- 2026-03-22: `DoWork` is defined as a one-transition state machine. Non-final
  steps leave the queue row in place for continuation, and unrelated threads
  may still run between those continuation steps.
- 2026-03-22: If compaction triggers before a generation step, the
  `compaction` turn, synthetic reopen turns, and the next model output commit
  atomically in a single transaction.
- 2026-03-23: Human approved a polishing-stage spec correction: one model
  generation may request multiple tool calls as one ordered JSON list. Runtime
  persists that ordered list on exactly one `tool_call` turn, executes the full
  pending list in the next `DoWork` transition, appends all resulting
  `tool_response` turns together in one transaction, reconstructs provider-facing
  assistant `tool_calls` from that single request turn, and still fans out
  websocket tool requests one object/message per call.
- 2026-03-23: Addendum implementation stores `tool_calls_json` only on
  `tool_call` turns, keeps `tool_name`/`tool_call_id` only on
  `tool_response` turns, reconstructs pending assistant tool requests from one
  batched request turn, and resets only the server SQLite database afterward
  because this quest explicitly does not attempt upgrade compatibility.
- 2026-03-23: Provider-facing prompt reconstruction must keep the contiguous
  `tool` response block for one assistant `tool_calls` message intact; derived
  state-context injections may appear only after the full response batch so the
  OpenAI request sequence remains valid for batched tool calls.
- 2026-03-23: Live websocket delivery and handshake replay should expose the
  persisted `tool_call` batch as exactly one assistant visible turn and must
  not copy those same `tool_calls` onto the later final `assistant_message`,
  otherwise the client renders duplicate tool-call bubbles.
- 2026-03-22: Human approval was given to transition `memory_model` to
  `complete` after the implementation audit and broader verification passed.
- 2026-03-23: Committer verification treated the quest as one combined
  implementation made of two diffs: the committed WIP already on `main` and the
  remaining working-tree polishing diff. Targeted worker tests and the full
  Python pytest suite both passed against that combined state, no unresolved
  issues remained, no side quests were required, and the quest was moved to
  `complete` on that basis.
