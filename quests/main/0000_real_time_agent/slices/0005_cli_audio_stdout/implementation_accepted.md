# Implementation Accepted: 0005_cli_audio_stdout

All physical plan requirements verified:

- CLI argument parsing covers all specified flags with correct defaults and validation.
- Prompt and context files are read and passed to the agent session config.
- OPENAI_API_KEY validated with clear error on missing key.
- Tool set scaffolding with static map, unknown-tool pre-connect errors, and comma-separated parsing.
- Audio capture via naudiodon at 24kHz PCM with frame chunking, device listing/selection, and injectable fake capture.
- Stdout logger prints structured JSON lines with session_id, direction, event_type; skips input_audio_buffer.append.
- SIGINT/SIGTERM graceful shutdown stops audio, finalizes session, closes database.
- Connection loss handled via onSessionEnded callback with non-zero exit.
- Outgoing audio append events are forwarded but not persisted and not printed.
- onEvent hook properly wired through EventRouter for both directions.
- Slice 0001 placeholder CLI replaced with full implementation.
- Tests cover argument parsing, file loading, shutdown lifecycle, stdout logging, and audio frame processing.
- README and root README updated with CLI usage and environment docs.
- Package metadata includes bin entry and naudiodon dependency.

No open polishing issues.
