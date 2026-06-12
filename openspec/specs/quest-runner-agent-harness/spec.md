# Capability: Agent Harness

Project: `projects/quest-runner`
ID prefix: `ah` — requirement IDs are append-only; never renumber or reuse.

## Purpose

Executes one workflow profile step by driving an external coding-agent CLI
(Codex, Claude Code, or Cursor) inside the target repository. This capability
owns harness selection and configuration, provider thread (conversation)
continuity via `thread_registry.json`, per-step JSONL event logging, idle and
failure handling, and post-run enforcement of each profile's path modification
rules. It also provides the Tart-based macOS agent VM toolkit used to run
agents in disposable, isolated VMs.

The [state-machine-engine](../quest-runner-state-machine-engine/spec.md) is the caller: when a
workflow state has a `run` block, the engine asks this capability to execute
that profile with a rendered task. Profile settings (harness kind, model,
timeouts, path rules, thread templates) come from
[workflow-config](../quest-runner-workflow-config/spec.md).

## Requirements

### Requirement: ah-1 — Harness selection and configuration: Instantiate named harness
WHEN a profile step runs, THE runner SHALL instantiate the harness named by the profile's `harness` key — one of `codex`, `claude_code`, `cursor` — configured from the matching entry of the `harnesses` map in `config/quest-runner.json` at the target repo root.

#### Scenario: Profile step runs
- **WHEN** a profile step runs
- **THEN** the runner instantiates the harness named by the profile's `harness` key from the `harnesses` map in `config/quest-runner.json`

### Requirement: ah-2 — Harness selection and configuration: Probe harness binary before use
THE runner SHALL probe the harness before use by executing `<cli> --version` with a 30-second timeout; IF the binary is missing, exits non-zero, or times out, THEN THE runner SHALL fail the step with a harness-not-available error (Cursor is probed with the same flag even though `create-chat` is its working entry point).

#### Scenario: Binary available
- **WHEN** the harness binary is probed with `<cli> --version` and it exits zero within 30 seconds
- **THEN** the probe passes and the step proceeds

#### Scenario: Binary missing or failing
- **WHEN** the harness binary is missing, exits non-zero, or times out during the 30-second probe
- **THEN** the runner fails the step with a harness-not-available error

### Requirement: ah-3 — Harness selection and configuration: CLI path resolution
WHERE a harness entry sets a non-empty `cli_path`, THE runner SHALL invoke that binary; otherwise it SHALL invoke the default command name on `PATH`: `claude` for `claude_code`, `codex` for `codex`, `cursor-agent` for `cursor`.

#### Scenario: cli_path configured
- **WHEN** a harness entry has a non-empty `cli_path`
- **THEN** the runner invokes that binary path

#### Scenario: cli_path absent
- **WHEN** a harness entry has no `cli_path` or an empty one
- **THEN** the runner invokes the default command name on `PATH` (`claude` for `claude_code`, `codex` for `codex`, `cursor-agent` for `cursor`)

### Requirement: ah-4 — Harness selection and configuration: Config file error handling
IF `config/quest-runner.json` is missing or has no `harnesses` key, THEN THE runner SHALL treat the harness config as empty (defaults apply); IF the file's `harnesses` map names a key that is not a valid harness kind, or an entry is not a JSON object, THEN config loading SHALL fail with an error naming the file.

#### Scenario: Config file missing or no harnesses key
- **WHEN** `config/quest-runner.json` is missing or has no `harnesses` key
- **THEN** the runner treats the harness config as empty and defaults apply

#### Scenario: Invalid harness key or entry type
- **WHEN** the `harnesses` map names a key that is not a valid harness kind, or an entry is not a JSON object
- **THEN** config loading fails with an error naming the file

### Requirement: ah-5 — CLI invocation and prompt delivery: Working directory and streams
THE runner SHALL run every harness CLI with the target repository root as working directory, stdin closed (`/dev/null`), and stderr merged into stdout.

#### Scenario: Harness CLI invoked
- **WHEN** a harness CLI is invoked
- **THEN** it runs with the target repository root as working directory, stdin closed (`/dev/null`), and stderr merged into stdout

### Requirement: ah-6 — CLI invocation and prompt delivery: Create Claude Code thread
WHEN creating a Claude Code thread, THE runner SHALL run `claude --model <model> --effort <effort> --permission-mode acceptEdits --allowedTools "Bash(scripts/quest-runner:*)" --output-format stream-json --verbose --include-partial-messages --include-hook-events --max-turns 1 -p "Session initialization only. Reply with exactly READY."` and take the first `session_id` field found in the JSONL stream as the provider thread id; IF none appears, THEN the step SHALL fail harness-not-available.

#### Scenario: Claude Code thread created successfully
- **WHEN** a Claude Code thread is created and the JSONL stream contains a `session_id` field
- **THEN** the runner takes the first `session_id` as the provider thread id

#### Scenario: Claude Code thread creation missing session_id
- **WHEN** a Claude Code thread is created and no `session_id` appears in the JSONL stream
- **THEN** the step fails harness-not-available

### Requirement: ah-7 — CLI invocation and prompt delivery: Send message on Claude Code thread
WHEN sending a message on a Claude Code thread, THE runner SHALL run the same flag set with `--resume <provider_thread_id>`, `--max-turns 100`, and `-p <message>`; `reasoning_effort` defaults to `high` when the profile leaves it null.

#### Scenario: Message sent on Claude Code thread
- **WHEN** a message is sent on a Claude Code thread
- **THEN** the runner runs the same flag set with `--resume <provider_thread_id>`, `--max-turns 100`, and `-p <message>`, with `reasoning_effort` defaulting to `high` when the profile leaves it null

### Requirement: ah-8 — CLI invocation and prompt delivery: Create Codex thread
WHEN creating a Codex thread, THE runner SHALL run `codex exec --json --model <model> -c model_reasoning_effort="<effort>" --full-auto <init prompt>` and take `thread_id` from the `thread.started` stream event; IF absent, THEN the step SHALL fail harness-not-available.

#### Scenario: Codex thread created successfully
- **WHEN** a Codex thread is created and `thread_id` is present in the `thread.started` stream event
- **THEN** the runner takes that `thread_id` as the provider thread id

#### Scenario: Codex thread creation missing thread_id
- **WHEN** a Codex thread is created and `thread_id` is absent from the `thread.started` stream event
- **THEN** the step fails harness-not-available

### Requirement: ah-9 — CLI invocation and prompt delivery: Send message on Codex thread
WHEN sending a message on a Codex thread, THE runner SHALL run `codex exec resume --json --model <model> -c model_reasoning_effort="<effort>" --full-auto <provider_thread_id> <message>`; IF the stream reports a different `thread.started.thread_id`, THEN THE runner SHALL adopt it and persist it to the thread registry.

#### Scenario: Codex message sent, same thread_id
- **WHEN** a message is sent on a Codex thread and the stream reports the same `thread.started.thread_id`
- **THEN** the thread registry entry is unchanged

#### Scenario: Codex message sent, different thread_id
- **WHEN** a message is sent on a Codex thread and the stream reports a different `thread.started.thread_id`
- **THEN** the runner adopts the new thread id and persists it to the thread registry

### Requirement: ah-10 — CLI invocation and prompt delivery: Create and send on Cursor thread
WHEN creating a Cursor thread, THE runner SHALL run `cursor-agent create-chat` and take the first non-empty stdout line as the provider thread id; WHEN sending a message it SHALL run `cursor-agent --resume <provider_thread_id> --print --yolo --model <model> --output-format stream-json --stream-partial-output <message>` (`reasoning_effort` is ignored for Cursor).

#### Scenario: Cursor thread created
- **WHEN** a Cursor thread is created
- **THEN** the runner runs `cursor-agent create-chat` and takes the first non-empty stdout line as the provider thread id

#### Scenario: Cursor message sent
- **WHEN** a message is sent on a Cursor thread
- **THEN** the runner runs `cursor-agent --resume <provider_thread_id> --print --yolo --model <model> --output-format stream-json --stream-partial-output <message>` (ignoring `reasoning_effort`)

### Requirement: ah-11 — CLI invocation and prompt delivery: First-round prompt prepending
WHEN a thread is used for the first time (registry `round_count` is 0 or the thread was just created), THE runner SHALL send `<profile prompt file text>\n\n---\n\n<message body>`; on later rounds it SHALL send only the message body. The body is the rendered workflow preamble (when configured) followed by `Task:\n<rendered task text>` (template rendering is specified in [workflow-config](../quest-runner-workflow-config/spec.md)).

#### Scenario: First round
- **WHEN** a thread is used for the first time (registry `round_count` is 0 or the thread was just created)
- **THEN** the runner sends `<profile prompt file text>\n\n---\n\n<message body>`

#### Scenario: Subsequent rounds
- **WHEN** a thread is used on a subsequent round
- **THEN** the runner sends only the message body

### Requirement: ah-12 — CLI invocation and prompt delivery: Normalize streamed JSONL output
THE runner SHALL parse the streamed JSONL back into a normalized assistant text: for Claude Code, concatenated `assistant` / `message` / `content_block_delta` text (with `thinking` text kept separately); for Codex and Cursor, the last `type: "result"` `result` string, else the last `agent_message` / extracted text chunk. Non-JSON output is passed through verbatim when no JSON was seen.

#### Scenario: Claude Code stream parsed
- **WHEN** a Claude Code harness stream is received
- **THEN** the runner concatenates `assistant` / `message` / `content_block_delta` text (with `thinking` text kept separately) into normalized assistant text

#### Scenario: Codex or Cursor stream parsed
- **WHEN** a Codex or Cursor harness stream is received
- **THEN** the runner uses the last `type: "result"` `result` string, else the last `agent_message` / extracted text chunk

#### Scenario: No JSON seen
- **WHEN** no JSON was seen in the stream output
- **THEN** non-JSON output is passed through verbatim

### Requirement: ah-13 — Thread continuity (`thread_registry.json`): Persist provider threads
THE runner SHALL persist provider threads in `<quest>/thread_registry.json` (schema in [runtime-files](../../../projects/quest-runner/docs/contracts/runtime-files.md)), keyed by the profile's rendered `thread.registry_key_template`; the registry always lives at the quest root, including for child (slice) machine steps.

#### Scenario: Provider thread persisted
- **WHEN** a provider thread is created or used
- **THEN** the runner persists it in `<quest>/thread_registry.json` keyed by the rendered `thread.registry_key_template`, with the registry always at the quest root

### Requirement: ah-14 — Thread continuity (`thread_registry.json`): Create new thread entry
WHEN the rendered registry key is absent from the registry, THE runner SHALL create a new provider thread named by the profile's `thread.name_template` and write an entry with `thread_name`, `harness_kind`, `provider_thread_id`, `pass_id` (currently always written as `0`), `round_count: 0`, `created_at`, and `last_used_at`.

#### Scenario: Registry key absent
- **WHEN** the rendered registry key is absent from the registry
- **THEN** the runner creates a new provider thread and writes an entry with `thread_name`, `harness_kind`, `provider_thread_id`, `pass_id` (always `0`), `round_count: 0`, `created_at`, and `last_used_at`

### Requirement: ah-15 — Thread continuity (`thread_registry.json`): Reuse existing thread
WHEN the key is present, THE runner SHALL reuse the recorded `provider_thread_id` without creating a provider session and SHALL update `last_used_at`.

#### Scenario: Registry key present
- **WHEN** the rendered registry key is present in the registry
- **THEN** the runner reuses the recorded `provider_thread_id` without creating a provider session and updates `last_used_at`

### Requirement: ah-16 — Thread continuity (`thread_registry.json`): Increment round count
WHEN a send completes successfully, THE runner SHALL increment the entry's `round_count` and refresh `last_used_at`; a malformed (missing or non-numeric) `round_count` is read as 0.

#### Scenario: Send completes successfully
- **WHEN** a send completes successfully
- **THEN** the runner increments the entry's `round_count` and refreshes `last_used_at`, reading a malformed `round_count` as 0

### Requirement: ah-17 — Thread continuity (`thread_registry.json`): Validate registry entry type
IF a registry entry for the key is not a JSON object, THEN THE runner SHALL fail the step with a validation error.

#### Scenario: Registry entry not a JSON object
- **WHEN** a registry entry for the key is not a JSON object
- **THEN** the runner fails the step with a validation error

### Requirement: ah-18 — Step logging and control events: Create step log file
WHEN a harness round begins, THE runner SHALL create (truncate) `<quest>/logs/step_NNNN_<profile>.jsonl`, where `NNNN` is the zero-padded step number; numbering continues from the highest existing `step_*` file in `logs/` across runner restarts, and each round (including enforcement follow-ups) gets its own file and number.

#### Scenario: Harness round begins
- **WHEN** a harness round begins
- **THEN** the runner creates (truncates) `<quest>/logs/step_NNNN_<profile>.jsonl` with a zero-padded step number continuing from the highest existing `step_*` file, each round (including enforcement follow-ups) getting its own file and number

### Requirement: ah-19 — Step logging and control events: Envelope format
THE runner SHALL wrap every log line in the envelope `{schema_version: 1, timestamp, sequence, step, role, thread, harness, provider_thread_id, event_kind, ...}` with `sequence` starting at 1 per file; the full tagged-union schema is canonical at [agent-harness-event-schema](../../../structure/agent-harness-event-schema.md).

#### Scenario: Log line written
- **WHEN** a log line is written
- **THEN** it is wrapped in the envelope `{schema_version: 1, timestamp, sequence, step, role, thread, harness, provider_thread_id, event_kind, ...}` with `sequence` starting at 1 per file

### Requirement: ah-20 — Step logging and control events: Write run_started and prompt events
WHEN a round starts, THE runner SHALL write `sheaf.run_started` (`model`, `reasoning_effort`, `stream`, `thread_key`, `quest_rel`, `slice_rel`) followed by `sheaf.prompt` (`text` = the exact message sent).

#### Scenario: Round starts
- **WHEN** a round starts
- **THEN** the runner writes `sheaf.run_started` with `model`, `reasoning_effort`, `stream`, `thread_key`, `quest_rel`, `slice_rel`, followed by `sheaf.prompt` with the exact message sent

### Requirement: ah-21 — Step logging and control events: Stream stdout lines to log
WHILE the CLI streams, THE runner SHALL append each complete stdout line as `provider.json` (`payload` = parsed JSON) or `provider.text` (`text` = raw line) for non-JSON lines; a trailing unterminated line is flushed when the process ends.

#### Scenario: CLI streaming
- **WHEN** the CLI streams stdout
- **THEN** the runner appends each complete line as `provider.json` (parsed JSON) or `provider.text` (raw line), flushing any trailing unterminated line when the process ends

### Requirement: ah-22 — Step logging and control events: Write run_completed event
WHEN the CLI process ends, THE runner SHALL write `sheaf.run_completed` with `exit_code`, `elapsed_seconds`, `idle_timeout`, and `stream_events_count`.

#### Scenario: CLI process ends
- **WHEN** the CLI process ends
- **THEN** the runner writes `sheaf.run_completed` with `exit_code`, `elapsed_seconds`, `idle_timeout`, and `stream_events_count`

### Requirement: ah-23 — Step logging and control events: Publish to ChatEventBus
THE runner SHALL publish every envelope event it writes to a step log (except the directly-appended `sheaf.path_enforcement` note, see ah-32) to in-process `ChatEventBus` subscribers keyed by the resolved log path, in write order; live delivery and AGUI mapping are specified in [chat-stream](../quest-runner-chat-stream/spec.md).

#### Scenario: Envelope event written
- **WHEN** an envelope event is written to a step log (other than `sheaf.path_enforcement`)
- **THEN** the runner publishes it to `ChatEventBus` subscribers keyed by the resolved log path, in write order

### Requirement: ah-24 — Idle timeout and failure handling: Idle timeout kill sequence
WHILE a harness CLI produces no stdout for the profile's `idle_timeout_seconds`, THE runner SHALL send the process SIGTERM, wait up to 5 seconds, then SIGKILL; the round's `sheaf.run_completed` records `idle_timeout: true`. (A timed-out process normally exits non-zero, so ah-26 then fails the round.)

#### Scenario: CLI idle beyond timeout
- **WHEN** a harness CLI produces no stdout for the profile's `idle_timeout_seconds`
- **THEN** the runner sends SIGTERM, waits up to 5 seconds, then SIGKILL, and `sheaf.run_completed` records `idle_timeout: true`

### Requirement: ah-25 — Idle timeout and failure handling: Structured error in stream
IF the provider stream contains a structured error event (`item.type == "error"`, `type == "error"`, `is_error: true`, or a non-empty `error`/`errors` field), THEN THE runner SHALL write `sheaf.run_failed` with `reason: "structured_error"` and `detail`, and fail the step immediately without retry.

#### Scenario: Structured error in stream
- **WHEN** the provider stream contains a structured error event
- **THEN** the runner writes `sheaf.run_failed` with `reason: "structured_error"` and `detail`, and fails the step immediately without retry

### Requirement: ah-26 — Idle timeout and failure handling: Non-zero exit
IF the CLI exits non-zero, THEN THE runner SHALL write `sheaf.run_failed` with `reason: "nonzero_exit"`, `exit_code`, and `detail` (status line plus captured output), and fail the step.

#### Scenario: CLI exits non-zero
- **WHEN** the CLI exits non-zero
- **THEN** the runner writes `sheaf.run_failed` with `reason: "nonzero_exit"`, `exit_code`, and `detail`, and fails the step

### Requirement: ah-27 — Idle timeout and failure handling: Transport error retry
IF a send raises a transport error (`OSError`/`TimeoutError`), THEN THE runner SHALL write `sheaf.run_failed` with `reason: "exception"`, `detail`, and the 1-based `attempt`, and retry up to 3 total attempts with exponential backoff (1s, doubling); IF retries are exhausted, THEN it SHALL write `<quest>/human_intervention_request.md` with reason `harness retries exhausted` and abort the run with a fatal invariant error.

#### Scenario: Transport error with retries remaining
- **WHEN** a send raises a transport error and fewer than 3 total attempts have been made
- **THEN** the runner writes `sheaf.run_failed` with `reason: "exception"`, `detail`, and the 1-based `attempt`, and retries with exponential backoff (1s, doubling)

#### Scenario: Transport error retries exhausted
- **WHEN** a send raises a transport error and all 3 attempts are exhausted
- **THEN** the runner writes `<quest>/human_intervention_request.md` with reason `harness retries exhausted` and aborts the run with a fatal invariant error

### Requirement: ah-28 — Idle timeout and failure handling: Surface step failures as structured error
Step failures from ah-25/ah-26 SHALL surface from the quest run as a structured harness error carrying `detail`, the raw provider output, steps executed, last commit, and the captured step-log index (see [quest-lifecycle](../quest-runner-quest-lifecycle/spec.md) for how the run result is reported).

#### Scenario: Step failure surfaces
- **WHEN** a step fails due to ah-25 or ah-26
- **THEN** the quest run surfaces a structured harness error carrying `detail`, the raw provider output, steps executed, last commit, and the captured step-log index

### Requirement: ah-29 — Path enforcement: Require clean worktree before first round
WHEN starting the first round of a profile step, THE runner SHALL require the target worktree to be clean relative to the step's base commit — no staged, unstaged, or untracked non-ignored changes — except runner-managed paths `<quest>/thread_registry.json` and `<quest>/logs/**`; IF it is not, THEN the run SHALL stop with status `dirty_workspace` without invoking the harness. Enforcement follow-up rounds only require pending changes to be legal under the profile's rules.

#### Scenario: Worktree clean before first round
- **WHEN** the target worktree is clean relative to the step's base commit (excluding runner-managed paths)
- **THEN** the runner proceeds to invoke the harness

#### Scenario: Worktree dirty before first round
- **WHEN** the target worktree has staged, unstaged, or untracked non-ignored changes (excluding runner-managed paths) before the first round
- **THEN** the run stops with status `dirty_workspace` without invoking the harness

### Requirement: ah-30 — Path enforcement: Expand path patterns
THE runner SHALL expand `modify.allow` / `modify.block` patterns by substituting `$quest`/`$currentQuest`, `$active_child`/`$currentSlice`, and `$project`/`$currentProject` with repo-relative paths, dropping patterns whose variables have no value; matching is segment-wise glob with `*` (one segment) and `**` (any segments).

#### Scenario: Path patterns expanded
- **WHEN** `modify.allow` or `modify.block` patterns are evaluated
- **THEN** the runner substitutes `$quest`/`$currentQuest`, `$active_child`/`$currentSlice`, and `$project`/`$currentProject` with repo-relative paths, drops patterns whose variables have no value, and uses segment-wise glob matching

### Requirement: ah-31 — Path enforcement: Judge changed paths
THE runner SHALL judge each path changed since the pre-send snapshot (worktree diff, index diff, and untracked files vs the snapshot commit, minus runner-managed paths) as: allow+block configured — allowed if any allow matches, else blocked if any block matches, else allowed; allow only — allowed only on an allow match; block only — allowed unless a block matches; neither — everything allowed.

#### Scenario: Allow and block configured
- **WHEN** both `modify.allow` and `modify.block` patterns are configured
- **THEN** a changed path is allowed if any allow matches, else blocked if any block matches, else allowed

#### Scenario: Allow only configured
- **WHEN** only `modify.allow` patterns are configured
- **THEN** a changed path is allowed only if an allow pattern matches

#### Scenario: Block only configured
- **WHEN** only `modify.block` patterns are configured
- **THEN** a changed path is allowed unless a block pattern matches

#### Scenario: Neither configured
- **WHEN** neither `modify.allow` nor `modify.block` patterns are configured
- **THEN** everything is allowed

### Requirement: ah-32 — Path enforcement: Revert illegal paths
WHEN illegal paths are found after a send, THE runner SHALL revert them to the pre-send snapshot (`git restore --source=<snapshot> --worktree --staged` for tracked paths; deletion for paths absent from the snapshot) and append a `sheaf.path_enforcement` event (`snapshot`, `reverted_paths`, `followup_sent: true`) to that round's step log (this append bypasses the event bus).

#### Scenario: Illegal paths found after send
- **WHEN** illegal paths are found after a send
- **THEN** the runner reverts them to the pre-send snapshot (using `git restore --source=<snapshot> --worktree --staged` for tracked paths; deletion for paths absent from the snapshot) and appends a `sheaf.path_enforcement` event to the step log, bypassing the event bus

### Requirement: ah-33 — Path enforcement: Follow-up after revert
WHEN edits are reverted, THE runner SHALL write `<quest>/human_intervention_request.md` with reason `illegal edits reverted` (a deliberate temporary brake) and SHALL send the agent a follow-up round listing the reverted paths and instructing it to finish with allowed changes only; the run stops on the intervention file before workflow state advances.

#### Scenario: Edits reverted
- **WHEN** illegal edits are reverted
- **THEN** the runner writes `<quest>/human_intervention_request.md` with reason `illegal edits reverted` and sends a follow-up round listing the reverted paths, stopping on the intervention file before workflow state advances

### Requirement: ah-34 — Path enforcement: Enforcement follow-up cap
IF enforcement follow-ups exceed 40 rounds for one profile step, THEN THE runner SHALL abort with a fatal invariant error.

#### Scenario: Follow-up cap exceeded
- **WHEN** enforcement follow-ups exceed 40 rounds for one profile step
- **THEN** the runner aborts with a fatal invariant error

### Requirement: ah-35 — Agent VM execution (`vm/agent-macos`): Makefile targets
THE project Makefile SHALL provide `agent-vm-rebuild` (reprovision the golden VM in place), `agent-vm-fresh` (delete the golden VM, re-pull the base image, and reprovision), and `agent-vm-run` (run `bin/agent-run` against `$(WORKTREE)`, defaulting to the repository root).

#### Scenario: Makefile targets available
- **WHEN** the project Makefile is invoked with `agent-vm-rebuild`, `agent-vm-fresh`, or `agent-vm-run`
- **THEN** the corresponding VM operation executes as specified

### Requirement: ah-36 — Agent VM execution (`vm/agent-macos`): agent-run boot sequence
WHEN `bin/agent-run [options] [worktree-path]` runs, THE toolkit SHALL clone the golden VM to a disposable VM (default name `agent-YYYYmmdd-HHMMSS`), randomize its MAC and serial, boot it with the configured mounts attached, mirror requested guest paths to those mounts, configure host-port access when requested, and wait for SSH; with no explicit `--mount`, the worktree (default `$PWD`) is shared as a mount named `worktree` and symlinked in the guest at its host-equal path (the underlying share is `/Volumes/My Shared Files/worktree`).

#### Scenario: agent-run invoked
- **WHEN** `bin/agent-run` runs
- **THEN** the toolkit clones the golden VM, randomizes its MAC and serial, boots it with configured mounts, mirrors guest paths, configures host-port access when requested, and waits for SSH; with no explicit `--mount`, the worktree is shared as `worktree` and symlinked at its host-equal path

### Requirement: ah-37 — Agent VM execution (`vm/agent-macos`): agent-run flags and error conditions
THE `agent-run` flags SHALL be: `--name NAME` (disposable VM name), `--golden NAME` (source golden VM, default `agent-macos-golden`), `--softnet` (Tart Softnet isolation, requires host root), `--host-only` (host-only networking, no internet), `--read-only` (mount worktree read-only), `--mount name:host-path:guest-path[:ro]` (add a named directory share and path-preserving guest symlink), `--host-port-range R` (forward guest loopback ports to host ports), `--command COMMAND` (run a shell command in the guest worktree over SSH after boot), `--keep-running` (do not stop the VM after `--command`), `-h/--help`; IF the worktree path does not exist, the golden VM is missing, a mount host path is missing, or the VM name already exists, THEN it SHALL fail with an error.

#### Scenario: All flags valid
- **WHEN** `agent-run` is invoked with valid flags and paths
- **THEN** the VM boots and runs as configured

#### Scenario: Invalid paths or duplicate VM name
- **WHEN** the worktree path does not exist, the golden VM is missing, a mount host path is missing, or the VM name already exists
- **THEN** `agent-run` fails with an error

### Requirement: ah-38 — Agent VM execution (`vm/agent-macos`): rebuild-golden provisioning
WHEN `bin/rebuild-golden [--fresh]` runs, THE toolkit SHALL create the golden VM from `BASE_IMAGE` (`ghcr.io/cirruslabs/macos-sequoia-base:latest`) if absent, apply sizing from `profile.env` (`VM_CPU=4`, `VM_MEMORY_MB=8192`, `VM_DISK_GB=100`, `VM_DISPLAY=1440x900`), and run the idempotent guest provisioners (`scripts/guest-bootstrap.sh`, `guest-sheaf-deps.sh`, `guest-agent-tools.sh` — the last installs Cursor, Codex, and Claude Code); `--fresh` first deletes the existing golden VM.

#### Scenario: rebuild-golden runs
- **WHEN** `bin/rebuild-golden` runs
- **THEN** the toolkit creates the golden VM from `BASE_IMAGE` if absent, applies sizing from `profile.env`, and runs the idempotent guest provisioners

#### Scenario: rebuild-golden --fresh
- **WHEN** `bin/rebuild-golden --fresh` runs
- **THEN** the toolkit first deletes the existing golden VM, then proceeds with rebuild

### Requirement: ah-39 — Agent VM execution (`vm/agent-macos`): SSH and clean commands
THE toolkit SHALL provide `bin/agent-ssh <vm>` to SSH into a running VM and `bin/agent-clean <vm>` to stop and delete disposable VMs; all settings in `vm/agent-macos/profile.env` (including `SSH_USER`/ `SSH_PASSWORD`, default `admin`/`admin`) are environment-overridable.

#### Scenario: agent-ssh invoked
- **WHEN** `bin/agent-ssh <vm>` is invoked
- **THEN** the toolkit SSHes into the running VM using settings from `profile.env` (environment-overridable)

#### Scenario: agent-clean invoked
- **WHEN** `bin/agent-clean <vm>` is invoked
- **THEN** the toolkit stops and deletes the disposable VM

### Requirement: ah-40 — Agent VM execution (`vm/agent-macos`): Allocate VM per worktree
WHERE `agent_vm.enabled` is true in the target repo's `config/quest-runner.json`, THE service SHALL allocate an agent VM after a quest worktree or experiment worktree is created, and SHALL record the VM association in untracked runtime data under `data/quest-runner/`; a recorded VM that still exists in Tart is reused rather than re-created.

#### Scenario: VM allocation on worktree creation
- **WHEN** `agent_vm.enabled` is true and a quest or experiment worktree is created
- **THEN** the service allocates an agent VM and records the association under `data/quest-runner/`; a recorded VM that still exists in Tart is reused

### Requirement: ah-41 — Agent VM execution (`vm/agent-macos`): Execute harness commands in VM
WHERE an agent VM is associated with the target worktree, THE harness layer SHALL execute `validate`, `create_thread`, and `send_message` commands inside that VM over SSH while preserving the existing streamed JSONL logging and idle-timeout behavior.

#### Scenario: VM associated with worktree
- **WHEN** an agent VM is associated with the target worktree
- **THEN** the harness layer executes `validate`, `create_thread`, and `send_message` inside that VM over SSH, preserving streamed JSONL logging and idle-timeout behavior

### Requirement: ah-42 — Agent VM execution (`vm/agent-macos`): Mount manifest substitutions and injection
THE VM mount manifest SHALL support `$WORKTREE` and `$HOME` substitutions in `host_path` and `guest_path`; THE service SHALL create missing configured host paths, SHALL inject a read-write `worktree` mount at the worktree's host path WHERE no mount named `worktree` is configured, and SHALL mirror every mount's guest path to its Tart shared directory with a symlink inside the disposable VM.

#### Scenario: Mount manifest processed
- **WHEN** the VM mount manifest is processed
- **THEN** `$WORKTREE` and `$HOME` are substituted in `host_path` and `guest_path`, missing configured host paths are created, a `worktree` mount is injected when none is configured, and every mount's guest path is mirrored to its Tart shared directory with a symlink

### Requirement: ah-43 — Agent VM execution (`vm/agent-macos`): Harness state directory sharing
WHERE a mount is configured for a host harness state directory (the shipped manifest mounts `$HOME/.codex`, `$HOME/.claude`, `$HOME/.cursor`, and related share/state/cache paths), THE service SHALL share it into the VM per the mount's `read_only` flag — read-write by default — so provider credentials and sessions are shared and Codex, Claude Code, and Cursor can resume conversations from either the host or the VM.

#### Scenario: Harness state directory mounted
- **WHEN** a mount is configured for a host harness state directory
- **THEN** the service shares it into the VM per the mount's `read_only` flag (read-write by default), enabling credential and session sharing between host and VM

### Requirement: ah-44 — Agent VM execution (`vm/agent-macos`): Host port forwarding
WHEN `agent_vm.host_ports` is configured and the guest's default-gateway (host) IP resolves, THE disposable VM SHALL forward guest `127.0.0.1:<port>` to the host's matching port for every configured port and SHALL write `SHEAF_HOST_IP` and `SHEAF_HOST_PORT_<port>_URL` entries into the guest's `.sheaf-agent-vm.env` (contract below).

#### Scenario: Host ports configured and gateway resolves
- **WHEN** `agent_vm.host_ports` is configured and the guest's default-gateway IP resolves
- **THEN** the VM forwards guest `127.0.0.1:<port>` to the host's matching port for each configured port and writes `SHEAF_HOST_IP` and `SHEAF_HOST_PORT_<port>_URL` into the guest's `.sheaf-agent-vm.env`

### Requirement: ah-45 — Agent VM execution (`vm/agent-macos`): Delete VM on worktree removal
WHEN a quest lands successfully or an experiment lands successfully, THE service SHALL delete the agent VM associated with the removed worktree, if one is recorded.

#### Scenario: Quest or experiment lands successfully
- **WHEN** a quest lands successfully or an experiment lands successfully
- **THEN** the service deletes the agent VM associated with the removed worktree, if one is recorded

### Requirement: ah-46 — Agent VM execution (`vm/agent-macos`): Preserve host-local execution when disabled
IF `agent_vm.enabled` is absent or false, THEN Quest Runner SHALL preserve host-local harness execution behavior.

#### Scenario: agent_vm disabled
- **WHEN** `agent_vm.enabled` is absent or false
- **THEN** Quest Runner preserves host-local harness execution behavior

### Requirement: ah-47 — Agent VM execution (`vm/agent-macos`): Auto-inject git mounts
WHEN expanding the mount manifest for a worktree whose git common dir resolves, THE service SHALL auto-inject one extra read-write path-preserving mount beyond ah-42: WHERE the worktree is a linked git worktree (its source checkout root differs from the worktree), a `source-checkout` mount of the primary checkout, unless a mount named `source-checkout` is already configured; otherwise a `git-common` mount of the git common dir, unless a mount named `git-common` is already configured — so git operations that follow the worktree's `.git` link resolve inside the guest.

#### Scenario: Linked git worktree
- **WHEN** the worktree is a linked git worktree (source checkout root differs) and no `source-checkout` mount is configured
- **THEN** the service auto-injects a read-write `source-checkout` mount of the primary checkout

#### Scenario: Non-linked worktree with resolved git common dir
- **WHEN** the worktree is not a linked git worktree and no `git-common` mount is configured
- **THEN** the service auto-injects a read-write `git-common` mount of the git common dir

### Requirement: ah-48 — Agent VM execution (`vm/agent-macos`): Failure cleanup after scaffold commit
IF worktree or agent VM creation fails after the quest scaffold commit, THEN THE service SHALL remove the partial worktree and fail the create with `Quest record was committed on the source branch but worktree or agent VM creation failed; manual cleanup may be required for <quest_dir> (commit <hash>).`; IF it fails after the experiment metadata commit, THEN THE service SHALL fail with `Experiment metadata was committed on the source branch but worktree or agent VM creation failed; manual cleanup may be required for ...` naming the experiment dir, commit, branch, and worktree path, and SHALL leave the experiment worktree in place for manual cleanup. In both paths a half-created VM is best-effort deleted via `agent-clean`.

#### Scenario: Failure after quest scaffold commit
- **WHEN** worktree or agent VM creation fails after the quest scaffold commit
- **THEN** the service removes the partial worktree, fails with the `Quest record was committed...` message, and best-effort deletes any half-created VM via `agent-clean`

#### Scenario: Failure after experiment metadata commit
- **WHEN** worktree or agent VM creation fails after the experiment metadata commit
- **THEN** the service fails with the `Experiment metadata was committed...` message naming the experiment dir, commit, branch, and worktree path, leaves the experiment worktree in place for manual cleanup, and best-effort deletes any half-created VM via `agent-clean`

### Requirement: ah-49 — Agent VM execution (`vm/agent-macos`): Source env files before VM commands
WHEN executing any harness command inside an agent VM (the service's SSH executor and `agent-run --command` alike), THE executor SHALL `source "$HOME/.zprofile"` then `source "$HOME/.sheaf-agent-vm.env"` (each tolerating absence) before changing to the guest working directory and running the command; the env file is the single canonical source of the guest `PATH` and Sheaf VM variables.

#### Scenario: Harness command executed in VM
- **WHEN** any harness command is executed inside an agent VM
- **THEN** the executor sources `"$HOME/.zprofile"` then `"$HOME/.sheaf-agent-vm.env"` (each tolerating absence) before changing to the guest working directory and running the command

## Contracts

### `config/quest-runner.json` (target repo root)

General config-file rules: [Configuration](../../../structure/configuration.md).

```json
{
  "agent_vm": {
    "enabled": true,
    "golden_vm": "agent-macos-golden",
    "host_ports": "9000-9009",
    "mounts": [
      { "name": "worktree", "host_path": "$WORKTREE", "guest_path": "$WORKTREE" },
      { "name": "codex", "host_path": "$HOME/.codex", "guest_path": "$HOME/.codex" },
      { "name": "claude", "host_path": "$HOME/.claude", "guest_path": "$HOME/.claude" },
      { "name": "cursor", "host_path": "$HOME/.cursor", "guest_path": "$HOME/.cursor" }
    ]
  },
  "harnesses": {
    "claude_code": { "cli_path": "/Users/me/.local/bin/claude" },
    "cursor":      { "cli_path": "/Users/me/.local/bin/cursor-agent" },
    "codex":       {}
  }
}
```

| Key | Type | Default | Meaning |
|---|---|---|---|
| `agent_vm.enabled` | boolean | `false` | Enables one disposable VM per quest/experiment worktree. |
| `agent_vm.golden_vm` | string | `agent-macos-golden` | Tart VM cloned for disposable agent runtimes. |
| `agent_vm.host_ports` | string/list | `9000-9009` | Host TCP ports mirrored into guest loopback and exported as env URLs. |
| `agent_vm.mounts` | array | `[]` | Mount manifest; each entry has `name`, `host_path`, `guest_path`, optional `read_only`. |
| `harnesses` | object | `{}` | Map of harness kind → provider config. Keys must be `codex`, `claude_code`, or `cursor`. |
| `harnesses.<kind>.cli_path` | string | none | Absolute path to the CLI binary. When absent/empty, the default command name is resolved on `PATH` (`codex`, `claude`, `cursor-agent`). |

Unknown keys inside a harness entry are preserved but ignored; only
`cli_path` is read today. Workflow upgrades merge missing harness entries
into this file without overwriting existing ones
(`harness_config.merge_service_harness_configs`).

Per-profile execution settings (`harness`, `model`, `reasoning_effort`,
`idle_timeout_seconds`, `modify.allow`, `modify.block`, `thread.scope`,
`thread.name_template`, `thread.registry_key_template`, `runtime_context`)
are part of the workflow profile YAML, owned by
[workflow-config](../quest-runner-workflow-config/spec.md).

### Runtime files

- `<quest>/thread_registry.json` — shared schema and field semantics in
  [runtime-files](../../../projects/quest-runner/docs/contracts/runtime-files.md). This capability writes
  entries shaped as ah-14 and updates `round_count`, `last_used_at`, and
  `provider_thread_id` as specified above.
- `<quest>/logs/step_NNNN_<profile>.jsonl` — one file per harness round;
  envelope per ah-19. Event kinds written by this capability:
  `sheaf.run_started`, `sheaf.prompt`, `provider.json`, `provider.text`,
  `sheaf.run_completed`, `sheaf.run_failed`, `sheaf.path_enforcement`. The
  unified tagged-union schema (including provider payload shapes) is
  canonical at
  [agent-harness-event-schema](../../../structure/agent-harness-event-schema.md)
  / `structure/schemas/quest_log_events.schema.json` — not duplicated here.

### VM toolkit commands

```text
make -C projects/quest-runner agent-vm-rebuild
make -C projects/quest-runner agent-vm-fresh
make -C projects/quest-runner agent-vm-run [WORKTREE=/abs/path]

vm/agent-macos/bin/rebuild-golden [--fresh]
vm/agent-macos/bin/agent-run [--name N] [--golden N] [--softnet|--host-only]
                             [--read-only] [--mount SPEC]
                             [--host-port-range R]
                             [--command CMD] [--keep-running]
                             [worktree-path]
vm/agent-macos/bin/agent-ssh <vm-name>
vm/agent-macos/bin/agent-clean <vm-name>
```

Guest mount point: `/Volumes/My Shared Files/worktree`. Tart boot logs land
in `vm/agent-macos/logs/` (gitignored). VM association metadata lands in
`data/quest-runner/agent-vms.json` (gitignored).

### Guest environment file: `~/.sheaf-agent-vm.env`

Written into the guest home by `agent-run`'s boot-time setup step and
sourced — after `~/.zprofile` — before every VM-executed harness command
(ah-49). The setup step also appends
`source "$HOME/.sheaf-agent-vm.env" 2>/dev/null || true` to the guest's
`~/.zprofile` and `~/.bash_profile` (once, marker-guarded) so interactive
shells get the same environment.

```bash
export SHEAF_AGENT_VM=1
export CODEX_HOME="$HOME/.codex"
export PATH="$HOME/.npm-global/bin:$HOME/bin:/opt/homebrew/opt/sqlite/bin:/opt/homebrew/opt/python@3.14/bin:/opt/homebrew/opt/make/libexec/gnubin:/opt/homebrew/opt/coreutils/libexec/gnubin:/opt/homebrew/opt/libtool/libexec/gnubin:/opt/homebrew/bin:/opt/homebrew/sbin:$PATH"
export SHEAF_HOST_IP='192.168.64.1'
export SHEAF_HOST_PORT_9000_URL='http://192.168.64.1:9000'
# ... one SHEAF_HOST_PORT_<port>_URL line per configured host port
```

The `SHEAF_HOST_IP` / `SHEAF_HOST_PORT_*` lines appear only when the guest's
default-gateway IP resolves (ah-44); the first three lines are always
written. `SHEAF_AGENT_VM=1` is what switches the quest-runner Makefile to
the `.venv-vm` venv directory inside the VM (see
[operations.md](../../../projects/quest-runner/docs/operations.md)).

## Design

- `src/quest_runner_service/harness.py` — `Harness` ABC with
  `ClaudeCodeHarness`, `CodexHarness`, `CursorHarness`; `create_harness()`
  instantiates and `validate()`s. `_run_cli_streaming()` is the shared
  subprocess loop: selector-based non-blocking reads in 0.1s ticks, idle
  clock reset on every chunk, SIGTERM→SIGKILL on idle expiry.
  `HarnessJsonlLogSink` owns the envelope, file append (line-buffered split
  of stdout into `provider.json`/`provider.text`), and `ChatEventBus.publish`
  fan-out. Stream parsing helpers: `_parse_claude_stream_json`,
  `_parse_generic_stream_json`, `_extract_stream_error`.
- `src/quest_runner_service/harness_config.py` —
  `read_service_harness_configs()` / `merge_service_harness_configs()` for
  `config/quest-runner.json`. (`quest_fs.read_harness_configs()` retains a
  legacy fallback to quest-local `state_execution_config.yaml` when the
  service config is absent.)
- `src/quest_runner_service/agent_vm.py` — parses `agent_vm` config,
  expands the mount manifest (`_expanded_mounts`: `$WORKTREE`/`$HOME`
  substitution, worktree-mount injection, the ah-47 `source-checkout` /
  `git-common` auto-mounts), stores per-worktree VM metadata in
  `data/quest-runner/agent-vms.json`, invokes
  `vm/agent-macos/bin/agent-run` / `agent-clean`, and wraps harness commands
  in an SSH executor that maps host worktree paths to guest paths. The
  executor builds no inline environment: every remote command sources the
  guest `~/.zprofile` and `~/.sheaf-agent-vm.env` (ah-49), keeping the guest
  `PATH` canonical in one place.
- `src/quest_runner_service/state_machine/workflow_harness_callback.py` —
  the bridge from the workflow interpreter: resolves the profile, attaches a
  VM executor when enabled, builds the harness, renders thread name/registry
  key, loads-or-creates the thread, and calls `perform_role_harness_sequence`;
  raises
  `HumanInterventionRequested` if the intervention file exists afterwards.
- `src/quest_runner_service/quest_runner.py` —
  `perform_role_harness_sequence()` (the round loop: pre-send workspace
  validation, snapshot, log sink, `send_with_retry`, registry updates,
  post-send enforcement, follow-up loop capped at 40);
  `enforce_profile_modify_rules_after_harness()`,
  `revert_paths_to_snapshot()`, `path_is_legal_under_profile()`,
  `expand_modify_path_patterns()`, `agent_log_path()`,
  `next_log_step_number()`. The snapshot is `git rev-parse HEAD` taken
  immediately before each send; changed paths are the union of unstaged and
  staged name-status diffs against it plus untracked files. Reverts process
  deeper paths first so directory deletions do not orphan children.
- `src/quest_runner_service/quest_thread.py` — registry entry shape,
  `resolve_or_create_thread`/`load_thread`/`create_thread_with_provider_name`,
  and the `persist_thread_*` helpers; `quest_fs.read_thread_registry` /
  `write_thread_registry` do the JSON I/O (missing file is an error: the
  registry is scaffolded at quest creation, see
  [quest-lifecycle](../quest-runner-quest-lifecycle/spec.md)).
- `src/quest_runner_service/workflow_profile_execution.py` — message body
  assembly (`build_workflow_message_body`,
  `build_workflow_first_round_message`), preamble/task template rendering,
  `render_thread_name` / `render_thread_registry_key`, and
  `render_experiment_guidance` (injects `--experiment-id` instructions when
  running under an experiment).
- `src/quest_runner_service/chat_event_bus.py` — thread-safe in-process
  pub/sub keyed by resolved log path; one `SimpleQueue` per subscription.
- `vm/agent-macos/` — `bin/lib.sh` (Tart/sshpass plumbing, `profile.env`
  loading, SSH wait loop), `bin/rebuild-golden`, `bin/agent-run`,
  `bin/agent-ssh`, `bin/agent-clean`, `scripts/guest-*.sh` provisioners,
  `README.md`. `agent-run` embeds a guest-setup Python script that runs once
  over SSH after boot: it symlinks each mount's `guest_path` to its share
  under `/Volumes/My Shared Files/` (the symlink targets are driven purely
  by the mount specs), writes `~/.sheaf-agent-vm.env`, and starts the
  loopback port forwarder when host ports are configured. The golden image
  is local machine state and never committed.
- Golden-image principle: dependencies the agents need inside the VM belong
  in the golden image, provisioned via `bin/rebuild-golden` from
  `BASE_IMAGE`. As dependencies grow, the golden/base image is updated and
  reprovisioned rather than installing software into running disposable VMs;
  a disposable VM receives only runtime configuration at boot — the mount
  symlinks, the env file, and the port forwarder.
- Tests: `tests/test_harness_quest_thread_core.py`,
  `tests/test_workflow_profile_execution.py`,
  `tests/test_workflow_runner_integration.py`, `tests/test_agent_vm.py`,
  `tests/test_chat_event_bus.py`
  (run via `make -C projects/quest-runner test`).

Non-obvious choices: each harness CLI is a fresh process per round (no
long-lived agent process), so continuity lives entirely in the provider's own
session store addressed by `provider_thread_id`; Claude Code threads are
seeded with a one-turn "READY" call purely to obtain a `session_id`; the
enforcement revert-then-follow-up loop plus the intervention-file brake
(ah-33) intentionally trades autonomy for safety while the recovery path is
unproven.

## Interactions

- [state-machine-engine](../quest-runner-state-machine-engine/spec.md) (`sm`) — invokes this
  capability for every workflow `run` block via the run-profile callback;
  consumes step failures and the human-intervention stop.
- [workflow-config](../quest-runner-workflow-config/spec.md) (`wf`) — defines the profile YAML
  (harness/model/timeout/path rules/thread templates) and prompt/preamble
  files this capability renders and sends.
- [chat-stream](../quest-runner-chat-stream/spec.md) (`chat`) — subscribes to `ChatEventBus` and
  maps the JSONL events to AGUI for the dashboard chat UI.
- [quest-lifecycle](../quest-runner-quest-lifecycle/spec.md) (`ql`) — owns the quest directory in
  which `thread_registry.json`, `logs/`, and
  `human_intervention_request.md` live, and reports run outcomes.
- [service-lifecycle](../quest-runner-service-lifecycle/spec.md) (`svc`) — hosts the runner
  process and constructs the shared `ChatEventBus`.
- [experiments](../quest-runner-experiments/spec.md) (`exp`) — supplies `experiment_id`, which this
  capability folds into prompts as experiment guidance.
- Shared contract: [runtime-files](../../../projects/quest-runner/docs/contracts/runtime-files.md)
  (`thread_registry.json` schema, log directory layout).
