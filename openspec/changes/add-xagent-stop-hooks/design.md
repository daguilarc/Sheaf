## Context

xagent already owns supervised worker lifetime and exposes a long-polling
`xagent_await(run_id, after_sequence)` tool. That makes the worker side
event-driven, but the controller can still attempt to finish its own turn after
dispatch or follow-up. Once the turn has finished, neither Claude Code nor
Codex provides xagent with a supported way to restart that controller turn.

Both harnesses support user-global command hooks, including `PostToolUse` and
`Stop`. The xagent installer already writes user-global harness configuration
and has an atomic JSON writer plus one purpose-built MCP registry merge. The
agents installer separately owns a post-compaction entry in
`$CODEX_HOME/hooks.json` and currently renders that file as a whole. The
managed Superpowers installer also modifies `$HOME/.claude/settings.json` with
a non-atomic whole-object write. These writers need explicit coexistence
contracts.

Codex command hooks are trust-gated. Trust records are keyed by configuration
path, event, group index, hook index, and command hash, so registration alone
does not activate a new command and routine sorting can invalidate approval for
unrelated hooks.

Hook execution must be cheap, local, session-isolated, and independent of the
xagent service. A stop hook cannot synchronously query MCP, and doing so would
reintroduce polling and another service-failure boundary.

## Goals / Non-Goals

**Goals:**

- Keep a Claude Code or Codex controller turn open when that same harness
  session has one or more xagent runs awaiting a controller-visible event.
- Return an exact `xagent_await` call, including the durable cursor, as the stop
  rejection reason.
- Observe xagent tool results without waking the model or polling the xagent
  service.
- Install and update both harnesses' global hook configuration atomically,
  idempotently, and without deleting unrelated user configuration.
- Preserve xagent Codex hooks when the agents installer manages its own
  post-compaction hook.
- Preserve xagent Claude hooks when the managed Superpowers installer enables
  its Claude plugin.
- Make the Codex trust/activation boundary explicit and verifiable.

**Non-Goals:**

- Restart a controller after its turn or harness session has already ended.
- Add a callback/notification API to xagent or change MCP tool contracts.
- Interrupt a controller while it is doing independent work.
- Change xagent worker supervision, watchdog, or service-crash semantics.
- Install hooks for Cursor or Pi, which do not expose the same supported stop
  hook contract.
- Guard harness-native subagent stops. This change protects top-level
  controllers and ignores hook payloads marked with a subagent discriminator.
- Automate Codex trust approval or add an uninstall command; activation and
  rollback remain explicit user operations.

## Decisions

### 1. Observe tool results, then guard stop

The plugin will package `scripts/controller_stop_hook.py` with two modes:

- `observe`, registered for `PostToolUse`, normalizes the Claude Code or Codex
  hook payload and updates local controller state after successful xagent tool
  calls.
- `guard`, registered for `Stop`, reads only that local state. If a run is
  pending, it emits top-level JSON with `decision: "block"` and `reason`
  containing an exact instruction such as
  `xagent_await(run_id="<id>", after_sequence=<n>)`.
  The Claude adapter may also mirror model-visible guidance to stderr when the
  captured async-rewake contract requires it; stdout remains the authoritative
  decision JSON.

The `PostToolUse` matcher will be restricted to xagent MCP tools where the
harness supports matching. The program will still validate the normalized tool
name itself because matcher syntax and MCP name decoration differ between
harnesses.

The installed command is `python3 <absolute-script> --harness <name>
--state-root <absolute-data-root> <mode>`. The state root is rendered from the
installer's resolved `--home`, not inferred from the hook process environment.
The plugin ships no plugin-root `hooks.json` or `hooks/` directory, so Codex
default component discovery finds no second registration; global JSON is the
only registration path. The plugin manifest remains within the validator's
accepted field set.

The observer first requires a successful result envelope. It reads top-level
fields from `structuredContent` when available, accepts Claude Code's captured
direct JSON-string `tool_response` form, and otherwise parses the one documented
JSON text block fallback. It rejects `isError`, a decoded top-level `error`,
missing required fields, and nested identifiers in error `details`. Sanitized
payloads captured from Claude Code and Codex become committed fixtures so the
adapters are tested against harness output rather than invented shapes.

This is preferred over a background dispatcher because native stop hooks keep
the original turn alive and preserve the harness transcript and permissions.
A dispatcher would need an unsupported turn-resumption API or would have to
create a new turn with weaker delivery and identity semantics.

### 2. Keep a per-session set of pending runs

State will live outside the replaceable plugin package under
`$HOME/.agents/plugins/data/xagent/controller-stop-hooks/`. Each record is keyed
by harness plus the harness-provided session ID and contains:

- a schema version and monotonically increasing state revision;
- zero or more pending run IDs, each with its latest supervision cursor and
  deterministic insertion order; and
- the state revision most recently rejected by the stop guard.

One file per session avoids cross-session read/modify/write races. Updates use a
sibling temporary file and atomic replacement. Every read/modify/write or guard
snapshot for one session also holds an exclusive advisory lock on that
session's sibling lock file; atomic replacement alone would not prevent a
concurrent observer and asynchronous Stop hook from losing each other's
updates. The program never infers a session from the current directory,
process parent, or “most recent” state.
When the pending set becomes empty, it removes the session state file; a later
successful dispatch creates a new record incarnation and therefore a new
actionable state. The sibling lock file is retained so another process cannot
race lock-file deletion and recreation. A malformed or old-schema record is
left untouched and fails open for diagnosis.

Both harnesses are expected to expose a discriminator on tool events emitted
for native subagents. The fixture-capture preflight must prove the exact field
for each harness before implementation continues. The observer ignores proven
subagent events and the installer does not register `SubagentStop`; this
prevents a subagent's xagent call from blocking the parent controller. A
separate xagent-launched Claude or Codex worker is a top-level session in its
own harness process; if it intentionally dispatches another xagent run, the
guard applies to that worker's own session.

Multiple runs are supported because a controller may dispatch independent
workers. The guard selects the oldest pending entry deterministically; after
that run completes, a later stop can direct the controller to the next one.

This is preferred over one global “current run” file because global state could
block an unrelated controller or send it to consume another session's event.

### 3. Derive pending state from successful xagent results

The observer recognizes these transitions after extracting the MCP structured
result:

- Successful `xagent_start_non_sdd` adds the returned `run_id` and `sequence`.
- Successful `xagent_sdd_start` or `xagent_sdd_followup` adds or updates the
  returned `agent_id` as the run ID and the returned `sequence`.
- Successful `xagent_message` adds or updates the returned `run_id` and
  pre-turn `sequence`, re-arming a run after an earlier completion.
- Successful `xagent_interrupt` keeps the returned `run_id` pending and updates
  its sequence; the later await or close establishes the interrupted turn's
  terminal state.
- Successful `xagent_await` updates the cursor to the returned `sequence`.
  A `turn.completed`, `run_terminal`, or terminal phase removes that run;
  attention and other non-terminal events leave it pending. A normal
  `await_deadline` with the same cursor changes neither the record nor its
  revision.
- Successful `xagent_close` removes the named run.

Unrelated tools, error results, incomplete results, and unrecognized event
types do not clear pending state. In particular, an xagent service error cannot
silently convert an outstanding run into completion.

This result-driven state machine is preferred over inspecting prompts or tool
inputs alone because start and follow-up can fail before a run is accepted, and
the returned cursor is the authoritative durable resume point.

### 4. Bound stop rejection by state revision, independent of harness flags

The guard records the revision it rejects and rejects each revision at most
once within the current persistent record incarnation. This is the bound even
if a harness omits, broadens, or changes `stop_hook_active`; that field may be
accepted for payload compatibility but is not the safety mechanism. A
successful observer call increments the revision only when pending membership
or a stored cursor actually changes. Thus an attention event followed by
controller work can be guarded again with its newer cursor, while a repeated
await deadline or later user turn with unchanged state is allowed to stop. If
the pending set empties and a later dispatch creates a new record, that
dispatch is a new actionable state and receives one continuation opportunity.

Lock acquisition is bounded to one second. Failure to acquire the lock is
treated like unreadable state: the hook exits successfully without blocking or
mutating state. Lock files are retained; deleting them while another process
holds a descriptor would create two lock domains.

This gives the controller one deterministic continuation opportunity per
actionable state without an unbounded stop-hook loop when MCP is unavailable,
the state is stale, or the model does not follow the injected instruction.
Missing session IDs, malformed hook input, unreadable state, and unsupported
schema versions fail open without mutating state; the hook must never strand
all harness sessions because one record is damaged.

### 5. Merge owned hook groups into global JSON

The xagent global installer will install the hook program into the managed
xagent plugin destination, then upsert xagent-owned hook groups into:

- `$HOME/.claude/settings.json` for Claude Code; and
- `$CODEX_HOME/hooks.json`, with `CODEX_HOME` defaulting to `$HOME/.codex`, for
  Codex.

Commands in both files use the installed program's stable absolute path and an
explicit `--harness`/mode argument. Ownership is identified by that canonical
xagent command signature, not by adding undocumented fields to either
harness's JSON schema. Upsert appends absent groups after existing groups and
updates canonical groups in place, removes only canonical duplicates, and
never sorts unrelated groups. Removing a legacy duplicate can change later
positional trust records, so the installer reports that `/hooks` approval may
be required after any effective Codex hook change. JSON writes reuse the
installer's stage, backup, and `os.replace` behavior. Preservation is semantic
rather than byte-for-byte because JSON is reserialized. If existing JSON is
malformed or the relevant `hooks` field has an incompatible type, installation
fails before changing it.

The agents installer recognizes its group by the canonical command signature
`python3 <resolved-CODEX_HOME>/hooks/sheaf/session_start_after_compact.py`
together with its `SessionStart` matcher. On the first merge it removes the
legacy top-level `_sheaf_agents_managed` whole-file marker; the installed
script retains its ordinary agents managed marker. The xagent merge tolerates
that legacy top-level key until migration.

The agents installer symmetrically appends an absent group, updates its group in
place, and never sorts unrelated groups. Its check mode treats a file as
current when the agents-owned content is current and preserved xagent groups
are valid; clean removes only agents-owned content, retains xagent groups and
unrelated configuration, and deletes the shared file only when nothing else
remains. Any effective agents-side hook change or removal reports the Codex
`/hooks` re-approval boundary because positional trust may shift. Malformed
shared configuration fails closed even with `--force`.

The general managed-file safety/check/clean requirements explicitly exempt
this shared file from whole-file marker ownership and delegate it to the
group-level contract. The managed Superpowers installer adopts the same atomic
stage/backup/replace write discipline only for its Claude settings merge; other
registry writers remain outside this change.

This cooperative merge is preferred over assigning the whole file to either
installer, because both features are independently installed and neither owns
the user's other hooks.

## Risks / Trade-offs

- **A controller that has already stopped cannot be resurrected** → Installation
  protects future stop attempts; the limitation is documented as a non-goal.
- **Harness hook payloads differ or evolve** → Keep harness-specific adapters
  small, validate normalized fields, and cover sanitized captured payloads for
  both harnesses.
- **Codex registration is inert until trusted** → Print and document the
  `/hooks` approval step and include a manual activation check; tests may use
  Codex's explicit trust-bypass setting only inside an isolated test home.
- **Index changes invalidate Codex trust** → Append new groups and update in
  place without sorting; report re-approval after duplicate cleanup or any
  effective command change.
- **Harness-native subagents share parent session metadata** → Ignore events
  carrying the captured native subagent discriminator and do not register
  `SubagentStop`; fixture capture is a preflight stop condition.
- **Async Stop and PostToolUse hooks can overlap in one session** → Serialize
  each session's state transitions and guard snapshot with an advisory lock,
  then atomically replace the state file.
- **A stale valid record can reject one later stop after session resume** → Key
  strictly by harness session and reject each unchanged record revision only
  once; an explicit successful close also clears it.
- **A normal await deadline disarms the unchanged revision** → This is the
  deliberate fail-open bound; a later attention, message, cursor advance, or
  pending-membership change creates a new actionable revision.
- **An xagent failure after dispatch can leave a run pending** → Preserve state
  so the failure is surfaced, but bound rejection by revision so the controller
  can still terminate after one unsuccessful continuation.
- **Two installers edit one Codex file** → Use canonical ownership detection,
  preservation tests in both installers, atomic replacement, and a recoverable
  sibling backup.
- **A plugin reinstall briefly moves the hook executable while a harness is
  open** → Keep the installed destination and command path stable; harness hook
  command failures remain fail-open during the narrow two-rename replacement
  window.

## Migration Plan

1. Ship the hook program and installer merge logic with xagent.
2. Re-run the explicit xagent global installer to install the program and
   register Claude Code and Codex hooks.
3. Review and trust the two xagent Codex commands through `/hooks`, then invoke
   representative observe/guard fixtures or an isolated manual harness check
   to prove activation.
4. Update the agents and managed Superpowers installers before their next
   global run so they preserve the newly registered groups.
5. Verify repeated xagent and agents installs in both orders produce the same
   combined configuration.

Rollback is manual: remove only the canonical xagent-owned hook groups from
both global JSON files and restore the prior xagent plugin package. The
installer's sibling backup remains available for recovery if a harness rejects
the merged configuration.

## Open Questions

None. The supported harness set, state transitions, ownership boundary, and
bounded stop-loop behavior are fixed for this change.
