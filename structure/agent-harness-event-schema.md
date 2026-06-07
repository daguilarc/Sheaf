# Agent Harness Event Schema

Sheaf keeps a unified JSON Schema for agent harness event logs at:

```text
structure/schemas/quest_log_events.schema.json
```

The schema describes JSONL events emitted by the quest runner when it invokes
different agent harnesses, including Codex, Cursor, and Claude Code. Because
each harness emits different provider payload shapes, the schema is modeled as a
tagged union. The top-level discriminator is the pair of `harness` and
`event_kind`; nested provider payloads may use their own discriminators such as
`type` and `subtype`.

Quest Runner control events use the `sheaf.*` event-kind envelope, such as
`sheaf.run_started`, `sheaf.prompt`, `sheaf.run_completed`,
`sheaf.run_failed`, and `sheaf.path_enforcement`.

The schema is inferred from the quest log corpus rather than hand-authored. To
regenerate it, run:

```bash
python3 projects/quest-runner/src/utils/infer_quest_log_schema.py
```

The utility scans the top-level `quests/` tree and every `projects/*/quests/`
tree for `logs/*.jsonl` files, infers the unified tagged-union schema, and
writes the schema back to `structure/schemas/quest_log_events.schema.json`.
It does not save a concatenated event dataset.

## UI Event Target

AGUI defines a common UI event format in its TypeScript `@ag-ui/core` package.
Sheaf keeps a JSON Schema representation of that format at:

```text
structure/schemas/ag_ui_events.schema.json
```

That schema is hand-derived from the AGUI Zod definitions so downstream tools can
target the UI event format without depending on TypeScript.
