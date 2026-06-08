# Slice 0006: Pi-To-AGUI Mapping — Implementation Complete

## Summary

Implemented a TypeScript AGUI mapping layer for Sheaf Chat that converts Pi `AgentSessionEvent` streams, user messages, and Sheaf control/activity events into AGUI-compatible events and history snapshots.

## Delivered

- `src/agui/mapper.ts` — stateful `PiToAguiMapper` with `mapPiEventToAgui`, `mapUserMessageToAgui`, and `mapSheafActivityToAgui`
- `src/agui/snapshots.ts` — `eventsToSnapshots` for `agui-chat.js`-compatible message snapshots
- `src/agui/sanitizer.ts` — secret redaction and root-relative path sanitization for `rawEvent` payloads
- `src/agui/schemaValidation.ts` — AJV validation against `structure/schemas/ag_ui_events.schema.json`
- `src/agui/index.ts` — module exports
- `tests/agui/` — mapper, snapshot, sanitizer, and schema validation tests
- `tests/fixtures/pi-sessions/` — streaming lifecycle fixture and spec-session header sample from the Pi JSONL referenced in the quest spec

## Validation

- `npm test` passes (84 tests), including new AGUI mapper coverage aligned with the quest-runner Python mapper semantics.

## Notes

- Mapping is Node-only TypeScript; the Python quest-runner mapper remains a semantic reference, not a runtime dependency.
- Persisted Pi session JSONL header lines (`session`, `model_change`, etc.) map to `CUSTOM` events; persisted `message` records map to completed text triplets; unrecognized events emit sanitized `RAW` events.
