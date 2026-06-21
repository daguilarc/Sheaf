## Why

Parent agents need a simple way to run cross-harness subagents without learning
Codex, Pi, Cursor, and Claude Code provider-specific CLIs or SDK event streams.
The first version should match Codex native subagent behavior closely: concise
parent-facing output by default, explicit follow-up over the same process, and
full provider detail available only when requested.

## What Changes

- Add an `xagent` Node CLI that launches one long-lived harness session and
  reads newline-delimited JSON commands from stdin.
- Support all four harnesses in the first version: `codex`, `pi`, `cursor`,
  and `claude_code`, assuming each harness is already authenticated.
- Support exactly two output verbosity modes:
  - `--subagent`: Codex-subagent-like parent output with final assistant text,
    lifecycle readiness, failures, and no routine tool result spam.
  - `--full`: complete normalized events plus raw-provider preservation for
    debugging and audit.
- Require `--harness`; support optional `--model` and `--thinking-level`.
- Keep live control in-process through stdin rather than a daemon: the process
  remains open after a turn, emits a ready event, and accepts the next input
  line as a follow-up.
- Add offline-only run logs and listing support by writing JSONL run files; no
  live `list`, `follow-up`, or server API is part of this change.
- Define the exact stdin command schema and stdout event schema for the supported
  interface.

## Capabilities

### New Capabilities

- `xagent-cli`: A standalone cross-harness subagent runner CLI, its supported
  flags, stdio protocol, normalized event schema, verbosity modes, harness
  adapters, logging, and offline inspection commands.

### Modified Capabilities

- None.

## Impact

- Adds a new project under `projects/xagent/` with a Node/TypeScript CLI.
- Adds dependencies needed to invoke or integrate with Codex, Pi, Cursor, and
  Claude Code. CLI-backed harnesses may be implemented by spawning installed
  binaries; Pi may use the installed package API when practical.
- Produces JSONL logs under repo-local `data/xagent/` for offline `list` and log
  inspection.
- Does not change quest-runner, Sheaf Chat, or existing agent-harness specs.
