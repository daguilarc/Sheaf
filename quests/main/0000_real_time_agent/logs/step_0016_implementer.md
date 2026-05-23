# step 16 — implementer

**thread:** sheaf_quest_0000_slice_0005_implementer

## output

# Implementer Role

You are the implementer for the current quest slice. Your job is to execute the
slice physical plan and deliver working code for that slice.

## Primary Responsibilities

- Implement the current slice according to `slices/<slice>/physicalplan/*.md`.
- Use existing APIs and patterns where appropriate.
- Keep changes clean, maintainable, and idiomatic for this repository.
- Ensure the slice is fully implemented before signaling completion.

## Implementation Expectations

- Follow the spec and physical plan as written.
- Keep scope limited to the current slice unless an explicit prerequisite is required.
- Add/update tests and validations needed to support the slice.
- Run relevant tests for the slice changes before signaling completion.
- Avoid unnecessary duplication and avoid over-generalizing abstractions.
- Remove obsolete code tied to replaced behavior unless otherwise specified.

## Completion Protocol

- Continue implementing until the full current slice plan is complete.
- When prompted:
  - If the full slice plan is complete, create `implementation_done.md` in the
    current slice directory with a brief completion summary.
  - If the slice is not fully complete, continue implementation work and do not
    create `implementation_done.md`.

## Escalation Rules

- If the physical plan cannot be completed without changing the spec, making major
  unspecified decisions, or resolving ambiguous requirements, create/update quest-root
  `human_intervention_request.md` with rationale and exit.
- If there is a critical blocker requiring human input, create/update quest-root
  `human_intervention_request.md` with clear details and exit.

## Scope Limits

- Do not modify `physicalplan_issues.md`.
- Do not mark reviewer-owned issues as `completed`.
- Do not edit role files.
- Focus on implementation artifacts for the current slice; use
  `human_intervention_request.md` only for escalation.


---

Quest Runtime Context
- Quest: main/0000_real_time_agent (Real Time Agent)
- Quest directory: /Users/joyo/Sheaf/quests/main/0000_real_time_agent
- Role: implementer
- Current slice: 0005_cli_audio_stdout
- Current slice directory: /Users/joyo/Sheaf/quests/main/0000_real_time_agent/slices/0005_cli_audio_stdout
- Quest documentation directory: /Users/joyo/conductor/docs/quest

Use the quest's `specs/` directory as the implementation specification for this quest. Use the quest documentation directory above as the stable reference for quest schemas, file formats, and workflow rules.

Quest Schemas Reference (`schemas.md`)
```markdown
# Quest Schemas

This document describes the quest runtime files Conductor reads and writes now.
Where older quests still use legacy formats, the compatibility rules are called
out explicitly.

## Quest State File

Path:

```text
<quest_dir>/state.md
```

Canonical format for active v2 quests:

```markdown
# State

- global_step: 18
- machine_name: quest
- machine_path: quests/main/0002_state_machine_abstraction
- state: ExecuteSlice
- updated_at: 2026-04-01T12:00:00Z

## Tags

- active_slice: 0001_example_slice
- quest_number: 2
- quest_slug: state_machine_abstraction
- quest_type: main
```

Rules:

- The first non-empty line is `# State`.
- The state block uses `- key: value` lines.
- Allowed state keys are `global_step`, `machine_name`, `machine_path`, `state`,
  and `updated_at`.
- Quest-root normalized state always uses `machine_name: quest`.
- `global_step` is required for committed v2 top-level quest state and increments
  once per successful top-level runner step commit.
- `machine_path` is repo-relative and points to the quest directory.
- `## Tags` is required, even when empty.
- Tags are string-to-string entries.
- The runner writes `quest_type`, `quest_number`, and `quest_slug` tags.
- During `ExecuteSlice`, `tags.active_slice` is required and must be a slice
  directory name such as `0001_example_slice`.
- Outside `ExecuteSlice` and `PrepareNextSlice`, `active_slice` is omitted.

Compatibility:

- Readers also accept the legacy quest format:

```markdown
# Quest State

state: ExecuteSlice
current_slice: 1
updated_at: 2026-04-01T12:00:00Z
active_slice: 0001_example_slice
global_step: 18
```

- `read_quest_state` auto-detects the format by heading.
- `create_quest` still scaffolds new quests with the legacy `# Quest State`
  layout.
- Once the v2 runner commits a top-level step, it rewrites quest-root `state.md`
  in normalized form.

Supported quest filesystem states:

- `PrePlanning`
- `PhysicalPlanning`
- `ReviewPhysicalPlan`
- `ExecuteSlice`
- `QuestDocumenting`
- `Completed`

The quest machine also uses `PrepareNextSlice` internally, but that logical node
does not persist as a distinct quest filesystem state.

## Slice State File

Path:

```text
<slice_dir>/state.md
```

Format:

```markdown
# Slice State

state: NotStarted|Implementing|PolishingReview|PolishingFix|Done
updated_at: <ISO-8601 UTC timestamp>
```

Rules:

- Slice state files remain in the legacy key/value format.
- The first non-empty line is `# Slice State`.
- The runner persists only the filesystem states above.
- The recursive slice machine also uses logical nodes such as `SliceSetup` and
  `Completed`, but those map onto the persisted slice states rather than changing
  the file schema.

## Step Commit Metadata

Each successful top-level runner step for the canonical v2 runner creates one git
commit whose message carries recursive state-machine metadata.

Commit message shape:

```text
quest-step: 18
state-machine-path: quests/main/0002_state_machine_abstraction
node: ExecuteActiveSliceNode
state-before: ExecuteSlice
state-after: ExecuteSlice

recursive-snapshot-json:
{
  "global_step": 18,
  "snapshot": {
    "child": {
      "child": null,
      "machine_name": "slice",
      "machine_path": "quests/main/0002_state_machine_abstraction/slices/0001_example_slice",
      "node_name": "SliceImplementingNode",
      "role": "implementer",
      "state_after": "Implementing",
      "state_before": "Implementing",
      "tags": {},
      "thread_name": "repo_quest_0002_slice_0001_implementer"
    },
    "machine_name": "quest",
    "machine_path": "quests/main/0002_state_machine_abstraction",
    "node_name": "ExecuteActiveSliceNode",
    "state_after": "ExecuteSlice",
    "state_before": "ExecuteSlice",
    "tags": {
      "active_slice": "0001_example_slice",
      "quest_number": "2",
      "quest_slug": "state_machine_abstraction",
      "quest_type": "main"
    }
  }
}
```

Rules:

- `quest-step` must equal JSON `global_step`.
- Header `state-machine-path`, `node`, `state-before`, and `state-after` must match
  the root JSON snapshot.
- The JSON payload must be pretty-printed multi-line JSON after the
  `recursive-snapshot-json:` marker.
- `snapshot.child` recursively represents nested machine execution for a slice step,
  or `null` for a quest-only step.
- `role` and `thread_name` appear when the step executed an agent-backed node.
- If metadata validation fails, the runner writes
  `logs/commit_metadata_validation_*.md`, creates
  `human_intervention_request.md`, and does not commit the step.
- On a noop top-level step with no filesystem changes, the runner skips the commit
  and does not increment `global_step`.

Compatibility:

- Older quests may still rely on `state_history.md` and older transition commit
  titles.
- Dashboard history readers merge commit metadata with `state_history.md` and prefer
  metadata when the same commit appears in both sources.

## Issue Response Files

Responder-written records of how open reviewer issues were handled. These files are
separate from reviewer-owned issue lists (`physicalplan_issues.md`,
`polishing_issues.md`).

Paths:

```text
<quest_dir>/physicalplan_issue_responses.md
<slice_dir>/polishing_issue_responses.md
```

Write authority:

- `physicalplan_issue_responses.md`: `physical_planner` only.
- `polishing_issue_responses.md`: `polisher` only for the current slice.

Read authority:

- `physical_plan_reviewer` must read `physicalplan_issue_responses.md` when
  verifying open physical plan issues.
- `polisher_reviewer` must read `polishing_issue_responses.md` when verifying open
  polishing issues.

Reviewers must not create, edit, or delete entries in either responses file.

Full normative schema: [`schemas/issue-responses.md`](schemas/issue-responses.md).

## Issue Files

Paths:

```text
<quest_dir>/physicalplan_issues.md
<slice_dir>/polishing_issues.md
```

Format:

```markdown
# Issues

## Issue QP-0001

- status: open|completed
- owner_role: physical_plan_reviewer|polisher_reviewer
- created_at: <ISO-8601 UTC timestamp>
- updated_at: <ISO-8601 UTC timestamp>
- title: <short title>
- details: <markdown text>
- resolution_notes: <markdown text or none>
```

Rules:

- `status` may only be `open` or `completed`.
- Reviewer roles are the only roles allowed to mark issues `completed`.
- `details` and `resolution_notes` may span multiple lines.
- `resolution_notes: none` means the field is unset.

## State History Files

Paths:

```text
<quest_dir>/state_history.md
<slice_dir>/state_history.md
```

Format:

```markdown
# State Transition History

## 2026-03-29T00:00:00Z

- previous_state: <state name>
- next_state: <state name>
- commit: <git commit hash>
- thread_name: <thread name or none>
- notes: <short summary>
```

Current behavior:

- `create_quest` still scaffolds quest-root `state_history.md`.
- Slice scaffolding still creates slice `state_history.md`.
- The canonical v2 runner does not append new transition rows for top-level step
  history.
- Older quests and older runner paths may still contain authoritative history rows,
  and dashboard readers continue to support them.

## Thread Registry

Path:

```text
<quest_dir>/thread_registry.json
```

Format:

```json
{
  "implementer": {
    "thread_name": "myrepo_quest_0002_slice_0001_implementer",
    "harness_kind": "cursor",
    "provider_thread_id": "provider-thread-id",
    "pass_id": 0,
    "round_count": 3,
    "created_at": "2026-03-29T00:00:00Z",
    "last_used_at": "2026-03-29T00:00:00Z"
  }
}
```

Current naming:

- Quest-scoped v2 roles use `<repo>_quest_<quest_number:04d>_<role>`.
- Slice-scoped v2 roles use
  `<repo>_quest_<quest_number:04d>_slice_<slice_number:04d>_<role>`.
- Older threads may still use the legacy slug-based pattern
  `<repo>_quest_<quest_slug>_<role>_0`.

## Execution Config

Path:

```text
<quest_dir>/state_execution_config.yaml
```

Shape:

```yaml
version: 2
harnesses:
  claude_code:
    cli_path: /path/to/claude
profiles:
  implementer:
    harness: cursor
    model: composer-2
    reasoning_effort: high
    idle_timeout_seconds: 3600
    modify_allow:
      - "$currentQuest/human_intervention_request.md"
      - "$currentSlice/implementation_done.md"
      - "$currentSlice/notes/**"
    modify_block:
      - "**"
```

Rules:

- `profiles` keys are role names.
- Allowed harness values are `codex`, `cursor`, and `claude_code`.
- `reasoning_effort` is optional. When present, it must be a string.
- `version: 2` adds optional per-profile `modify_allow` and `modify_block`
  repo-root-relative glob lists.
- `modify_allow` may use only `$currentQuest` and `$currentSlice`.
- `modify_block` must not contain `$` placeholders.
- When both lists match the same path, allow wins.
- The runner refuses to invoke a harness when the target repository working tree is
  not fully clean, including untracked files.
- After each harness turn, the runner compares the repository to the pre-turn
  snapshot, reverts changes outside the role's allowed paths, records those reverts
  in the step log, and sends a follow-up in the same thread telling the agent to
  continue within its allowed paths.
- `version: 1` configs keep legacy behavior: no path-rule enforcement and empty
  parsed allow/block lists.

## Human Intervention Request

Path:

```text
<quest_dir>/human_intervention_request.md
```

Minimum content:

```markdown
# Human intervention requested

**Reason:** <short reason>

<details>
```

Presence of this file blocks further automatic quest progress until a human resolves
the condition.

## Implementer Completion Marker

Path:

```text
<slice_dir>/implementation_done.md
```

Purpose:

- Signals that the implementer believes the full current slice plan is complete.
- The runner advances out of `Implementing` only when this file exists.

## Physical Plan Acceptance Marker

Path:

```text
<quest_dir>/physicalplan_accepted.md
```

Purpose:

- Signals that `physical_plan_reviewer` found no remaining open physical plan issues
  and accepts the quest-level plan review.
- The runner advances out of `ReviewPhysicalPlan` only when this file exists and
  `physicalplan_issues.md` has no open entries.

## Implementation Acceptance Marker

Path:

```text
<slice_dir>/implementation_accepted.md
```

Purpose:

- Signals that `polisher_reviewer` found no remaining open polishing issues and
  accepts the current slice implementation.
- The runner advances the slice to logical completion only when this file exists and
  `polishing_issues.md` has no open entries.
```

Task:
Implement the plan described in `0005_cli_audio_stdout/physicalplan/`. Keep working until the full plan is complete. When the full plan is complete, create `implementation_done.md` in this slice with a brief completion summary.The user requests implementation of slice 0005_cli_audio_stdout for a quest.Implementing slice `0005_cli_audio_stdout`. Reading the physical plan and existing codebase context.
I need to thoroughly examine the existing realtime-agent app structure, including cli.ts, agent_loop.ts, and package files.Good, `onEvent` and `onConversationEvent` are already available in AgentStartConfig.No audio packages are available in the repository at this time.I need to select an audio package.

I need to choose an audio package that supports device selection and CLI argument parsing. Options include `naudiodon` for PortAudio bindings, `node-record-lpcm16` using sox, or `@discordjs/voice` which isn't suitable for CLI. I'll use Node's built-in `util.parseArgs` for CLI parsing to avoid additional dependencies.

For audio input, `naudiodon` is the best option as it lists input devices, supports device selection by ID, outputs raw PCM data, and works on macOS. Although it may require native compilation, it's suitable for real microphone usage. I'll implement `audio_input.ts` as injectable for testing purposes.I need to implement the `stdout_logger.ts` file with a `logEventLine` function.

The `tool_sets.ts` file will contain a static map of tools and logic to resolve tool names. The `audio_input.ts` file will handle microphone capture using an injectable fake source for testing purposes. The `cli.ts` file will implement the full command-line interface using Node 20's built-in `util.parseArgs` for argument parsing, avoiding external dependencies. For audio input, `naudiodon` will be used, but it can be mocked for testing environments where real audio hardware isn't available. The structure for `audio_input.ts` will support both real and fake audio sources.

The `AudioFrameSource` or `MicrophoneCapture` interface defines methods for starting, stopping, and handling audio frames. The `createMicrophoneCapture(options)` function initializes audio capture using `naudiodon`. A `listInputDevices()` function provides device listing for the `--list-input-devices` flag. Audio resampling is included when necessary, and frame chunking supports real-time APIs with typical 20100ms audio chunks.

I'll use 2400 samples (4800 bytes) for 16-bit PCM audio at 24kHz sample rate. The implementation plan for audio_input.ts includes defining constants, interfaces for devices and options, and a capture interface with start and stop methods.I need to create the data/initial-context.md file for the manual test example, as the physical plan references it.I'll create `data/initial-context.md` at the repository root because the spec example expects `data/initial-context.md` to be located at the repo root when running from the root directory.

For `tool_sets.ts`, I'll include an echo tool for demo safety and an empty default when no tools are specified. The default can be an empty tools array when no `--tool` flags are provided, but only if the CLI supports explicit tool selection.

Unknown tools will trigger a clear CLI error before any connection attempts. I'll support both repeatable and comma-separated `--tool` arguments, such as `--tool echo --tool ping` or `--tool echo,ping`.

The CLI structure will be split into `cli.ts` as the entry point that calls `runCli(process.argv)`.Checking naudiodon API and whether it installs on this system:
nauddion outputs int16 PCM with a 16-bit sample format.

I'll use channelCount: 1, sampleRate: 24000, and framesPerBuffer for chunking. For resampling, I'll implement a simple resampler in audio_input.ts for when we read at different rates, though naudiodon might fail if 24000 isn't supportedso we could try 44100 and resample.

For tests, I'll avoid loading naudiodon directly in test paths by using a fake audio source instead.

The architecture includes:
1. `audio_input.ts`:
   - Constants: SAMPLE_RATE 24000, FRAME_BYTES etc
   - `PcmFrameProcessor` - accumulates bytes and emits base64 frames
   - `ResampleInt16Mono` - if needed

- `ListInputDevices()` filters naudiodon's getDevices for input devices with maximum input channels greater than zero.
- `ResolveInputDevice(spec?: string)` matches audio input devices by ID or name.
- `CreateMicrophoneCapture(options)` returns an `AudioCapture` instance for microphone input.
- `CreateFakeAudioCapture(frames: Buffer[] | string[])` provides a mock audio capture for testing purposes.

`stdout_logger.ts` exports `logEventLine`, which logs structured events as JSON lines to standard output without appending.

`tool_sets.ts` defines `KNOWN_TOOLS` containing an echo tool, and includes functions to build tool call sets and validate tool names against known tools.I will now implement all the files.

I will structure cli.ts with proper imports and handle CLI options from the physical plan. The runCli function will exit with non-zero code when session ends due to connection loss, while the agent_loop already handles finalization on close. I need to wire up event logging with logEventLine for all events including tool calls, and decide whether to use onEvent or onConversationEvent for logging, with the default conversation callback delegating to the logger for CLI runs.

The CLI should set `onEvent: logEventLine` wrapped, avoiding duplicate logs from `onConversationEvent`. The `event_router` calls both callbacks, so only `onEvent` needs to be set, or `onConversationEvent` can be set to `undefined` while `onEvent` uses the logger. If only `onEvent` is set, conversation events will still trigger `onEvent` in the router.

For connection loss, the client closes and `FinalizeSession` occurs, but the CLI continues running until `SIGINT` is received.

The CLI should detect connection loss and exit with a non-zero code, relying on the library's `connection_lost` finalization. Since `RealtimeAgentSession` does not expose a session end promise, the plan is to extend `agent_loop` with an `onSessionEnded` callback, using the existing pattern of extending start configuration with hooks. This ensures consistent exit behavior on connection loss.

I could add `onSessionEnded?: (reason: string, session: SessionRow) => void;` to AgentStartConfig to handle session closure events. However, since `onEvent` already exists and the physical plan mentions extending the start config with event hooks for stdout logging, I'll leverage the existing `onEvent` callback instead of adding new hooks. This approach avoids scope creep while ensuring proper session end handling through the existing event system.

For connection loss exit, I will add an `onSessionEnded` callback to `AgentStartConfig` to handle session closure events, ensuring the CLI exits with a non-zero code on connection loss. This involves updating `agent_loop.ts` and `types.ts` to support the new hook and calling it from `FinalizeSession`.

The implementation will register `onSessionEnded` in `FinalizeSession` and wire it up during session startup in `startAgentSession`, maintaining consistency with existing event handling patterns. This minimal change enables proper CLI exit behavior without exposing `m_sessionsRepo` externally or requiring complex socket wrapping logic.

For graceful shutdown, the CLI will stop audio, end the session, close the database, and exit with code 0 on SIGINT. The main flow parses arguments, lists input devices if requested, validates the API key, loads files, builds the tool set, opens the database, starts the agent session with event logging and session end handling, initializes audio capture, waits for shutdown signals or session end, and performs cleanup. A promise is used to await SIGINT/SIGTERM or session termination.

```typescript
let session: RealtimeAgentSession;
let audio: AudioCapture;
let exiting = false;
```

The CLI will shut down gracefully on SIGINT or SIGTERM by stopping audio, ending the session, closing the database, and exiting with code 0. For connection loss, it will exit with code 1. The shutdown function prevents duplicate executions, and signals are handled to ensure cleanup. Dynamic imports are used for naudiodon to avoid loading native modules during tests.Implementing slice files: creating core modules, then CLI and tests.
Now I need to add onSessionEnded to both types and agent_loop.Now write cli.ts - a substantial file.The main detection in cli.ts might be incorrect.

The standard ESM pattern for detecting main execution uses `fileURLToPath` to compare `import.meta.url` with `process.argv[1]`. The compiled output path may differ from the source path, so using `fileURLToPath` ensures accurate detection of whether the current module is being run directly.

The main module check in cli.ts needs to be fixed to properly detect direct execution using `fileURLToPath`. The original implementation with shebang now runs Main during tests, which should be avoided.

For testing purposes, when `registerSignalHandlers` is false, `RunCli` must either expose a shutdown function or return the session object so that tests can call shutdown manually.

Integration tests with SIGINT can be handled by either setting `registerSignalHandlers: true` and emitting SIGINT, or calling `session.stop` directly.

Integration-style tests verify SIGINT/SIGTERM cleanup by using fake agent sessions and testing stop/finalize behavior. A lower-level `RunCliSession` should be exported to return handles for testing, or dependencies should be mocked with fake `startSession` and manual shutdown. For CLI lifecycle tests, `RunCli` with `registerSignalHandlers: false` and fake dependencies can be used, but it returns immediately without waiting. Therefore, `RunCli` needs refactoring to return a controller when `registerSignalHandlers` is false.

The CLI implementation should export `StartCliRuntime` to return handles for shutdown control and `RunCli` to wrap it with signal handling. This allows tests to start a session, verify it's running, then shut it down manually. The refactored approach enables better test coverage for CLI lifecycle management and signal handling without relying on automatic shutdowns.Fixing the CLI main-module check and refactoring for testability:
I'll refactor to export CliRuntime with a shutdown method for tests.Create tests and update package.json.The CLI test needs fixing because the StartCliRuntime shutdown test incorrectly wraps the session, causing the runtime.session to retain the original stop instead of the updated one.Need to fix TypeScript errors.Two issues exist: first, a fake microphone with intervalMs set to 0 only emits the first frame because setTimeout(0) does not execute synchronously.

Fix the fake microphone to emit all frames synchronously when interval is 0, or adjust the test to handle this case properly.

The CLI entry point executes Main() during import because process.argv[1] in tests points to the test file path, causing fileURLToPath to compare incorrect paths. The main check should ensure that the script path matches the entry path correctly.

The CLI entry point incorrectly uses `fileURLToPath` on `process.argv[1]`, which may be a plain path instead of a `file://` URL, causing errors. The fix ensures `fileURLToPath` is only used on valid file URLs, not plain paths.Fixing the CLI main-module check and fake microphone capture behavior.
The CLI test imports cli.js, which may execute Main if paths align. However, since argv[1] is cli.test.js instead of cli.js when running node --test on cli.test.js, this should prevent unintended execution.The CLI integration tests contain a race condition where startSession mock calls startAgentSession, creating a socket asynchronously, while OpenConnectedSocket is invoked after awaiting startPromise, potentially completing before the socket is fully established.Need to close the socket during shutdown to prevent async activity after testswhen the session stops, the client must close.

The issue occurs because startAgentSession leaves the connection open, causing the websocket to access the database after shutdown has closed it. During shutdown, database.close() executes before the session's connection_lost handler, leading to an "database connection is not open" error. The fix involves ensuring the session is fully stopped and its socket closed before closing the database in tests. The shutdown process already calls session.stop which closes the client, so this should prevent the error. The order of shutdown operations needs to be verified to ensure proper cleanup sequence.

1. Database close should happen after all session handlers have finished
2. Session stop must fully terminate connections before database shutdown
3. Connection_lost handlers should not execute after database is closedPerhaps the fake socket emits a close event asynchronously.

After the test ends, the system attempts to end the session again on a closed database. For CLI tests, use `CleanupPersistenceTestContext` or ensure the socket doesn't emit events after shutdown. The agent loop tests do not exhibit this issue, suggesting that the fake socket is not being closed in tests, causing a pending timer to fire a "connection lost" event when the database closes. To fix this, close the fake socket explicitly during test cleanup after a successful shutdown test.When session.stop is invoked, it closes the client, which in turn closes the socket.StartCliRuntime passes sessionDeps without including webSocketFactory.

StartCliRuntime does not pass webSocketFactory despite context.deps containing it. The function only forwards apiKey, safetyIdentifier, and database, omitting webSocketFactory. To resolve this, StartCliRuntime should accept an optional webSocketFactory in CliRunDeps and include it when calling startAgentSession.Fix duplicate database closure issues where shutdown closes the database and CleanupPersistenceTestContext attempts to close it again.

The test shutdown closes the database, but the context retains a reference to it. Cleanup should only remove the temporary directory, as the database is already closed.The shutdown test fails because the database is closed before getSession is called.

The shutdown test fails because the database is closed before getSession is called. The fix involves reading the session row before shutdown or using the session from the stop() return value. Currently, shutdown returns a number (exit code) instead of a session row, so the test should query the session before shutdown. Alternatively, shutdown could be changed to return the SessionRow.

The test can be fixed by calling `runtime.session.stop("sigint")` directly and asserting on the returned session row, rather than testing shutdown() directly. This approach captures the result from stop inside shutdown and returns it, or tests the session.stop call before shutdown for assertion purposes. The simplest fix is to await the stop call and assert that the ended row's ended reason equals "sigint".

To address the issue, extend the shutdown method to return the session row, allowing tests to verify the session state after shutdown. Alternatively, simplify the test by reading the session ID before shutdown and using in-memory assertions to confirm the stop reason and audio status, removing the need for a post-shutdown getSession query.All tests pass. Creating the completion marker.
Slice `0005_cli_audio_stdout` is implemented and marked complete.

## What was delivered

**CLI (`apps/realtime-agent/src/cli.ts`)** — Replaces the slice 0001 stub with a full command:
- Required `--prompt-file` and `--context-file`
- Optional `--model` (default `gpt-realtime-2`), repeatable/comma `--tool`, `--input-device`, `--list-input-devices`, `--safety-identifier`
- Requires `OPENAI_API_KEY`; clear errors for missing key, unknown tools, and file/read failures
- SIGINT/SIGTERM stop microphone capture and finalize the session

**Supporting modules**
- `stdout_logger.ts` — JSON lines with `session_id`, `direction`, `event_type`, `event`; skips `input_audio_buffer.append`
- `tool_sets.ts` — Static `echo` tool and explicit tool selection
- `audio_input.ts` — 24 kHz PCM via `naudiodon`, device list/resolve, frame chunking, fake capture for tests

**Library tweak** — `onSessionEnded` on `AgentStartConfig` so the CLI can exit on `connection_lost`.

**Docs & data** — Updated READMEs, added `data/initial-context.md` and `apps/realtime-agent/data/.gitkeep`.

## Validation

All **58 tests** pass (`npm run build` && `npm test` in `apps/realtime-agent`).

Manual run from repo root:

```bash
export OPENAI_API_KEY="your-key"
make build-realtime-agent
realtime-agent \
  --prompt-file prompts/system-prompts/basic_realtime_conversation_v1.md \
  --context-file data/initial-context.md \
  --model gpt-realtime-2
```

Completion marker: `quests/main/0000_real_time_agent/slices/0005_cli_audio_stdout/implementation_done.md`

