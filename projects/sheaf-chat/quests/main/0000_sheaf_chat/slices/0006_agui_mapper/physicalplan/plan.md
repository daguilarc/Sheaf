# Slice 6: Pi-To-AGUI Mapping

## Objective

Map Pi session events and Sheaf Chat control/activity events into AGUI-compatible events and message snapshots for browser rendering and history replay.

Expected outcome:

- Known Pi event forms map to AGUI text, reasoning, tool, run lifecycle, cancellation, and error events.
- User messages accepted by Sheaf Chat produce equivalent AGUI text message events.
- Model changes, path enforcement activity, lifecycle status, and unrecognized Pi events are preserved as sanitized custom/RAW activity events rather than dropped.
- Mapper output validates against `structure/schemas/ag_ui_events.schema.json` where the schema supports the event type.

## Key Files And Systems

- `projects/sheaf-chat/src/agui/mapper.ts`
- `projects/sheaf-chat/src/agui/snapshots.ts`
- `projects/sheaf-chat/src/agui/schemaValidation.ts`
- `projects/sheaf-chat/tests/agui/`
- `structure/schemas/ag_ui_events.schema.json`
- Existing reference mapper: `projects/quest-runner/src/quest_runner_service/agui_mapper.py`
- Existing mapping notes: `projects/quest-runner/docs/reference/agui-mapping.md`

## Existing APIs To Reuse

- Existing Python mapper behavior as semantic reference, not as a runtime dependency unless TypeScript proves impractical.
- Shared AGUI reducer accepted snapshot shapes in `projects/web/src/agui-chat.js`.
- Node JSON schema validation library if already present; otherwise add a small dev dependency such as `ajv` only in this slice and lock it.

## APIs To Extend Or Modify

- Add `mapPiEventToAgui(event, context): AguiEvent[]`.
- Add `mapUserMessageToAgui(message): AguiEvent[]`.
- Add `mapSheafActivityToAgui(activity): AguiEvent`.
- Add `eventsToSnapshots(events)` or equivalent history snapshot builder accepted by `agui-chat.js`.
- Add sanitizer helpers for secrets and absolute host paths.

## Implementation Notes

- Prefer TypeScript mapping to keep the backend Node-only. Only choose Python subprocess/module reuse if the Pi event model is too unstable to map directly, and document the boundary in the code.
- Preserve `rawEvent` on mapped events for debugging after redacting secrets and relativizing root-contained paths.
- Required mapped surfaces: user text, assistant text start/content/end, reasoning/thinking deltas, tool call start/arguments/result/end, run/turn start and finish, cancellation, errors, path enforcement activity, model changes, and lifecycle status.
- For unrecognized Pi events, emit an AGUI `RAW` or custom activity event with sanitized payload and stable labels so future fixtures can add first-class mapping.
- Snapshot generation should deduplicate by message/tool IDs and preserve sequence ordering from storage/history.

## Validation

- Fixture tests for representative Pi events, including events from the spec-listed Pi JSONL fixture if copied in slice 2 or this slice.
- Schema validation tests against `structure/schemas/ag_ui_events.schema.json` for all supported AGUI event types.
- Snapshot compatibility tests using the message shapes accepted by `projects/web/src/agui-chat.js`.
- Tests for sanitizer behavior on secrets, absolute paths inside root, and absolute paths outside root.
