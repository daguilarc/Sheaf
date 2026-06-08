# AGUI Event Mapping

Quest Runner can translate harness JSONL log events into AGUI events with
`quest_runner_service.agui_mapper.QuestLogToAguiMapper`.

AGUI (A-G-U-I) is the Agent User Interaction event protocol used as the common
UI event target for agent activity. Quest Runner cares about AGUI because the
runner talks to multiple harnesses (`cursor`, `codex`, and `claude_code`) whose
native event shapes differ. Mapping those harness-specific events into AGUI lets
UI code consume one normalized stream. The dashboard's read-only agent chat
transcript consumes this mapped stream through
[Agent chat UI](chat-ui.md).

## Mapper API

The mapper is importable from Python:

```python
from quest_runner_service.agui_mapper import QuestLogToAguiMapper

mapper = QuestLogToAguiMapper()
agui_events = mapper.consume(source_event)
agui_events += mapper.flush()
fallback_source_events = mapper.errors()
```

`consume(event)` accepts one quest runner JSONL event and returns zero or more
AGUI event dictionaries. The mapper is stateful: it tracks open runs, text
messages, reasoning messages, Claude content blocks, and tool calls so it can
emit balanced AGUI lifecycle events.

Quest Runner control events use the `sheaf.*` envelope prefix in `event_kind`,
for example `sheaf.run_started`, `sheaf.prompt`, `sheaf.run_completed`,
`sheaf.run_failed`, and `sheaf.path_enforcement`.

`flush()` closes any open lifecycle state at the end of a replay. Call it after
the final source event in a log stream.

`reset()` clears mapper state.

`errors()` returns source events that were understood only through the fallback
path. Fallback events are emitted as AGUI `RAW` events so data is not lost, but
their presence means a harness produced an event shape that the mapper does not
properly understand yet.

## Dashboard Chat Usage

`dashboard_chat.ChatStreamSession` creates a mapper per WebSocket connection. It
replays the selected JSONL log into AGUI events, calls `flush()` when replay is
complete, sends `caught_up`, and then maps live events delivered by the
in-process chat event bus. The browser-side chat reducer expects AGUI events in
the same shape validated by the mapper tests.

## Source And Target Schemas

Quest Runner keeps the inferred harness event schema at:

```text
structure/schemas/quest_log_events.schema.json
```

The AGUI target schema lives at:

```text
structure/schemas/ag_ui_events.schema.json
```

The mapper emits event dictionaries intended to validate against the AGUI schema.
It preserves the original source event in `rawEvent` on normalized events.

## Replay Guard

`tests.test_agui_mapper` replays the current quest log corpus from the top-level
`quests/` tree and every `projects/*/quests/` tree through the mapper. The test
validates emitted events against the AGUI schema, checks lifecycle balance after
`flush()`, and asserts that `mapper.errors()` is empty.

That final assertion is intentional. If Cursor, Codex, Claude Code, or another
harness starts generating a new event type that reaches the fallback path, the
test fails so the mapper can be updated deliberately.
