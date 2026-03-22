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
