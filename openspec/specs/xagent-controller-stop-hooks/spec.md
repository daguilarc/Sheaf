# xagent Controller Stop Hooks

## Purpose

Define globally installed Claude Code and Codex hooks that keep top-level controllers attached to pending xagent work through bounded, event-driven continuation.

## Requirements

### Requirement: xhook-1 — Installation: global Claude and Codex hooks
WHEN the xagent global installer completes successfully, THE installer SHALL register xagent-owned `PostToolUse` observer and `Stop` guard command hooks in `$HOME/.claude/settings.json` and the resolved `$CODEX_HOME/hooks.json`, using stable absolute `python3` commands that invoke the hook program packaged under the installed plugin's `scripts/` directory with explicit harness, mode, and installer-resolved state-root arguments.

#### Scenario: Fresh global installation
- **WHEN** neither harness configuration contains xagent-owned hook groups
- **THEN** global installation adds an observer and stop guard for Claude Code
- **AND** global installation adds an observer and stop guard for Codex
- **AND** each command references the installed xagent hook program by absolute path

#### Scenario: Harness configuration contains unrelated settings and hooks
- **WHEN** either target JSON file already contains unrelated top-level settings or hook groups
- **THEN** global installation preserves the semantic values and relative order of those settings and groups
- **AND** it adds or updates only the canonical xagent-owned groups

#### Scenario: Existing hook groups have positional Codex trust
- **WHEN** Codex hook configuration contains unrelated groups before xagent installation
- **THEN** the installer appends absent xagent groups after existing groups for each event
- **AND** routine reinstalls update canonical xagent groups in place without sorting or normalizing unrelated groups

#### Scenario: Codex commands require trust
- **WHEN** installation adds or changes a Codex xagent command whose trust hash has not been approved
- **THEN** installation reports that registration is complete but activation requires review through Codex `/hooks`
- **AND** documentation provides a verification step that proves both xagent hooks are active

### Requirement: xhook-2 — Observation: top-level session-scoped pending-run state
WHEN a supported harness emits top-level `PostToolUse` for a successful xagent start, SDD start, SDD follow-up, message, interrupt, await, or close result, THE observer SHALL atomically update pending-run state keyed by that harness and the emitting harness session ID using only the authoritative top-level fields required by that transition.

#### Scenario: Non-SDD start succeeds
- **WHEN** `xagent_start_non_sdd` returns a `run_id` and `sequence`
- **THEN** the observer records that run and cursor as pending for the emitting session

#### Scenario: SDD start or follow-up succeeds
- **WHEN** `xagent_sdd_start` or `xagent_sdd_followup` returns an `agent_id` and `sequence`
- **THEN** the observer records or updates that agent ID as a pending run for the emitting session

#### Scenario: Message starts another worker turn
- **WHEN** `xagent_message` returns a `run_id` and `sequence`
- **THEN** the observer records or updates that run as pending for the emitting session

#### Scenario: Active worker turn is interrupted
- **WHEN** `xagent_interrupt` returns a `run_id`, phase, and sequence
- **THEN** the observer retains that run as pending until a later await or close establishes its terminal state

#### Scenario: Multiple runs are dispatched
- **WHEN** one harness session successfully starts more than one xagent run
- **THEN** the observer retains every pending run with its own latest cursor and deterministic insertion order

#### Scenario: Another session has pending work
- **WHEN** two Claude or Codex sessions observe different xagent runs
- **THEN** each session record contains only the runs observed by that harness session

#### Scenario: Hook event belongs to a harness subagent
- **WHEN** a hook payload identifies a harness subagent through its agent discriminator
- **THEN** the top-level observer does not mutate controller pending state
- **AND** this change does not register a `SubagentStop` guard

#### Scenario: Native subagent discriminator cannot be captured
- **WHEN** preflight fixture capture cannot establish a reliable native-subagent discriminator for either harness
- **THEN** implementation stops before enabling that harness's global observer
- **AND** the OpenSpec design is revised instead of inferring subagent identity from working directory, process parent, or recent state

### Requirement: xhook-3 — Observation: await and close transitions
WHEN a successful xagent await or close result is observed, THE observer SHALL advance or clear only the matching pending run in the emitting session according to the returned terminal state.

#### Scenario: Await returns attention or another non-terminal event
- **WHEN** `xagent_await` returns a non-terminal event and a newer `sequence`
- **THEN** the matching run remains pending
- **AND** its stored cursor becomes the returned sequence

#### Scenario: Await chunk expires without a new event
- **WHEN** `xagent_await` returns `event: "supervision.deadline"` with `reason: "await_deadline"` and the same sequence
- **THEN** the matching run remains pending
- **AND** the session revision does not advance

#### Scenario: Await establishes a terminal run
- **WHEN** `xagent_await` returns `reason: "run_terminal"` or phase `completed`, `failed`, `cancelled`, or `abandoned` for a pending run
- **THEN** the observer removes that run from the emitting session's pending set

#### Scenario: Await returns turn completion
- **WHEN** `xagent_await` returns `event: "turn.completed"` for a pending run
- **THEN** the observer removes that run from the emitting session's pending set

#### Scenario: Run is explicitly closed
- **WHEN** `xagent_close` succeeds for a pending run
- **THEN** the observer removes that run from the emitting session's pending set

#### Scenario: Tool result is unsuccessful or incomplete
- **WHEN** an xagent tool result is an error or lacks the authoritative identity or cursor required for its transition
- **THEN** the observer does not clear or invent pending-run state

### Requirement: xhook-4 — Stop: direct controller to event-driven await
WHEN a top-level Claude Code or Codex session attempts to stop with at least one pending xagent run whose current state revision has not previously been rejected in the current persistent record incarnation, THE stop guard SHALL reject that revision at most once and return top-level JSON with `decision: "block"` and a `reason` containing the exact `xagent_await` instruction for the deterministically selected pending run ID and its latest stored sequence.

#### Scenario: One run is pending
- **WHEN** a controller attempts to stop after successfully dispatching one run
- **THEN** the harness keeps the controller turn open
- **AND** the rejection reason identifies `xagent_await`
- **AND** it includes the pending `run_id` and latest `after_sequence`

#### Scenario: Several runs are pending
- **WHEN** a controller attempts to stop with several pending runs
- **THEN** the guard selects the oldest pending run deterministically
- **AND** later stop attempts can select remaining runs after earlier runs complete

#### Scenario: No run is pending
- **WHEN** a controller session has no pending xagent run
- **THEN** the guard allows the session to stop without injecting an await instruction

#### Scenario: A later user turn stops with the same pending revision
- **WHEN** a prior stop was rejected for a revision
- **AND** a later user turn attempts to stop without any intervening pending membership or cursor change
- **THEN** the guard allows stopping because that revision already received its continuation opportunity

#### Scenario: A completed record is followed by a new dispatch
- **WHEN** all pending runs are cleared and the session state file is removed
- **AND** a later successful dispatch creates a new persistent record
- **THEN** that new actionable state can be rejected once even if its local revision number matches a prior record incarnation

### Requirement: xhook-5 — Stop: bounded and fail-open behavior
WHEN the stop guard cannot safely establish an actionable unrejected state revision for the emitting top-level session, THE hook SHALL allow stopping regardless of whether the harness supplies or how it scopes an already-active stop-hook field.

#### Scenario: State advances after a rejected stop
- **WHEN** the guard rejects a stop and the controller subsequently receives a successful xagent result that advances session state
- **THEN** a later stop can be rejected for the new revision with the updated pending instruction

#### Scenario: Successful result makes no state change
- **WHEN** a successful xagent result repeats the stored identity and cursor without changing pending membership
- **THEN** the observer does not increment the state revision

#### Scenario: Stop repeats without state change
- **WHEN** the same state revision was previously rejected
- **THEN** the guard allows stopping whether the harness reports the stop hook as active, inactive, or omits that field

#### Scenario: Input or state is malformed
- **WHEN** hook input lacks a usable harness session ID or the matching state record is unreadable, malformed, or uses an unsupported schema version
- **THEN** the hook exits without blocking the stop
- **AND** it does not mutate another session's state

### Requirement: xhook-6 — Installer: atomic, recoverable, and idempotent merge
WHEN xagent installs or updates global hook configuration, THE installer SHALL validate the existing JSON shape, merge only canonical xagent-owned hook groups without reordering unrelated groups, write each changed file by atomic replacement, retain a recoverable sibling backup of prior content, and produce no duplicate xagent groups on repeated installation.

#### Scenario: Installation is repeated
- **WHEN** the same xagent version is installed globally more than once
- **THEN** each harness configuration contains exactly one canonical xagent observer group and one canonical xagent stop group
- **AND** a subsequent installation with no effective change leaves equivalent configuration

#### Scenario: Existing JSON is malformed
- **WHEN** a target global configuration is invalid JSON or contains an incompatible hooks shape
- **THEN** installation fails before replacing that configuration

#### Scenario: Changed configuration is committed
- **WHEN** the installer needs to change an existing target configuration
- **THEN** it stages and atomically replaces the JSON file
- **AND** it retains a sibling backup containing the previous file content

### Requirement: xhook-7 — Observation: exact successful-result extraction
WHEN the observer processes a supported xagent `PostToolUse` payload, THE observer SHALL accept only a successful top-level result with the fields required for that transition, preferring `structuredContent`, accepting Claude Code's captured direct JSON-string `tool_response`, and using an exactly parsed text-content object only as the other documented harness fallback.

#### Scenario: Structured content carries a successful result
- **WHEN** `tool_response.structuredContent` is an object without an error indication and contains the required top-level identity and sequence
- **THEN** the observer uses those top-level fields for the transition

#### Scenario: Text content is the only structured representation
- **WHEN** structured content is absent
- **AND** the documented harness payload contains one JSON text block representing the complete successful result object
- **THEN** the observer parses that object as the fallback result

#### Scenario: Claude emits a direct JSON-string result
- **WHEN** structured content is absent
- **AND** the captured Claude Code payload carries the complete successful result as a direct JSON-string `tool_response`
- **THEN** the observer parses that object as the Claude fallback result

#### Scenario: Error details contain an identity
- **WHEN** a tool result is marked as an error or has a top-level `error` field
- **AND** nested error details contain a `run_id` or `agent_id`
- **THEN** the observer rejects the result
- **AND** it does not scan nested details to invent pending state

#### Scenario: Representative harness fixtures
- **WHEN** the hook-state test suite runs
- **THEN** it exercises sanitized payload fixtures captured from both Claude Code and Codex
- **AND** the fixtures cover successful structured results, the captured direct JSON-string form, the JSON text-block fallback, Stop input/output, and native-subagent discrimination
- **AND** defensive error rejection uses inline unit envelopes when captured failed calls emit no `PostToolUse` payload

### Requirement: xhook-8 — Packaging: one explicit global registration path
WHEN the xagent plugin is packaged, THE package SHALL include the hook program under `scripts/`, omit plugin-root `hooks.json` and `hooks/` components discoverable by Codex, keep the plugin manifest within the accepted validator schema, and register hooks only through the explicit global JSON merge.

#### Scenario: Packaged plugin is inspected
- **WHEN** package validation runs
- **THEN** the installed `scripts/` directory contains the Python hook program
- **AND** the plugin manifest contains no unsupported `hooks` field
- **AND** the package does not contain a plugin-root `hooks.json` or `hooks/` registration

### Requirement: xhook-9 — State: serialize concurrent session updates
WHEN observer and guard hooks for the same harness session overlap, THE hook program SHALL serialize the complete state read/modify/write or guard snapshot under one per-session exclusive advisory lock and commit changed state by atomic replacement.

#### Scenario: Stop overlaps an observer transition
- **WHEN** a `Stop` hook and `PostToolUse` hook execute concurrently for one session
- **THEN** their state operations are serialized
- **AND** neither operation loses a newly added run, resurrects a cleared run, or overwrites a newer cursor

#### Scenario: Different sessions update concurrently
- **WHEN** hooks for different harness/session keys execute concurrently
- **THEN** they use different state and lock files
- **AND** neither session blocks or mutates the other

#### Scenario: Session lock cannot be acquired promptly
- **WHEN** a hook cannot acquire its session lock within one second
- **THEN** it exits successfully without blocking or mutating state
- **AND** it does not delete the sibling lock file
