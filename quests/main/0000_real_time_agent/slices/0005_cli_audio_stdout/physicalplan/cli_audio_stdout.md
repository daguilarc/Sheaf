# Physical Plan: CLI Audio and Stdout Integration

## Objective

Implement the `realtime-agent` Node CLI wrapper around the library, including prompt/context file loading, model selection, minimal tool-set selection scaffolding, microphone capture/device selection, audio frame forwarding, stdout event printing, and graceful process shutdown.

Expected outcome:

- The CLI command in the spec can start a realtime session.
- Prompt and initial context are read from files.
- `--model` defaults to `gpt-realtime-2`.
- `OPENAI_API_KEY` is required for the realtime connection and yields a clear CLI error if missing.
- Local microphone input is captured as 24kHz PCM frames and sent as `input_audio_buffer.append` events.
- Device selection is available through a CLI option supported by the selected audio package.
- Non-audio events print as structured stdout lines with session ID and event type.
- `input_audio_buffer.append` is neither printed nor persisted.
- SIGINT/SIGTERM gracefully finalize the session.

## Key Files and Systems

- Replace the temporary unavailable-runtime behavior in `apps/realtime-agent/src/cli.ts` from slice 0001.
- Add `apps/realtime-agent/src/audio_input.ts`.
- Add `apps/realtime-agent/src/stdout_logger.ts`.
- Add `apps/realtime-agent/src/tool_sets.ts` for minimal explicit-list/default scaffolding.
- Add tests under `apps/realtime-agent/test/cli/`, `test/audio/`, and `test/stdout_logger/`.
- Update `apps/realtime-agent/README.md` or create it if not present.
- Update root `README.md` quick-start details with the runnable command and required environment.
- Update package metadata dependencies for CLI argument parsing and microphone capture.

## Existing APIs to Reuse As-Is

- Reuse `startAgentSession` or `RealtimeAgentSession` from slice 0004.
- Reuse public `ToolDefinition` and `ToolCallSet` contracts from slice 0001.
- Reuse the session's `sendAudioFrame` method for audio forwarding.
- Reuse existing prompt files under `prompts/system-prompts/`.
- Reuse the repository's `data/` policy by letting the library default to `apps/realtime-agent/data/realtime-agent.sqlite`.

## APIs to Define or Extend

Define CLI options:

- `--prompt-file <path>` required.
- `--context-file <path>` required.
- `--model <model>` optional, default `gpt-realtime-2`.
- `--tool <name>` repeatable or comma-separated for explicit minimal tool selection.
- `--input-device <id-or-name>` optional.
- `--list-input-devices` optional, prints available local input devices and exits.
- `--safety-identifier <id>` optional, forwarded as `OpenAI-Safety-Identifier`.

Define minimal tool-set scaffolding:

- A default empty or demo-safe tool call set is allowed only if the CLI still supports explicit tool selection.
- If explicit tool names are provided, unknown names produce a clear CLI error before connecting.
- Do not implement the out-of-scope named registry beyond a small static map/list in `tool_sets.ts`.

Define audio capture:

- Capture microphone audio and convert/resample to PCM 24kHz if the selected package does not produce that natively.
- Chunk audio into frames appropriate for realtime `input_audio_buffer.append`.
- Base64 encode frames if the event API expects base64 audio payloads.
- Forward frames through the agent session without writing audio chunks to SQLite.
- Surface local device or permission failures as clear CLI errors.

Define stdout logger:

- `logEventLine({ sessionId, direction, event })` prints one structured JSON line or compact structured line for every non-audio event.
- Each line includes at least `session_id`, `direction`, `event_type`, and the event payload or summary.
- The logger skips events where `event.type === "input_audio_buffer.append"`.
- Default conversation callback from the library may delegate to this logger for CLI runs, but library defaults should remain usable outside the CLI.

Define process lifecycle:

- On SIGINT/SIGTERM, stop audio capture, close the realtime session, and mark the session ended.
- On fatal transport setup errors, print a clear message and exit non-zero.
- On runtime connection loss, rely on the library's `connection_lost` finalization and exit non-zero or return control consistently.

## Enabling Refactor

If `agent_loop.ts` does not expose enough event hooks for stdout logging, extend its start config with `onEvent`/`onConversationEvent` hooks rather than letting the CLI reach into transport internals. Keep audio capture isolated in `audio_input.ts` so tests can inject fake audio frames.

## Validation

- CLI argument tests verify required prompt/context validation, default model, optional model override, repeated/comma tool selection, unknown tool errors, safety identifier forwarding, and missing API key error.
- File-loading tests verify prompt and context contents are passed exactly to the agent config.
- Stdout logger tests verify non-audio events print with session ID and event type.
- Stdout logger tests verify `input_audio_buffer.append` is skipped.
- Audio tests use an injectable fake microphone source to verify frames are converted/forwarded to `sendAudioFrame`.
- Integration-style test with fake agent session verifies SIGINT/SIGTERM cleanup calls stop/finalize behavior.
- Manual validation with real credentials and microphone:
  - Run `realtime-agent --prompt-file prompts/system-prompts/basic_realtime_conversation_v1.md --context-file data/initial-context.md --model gpt-realtime-2`.
  - Speak into the selected microphone.
  - Confirm stdout prints non-audio realtime events.
  - Confirm SQLite contains session metadata, incoming events, and outgoing non-audio events.
  - Confirm SQLite does not contain outgoing `input_audio_buffer.append` events.
- `npm run build` and `npm test` pass in `apps/realtime-agent`.

## Sequencing Notes

This slice depends on slices 0001 through 0004 and completes the quest acceptance criteria. Cleanup must remove the temporary unavailable-runtime behavior from slice 0001 as part of this slice rather than leaving a second command path.
