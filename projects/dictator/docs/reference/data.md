# Dictator Data

Runtime data lives at the Sheaf repository root under `data/dictator/`. It is git-ignored.

## Directory layout

```text
data/dictator/
  interactions/
    YYYY-MM-DD-HH.jsonl
```

Each hourly file contains newline-delimited JSON envelopes. The service appends one envelope per dictation interaction.

## Interaction record shape

Each stored line is a `dictation_interaction` envelope:

| Field | Description |
|-------|-------------|
| `schema_version` | Envelope schema version |
| `event_type` | Always `dictation_interaction` |
| `recorded_at` | ISO-8601 timestamp |
| `payload.id` | Interaction UUID |
| `payload.occurred_at` | Interaction timestamp |
| `payload.whisper_output` | Raw STT transcript |
| `payload.final_output` | Refined or inserted text |
| `payload.mode` | Pipeline mode (`revision`, `raw_dictation`, `text_replacement`, `talon_lite`) |
| `payload.system_prompt_path` | Prompt file used for refinement |
| `payload.system_prompt_body` | Prompt body snapshot |
| `payload.model` | Model name used for refinement |
| `payload.provider` | Provider identifier (`openai`, `ollama`, etc.) |
| `payload.optional_context` | Client-supplied context key/value map |
| `payload.edit_summary` | Short refinement summary |
| `payload.uncertainty_flags` | Pipeline uncertainty markers |
| `payload.fallback_used` | Whether provider fallback ran |
| `payload.error_message` | Failure message when status is failed |
| `payload.timings` | `transcribe_ms`, `refine_ms`, `insert_ms`, `total_pipeline_ms` |

The web UI `GET /api/interactions` and `GET /api/interactions/{id}` endpoints expose the same fields for operational review.

## Buffer policy

`interactions_buffer_bytes` in `config/dictator.json` controls:

- the in-memory ring buffer size
- how many bytes of historical files are loaded at startup

Older interactions drop from memory when the buffer is exceeded. On-disk files are append-only and are not truncated automatically.

## Generated runtime data policy

- Interaction JSONL files are runtime output only.
- iOS host diagnostics (`host_diagnostics.log`) stay in the app group on device; they are not written under `data/dictator/`.
- Crash logs, `.env`, and local `secrets.json` files from the external Dictator repository were not migrated.

## Model binary policy

Speech-to-text uses a whisper.cpp model file referenced by `stt_model_path` in `config/dictator.json` (default `models/ggml-base.en.bin` relative to the repo root). Model binaries are not vendored inside `projects/dictator/`; install them locally and keep large binaries out of git.
