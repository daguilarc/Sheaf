# Slice 0006 — Pi-To-AGUI Mapping — Implementation Accepted

## Decision

Accepted. The slice implements the Pi→AGUI mapping layer per the slice plan, with all
reviewer-raised polishing issues resolved and verified.

## Scope Reviewed

- `src/agui/mapper.ts` — stateful `PiToAguiMapper` (`Consume`/`MapEvent`/`Flush`),
  `mapPiEventToAgui`, `mapUserMessageToAgui`, `mapSheafActivityToAgui`.
- `src/agui/snapshots.ts` — `eventsToSnapshots` history builder.
- `src/agui/sanitizer.ts` — secret redaction + root-relative path sanitization.
- `src/agui/schemaValidation.ts` — AJV validation against
  `structure/schemas/ag_ui_events.schema.json`.
- `src/agui/types.ts`, `src/agui/index.ts`.
- `tests/agui/*` and `tests/fixtures/pi-sessions/*`.

## Verification Highlights

- Streaming lifecycle mapping (text/reasoning/tool-call deltas, tool-args dedup
  between `tool_call_delta` and `tool_execution_start`, run/turn lifecycle) maps to
  the expected AGUI event sequence.
- All emitted event types validate against the AGUI JSON schema (sound discriminated
  `oneOf`; extra fields permitted via `additionalProperties: true`).
- Sheaf control/activity surfaces (path enforcement, model change, lifecycle status,
  cancellation, error) and the RAW fallback for unrecognized events are covered.
- Snapshot builder dedupes by id, preserves order, and produces shapes accepted by
  `web/src/agui-chat.js` (cross-checked against the reducer in tests).
- Sanitizer redacts secrets and relativizes in-root paths / masks out-of-root paths.

## Resolved Issues

- **PL-0001** (completed) — `Flush()` emitted `RUN_FINISHED` with `threadId` set to
  the run id. Fixed to use `context.threadId`; regression test added covering a
  dangling-run flush.
- **PL-0002** (completed) — `mapPiEventToAgui` defaulted to a shared stateful
  singleton mapper. Default removed; an explicit mapper is now required (TypeError on
  omission); regression test added. The remaining `x_defaultMapper` reference is
  confined to the stateless `mapSheafActivityToAgui` path.

## Open Issues

None.
