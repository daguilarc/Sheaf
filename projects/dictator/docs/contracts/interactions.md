# Contract: Interaction Records

Shared by [dictation-pipeline](../../../../openspec/specs/dictator-dictation-pipeline/spec.md) (writes
HTTP interactions), [launchpad](../../../../openspec/specs/dictator-launchpad/spec.md) (writes
Launchpad interactions), and [web-ui](../../../../openspec/specs/dictator-web-ui/spec.md) (reads them
via `/api/interactions`). Runtime-data rules:
[Logs And Data](../../../../structure/logs-and-data.md).

## On-disk layout

```text
data/dictator/
  interactions/
    2026-06-07T16Z.jsonl      # hourly UTC buckets, format yyyy-MM-dd'T'HH'Z'.jsonl
```

`data/dictator` is the resolved `data_dir` from
[`config/dictator.json`](config.md). One JSON envelope is appended per line
per interaction (success or failure). Files are append-only runtime output
(git-ignored) and are never truncated or rotated by the service.

## Envelope format

```json
{
  "schema_version": 1,
  "event_type": "dictation_interaction",
  "recorded_at": "2026-06-07T16:04:11.512Z",
  "payload": {
    "id": "9B1DEB4D-3B7D-4BAD-9BDD-2B0D7B3DCB6D",
    "occurred_at": "2026-06-07T16:04:11.512Z",
    "whisper_output": "hello world",
    "final_output": "Hello world.",
    "mode": "revision",
    "system_prompt_path": "intent_refiner_v1.md",
    "system_prompt_body": "<full prompt text snapshot>",
    "model": "qwen2.5:7b-instruct",
    "provider": "ollama",
    "optional_context": {
      "request_source": "http",
      "session_id": "session-1",
      "request_id": "abc12345",
      "sample_rate": "16000",
      "locale": "en-US"
    },
    "edit_summary": "Refined with Ollama model.",
    "uncertainty_flags": [],
    "fallback_used": false,
    "error_message": null,
    "timings": {
      "transcribe_ms": 120,
      "refine_ms": 45,
      "insert_ms": 0,
      "total_pipeline_ms": 180
    }
  }
}
```

Field semantics:

| Field | Meaning |
|---|---|
| `payload.id` | Interaction UUID (uppercase UUID string) |
| `payload.mode` | `raw_dictation`, `revision`, `text_replacement`, or `talon_lite` |
| `payload.whisper_output` | Raw STT transcript (empty on failure records) |
| `payload.final_output` | Refined/inserted text; on failures, the error description |
| `payload.system_prompt_path` / `_body` | Prompt file used and a full body snapshot at interaction time |
| `payload.provider` / `model` | Effective refinement provider (`openai` / `ollama`) and model, post-fallback |
| `payload.optional_context` | String map: client context headers plus writer-added keys — `request_source` (`http` or `launchpad`), `session_id`, and for HTTP `request_id`, `sample_rate`, `locale`; Launchpad adds captured `selected_text` / `active_app` / `active_site` when present |
| `payload.fallback_used` | `true` when Ollama→OpenAI fallback ran; absent/`null` when unknown |
| `payload.error_message` | Set only on failure records; its presence is what the web API maps to `status: "error"` |
| `payload.timings.insert_ms` | Non-zero only for Launchpad insertions; HTTP writes `0` |

Decoding is lenient: every payload field is optional with defaults (unknown
mode → `revision`, missing model/provider → `"unknown"`, missing timings →
zeros), and malformed lines are skipped with a trace log, so partially
corrupt files never block startup.

## Buffer and startup-load policy

`interactions_buffer_bytes` ([config](config.md), default 100 MiB) bounds:

- the in-memory ring buffer — tracked size counts only
  `whisper_output + final_output + error_message` UTF-8 bytes; the oldest
  interactions evict first when the cap is exceeded (cap floor 1 byte);
- the startup reload — hourly files are selected newest-first by filename
  until the byte budget is exhausted (the newest file is always loaded),
  then decoded oldest→newest and sorted by `occurred_at` (ties by id).

The reload runs asynchronously at startup; API reads and new appends wait
for it to finish. Buffer-size changes via `PATCH /api/config` or config
reset apply immediately to the in-memory cap; disk files are unaffected.

## Code pointers

- `src/Sources/DictatorService/InteractionHistory.swift` —
  `DictationInteraction`, `DictationInteractionBuffer`,
  `InteractionHistoryStore`, `InteractionPersistence`
  (`StoredInteractionEnvelope` is the serialized form above).
- Writers: `src/Sources/DictatorService/HTTPInteractionRecorder.swift`,
  `LaunchpadServiceController.appendInteraction` /
  `appendFailedInteraction`.
- Reader: `src/Sources/DictatorService/WebAPIService.swift`
  (`interactionSummary`, `interactionDetailResponse`).
- Tests: `tests/DictatorServiceTests/InteractionHistoryTests.swift`
  (persistence round-trip, hourly naming, eviction, lenient decode),
  `WebAPITests.testInteractionsListAndDetailReadPersistedRecords`.
