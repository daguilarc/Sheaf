## Context

Codex native subagents expose a narrow parent-facing interface: spawn returns an
agent id and nickname, wait returns a final `completed` string, and parent
follow-up can be sent to the same subagent thread. Tool calls, raw command
output, and reasoning are intentionally suppressed from the parent thread unless
the child summarizes them.

The standalone `xagent` CLI should bring that interaction style to Codex, Pi,
Cursor, and Claude Code without requiring a daemon. The parent agent can start a
long-running process, read JSONL output as turns complete, and write additional
JSONL commands to stdin for follow-up.

Existing Sheaf code provides useful prior art but does not own this interface:

- `quest-runner-agent-harness` runs batch workflow steps and logs provider
  JSONL.
- `quest-runner-chat-stream` maps existing logs into AGUI.
- `sheaf-chat-agui-mapping` maps Pi events into a UI event vocabulary.

`xagent` should be a separate project because its primary consumer is a parent
agent shell process, not quest-runner or Sheaf Chat.

## Goals / Non-Goals

**Goals:**

- Provide one Node CLI for four harnesses: `codex`, `pi`, `cursor`, and
  `claude_code`.
- Keep the live protocol as stdio JSONL with a blocking long-lived process.
- Make `--subagent` output closely match Codex native subagent visibility:
  final answers and actionable failures, not routine tool noise.
- Provide `--full` for debugging and adapter development.
- Define exact input and output schemas before implementation.
- Preserve offline logs for review, replay, and debugging.

**Non-Goals:**

- No daemon, socket server, live `list`, live `follow-up`, or live `cancel`
  command in the first version.
- No authentication setup; harnesses are assumed to be installed and logged in.
- No attempt to expose every provider-specific feature in the normalized schema.
- No AGUI UI integration in the first implementation, though the event model
  should not block a later mapper.

## Decisions

### Use a long-lived blocking stdio process

`xagent run` stays attached to stdin/stdout until it receives `control.exit` or
EOF. This lets parent agents perform follow-up by writing another JSONL command
to the same shell session, avoiding a daemon and avoiding provider-specific
resume commands for the normal path.

Alternative considered: `xagent start`, `xagent follow-up`, `xagent wait`, and
`xagent cancel` backed by a server. That would support cross-process control but
adds process ownership, stale socket cleanup, auth boundaries, and another
failure mode. The first version does not need it.

### Keep only two visibility modes

The CLI supports `--subagent` and `--full`. The old working name `--parent` is
not used. `--subagent` is intentionally lossy on stdout and resembles Codex
native subagent output. `--full` emits normalized events plus raw provider
payloads.

Alternative considered: independent `--json`, `--text`, `--debug`, and
`--raw` flags. That would make the CLI harder for parent agents to call
correctly. Two modes keep the contract crisp.

### Normalize to xagent events, not AGUI

The stdout schema is an xagent-specific event union. It is smaller than AGUI and
closer to provider process control: session, turn, message, tool, status, error,
raw provider, and session end. A future mapper can transform xagent events into
AGUI if needed.

Alternative considered: emit AGUI directly. AGUI is good for UI rendering, but
it is not a natural control protocol for parent-agent stdio.

### Adapter boundary

Each harness adapter owns provider invocation and raw event parsing, then emits
normalized xagent events:

- Codex: prefer SDK when it provides the needed stream and thread control;
  otherwise use `codex exec --json` and resume support.
- Pi: use the local `pi` CLI and preserve provider thread continuity through
  xagent's long-lived stdin contract plus provider resume support where needed.
- Cursor: use `cursor-agent --print --output-format stream-json`, with
  `--stream-partial-output` when available.
- Claude Code: use `claude --print --output-format stream-json`, with partial
  messages enabled when available.

Every adapter also exposes a capability record: whether `--model` is forwarded,
whether `--thinking-level` is forwarded, and whether streaming deltas are
available. Unsupported options produce warning `status` events instead of
hard failure.

### Debounce subagent deltas aggressively

`--subagent` may emit `message.delta`, but never as raw token/chunk passthrough.
Adapters buffer assistant deltas and release a coalesced `message.delta` at most
once every 1500 ms, or sooner only when a provider turn is ending. The final
`message.completed` remains authoritative. This keeps parent-agent output close
to native Codex subagent behavior while still allowing long-running turns to
show occasional progress.

Alternative considered: stream every provider text delta. That creates too much
parent-thread noise and works against the subagent goal of reducing context
pollution.

### Logging is offline-first

Each run gets a durable run directory under repo-local `data/xagent/` with
metadata, normalized JSONL, and raw provider JSONL. `xagent list` and
`xagent logs <run_id>` read those files only. They do not need a live process
registry.

Alternative considered: maintain a process registry and show live status. That
would require a daemon or lock-file heuristics. Offline-only listing is simpler
and honest.

## Risks / Trade-offs

- Harness stream schemas may drift → Keep adapters narrow, preserve raw provider
  logs, and test with recorded fixture streams for each harness.
- Some harnesses may not support true live follow-up over a single child process
  → The adapter can keep provider thread continuity internally and submit later
  stdin turns using provider-native resume where needed, while preserving the
  xagent stdio contract.
- `--subagent` may hide useful diagnostics → Always write full logs to disk and
  include concise failure detail in `turn.failed`.
- Raw logs may contain sensitive information → Apply the same redaction policy
  to stdout and persisted logs unless explicitly marked unsafe in a future
  developer-only mode.
- Cursor and Claude option names may vary by installed version → Probe the
  binaries at startup, fail clearly when required streaming modes are missing,
  and keep version-specific parsing behind adapter tests.

## Migration Plan

This is a new project and has no migration requirement. Rollback is deleting or
not invoking `projects/xagent`; existing quest-runner and Sheaf Chat behavior
remains unchanged.

## Open Questions

- None.
