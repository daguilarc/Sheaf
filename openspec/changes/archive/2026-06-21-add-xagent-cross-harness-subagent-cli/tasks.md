## 1. Project Setup

- [x] 1.1 Create `projects/xagent/` TypeScript package with executable `xagent` entry point.
- [x] 1.2 Add build, test, and lint-compatible scripts following existing Node project conventions in the repo.
- [x] 1.3 Add CLI argument parsing for `run`, `list`, and `logs` commands.
- [x] 1.4 Add tests for `xagent run` flag validation, including required `--harness`, exactly one of `--subagent` or `--full`, and unsupported flag rejection.

## 2. Protocol And Event Core

- [x] 2.1 Implement stdin JSONL parser for `user.message` and `control.exit`.
- [x] 2.2 Implement normalized output event types and base envelope sequencing.
- [x] 2.3 Implement output mode filtering for `--subagent` and `--full`.
- [x] 2.4 Implement aggressive `--subagent` `message.delta` coalescing with a 1500 ms minimum interval.
- [x] 2.5 Add schema/fixture tests for valid and invalid input commands.
- [x] 2.6 Add tests that `session.ready` is emitted at startup and after each completed or failed turn.
- [x] 2.7 Add tests proving `--subagent` does not pass through raw provider text deltas.

## 3. Logging And Offline Inspection

- [x] 3.1 Implement run id generation and durable run directory creation under `data/xagent/`.
- [x] 3.2 Write normalized JSONL logs and raw provider JSONL logs for every run.
- [x] 3.3 Implement secret redaction and workspace path relativization before stdout/log emission.
- [x] 3.4 Implement offline `xagent list` from persisted run records.
- [x] 3.5 Implement offline `xagent logs <run_id>` from persisted normalized logs.
- [x] 3.6 Add tests proving `list` and `logs` do not require a live server or running xagent process.

## 4. Harness Adapter Interface

- [x] 4.1 Define the common adapter interface for starting a session, submitting a turn, streaming normalized events, and closing.
- [x] 4.2 Implement capability reporting for model forwarding, thinking-level forwarding, and streaming delta support.
- [x] 4.3 Emit warning `status` events when a selected harness ignores `--model` or `--thinking-level`.
- [x] 4.4 Add adapter contract tests using fake adapters to verify turn ordering, follow-up preservation, and shutdown.

## 5. Harness Implementations

- [x] 5.1 Implement Codex adapter using the SDK or `codex exec --json`, including thread continuity across stdin turns.
- [x] 5.2 Implement Pi adapter using the local `pi` CLI, including prompt/follow-up behavior.
- [x] 5.3 Implement Cursor adapter using `cursor-agent --print --output-format stream-json` and partial output when available.
- [x] 5.4 Implement Claude Code adapter using `claude --print --output-format stream-json` and partial messages when available.
- [x] 5.5 Add recorded-stream fixture tests for all four adapters mapping provider events into normalized xagent events.

## 6. End-To-End Verification

- [x] 6.1 Add a fake harness end-to-end test that starts `xagent run`, writes two `user.message` lines to stdin, and verifies same-session follow-up behavior.
- [x] 6.2 Add a `--subagent` end-to-end test proving routine tool payloads are suppressed from stdout but preserved in logs.
- [x] 6.3 Add a `--full` end-to-end test proving raw provider events and normalized tool events are emitted.
- [x] 6.4 Run the xagent test suite and the relevant repository-level Node build/test command.
