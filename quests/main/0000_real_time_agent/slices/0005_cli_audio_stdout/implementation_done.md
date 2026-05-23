# Implementation complete: 0005_cli_audio_stdout

## Summary

Slice `0005_cli_audio_stdout` implements the runnable `realtime-agent` CLI on top of the existing library.

- Replaced the slice 0001 placeholder CLI with full argument parsing (`util.parseArgs`), file loading, model default (`gpt-realtime-2`), tool selection scaffolding, and `OPENAI_API_KEY` validation.
- Added `stdout_logger.ts` for structured JSON stdout lines (skipping `input_audio_buffer.append`).
- Added `tool_sets.ts` with a minimal static tool map (`echo`) and unknown-tool errors before connect.
- Added `audio_input.ts` with 24 kHz PCM capture via `naudiodon`, device listing/selection, frame chunking, resampling helper, and injectable fake capture for tests.
- Wired graceful shutdown on SIGINT/SIGTERM and connection-loss handling via `onSessionEnded` on the agent session.
- Added CLI, audio, and stdout logger tests; updated `apps/realtime-agent/README.md`, root `README.md`, `data/initial-context.md`, and package dependencies.

## Validation

- `npm run build` and `npm test` pass in `apps/realtime-agent` (58 tests).
