# Deferred findings — SDD ledger v2 redesign

Things found while executing the plan that were deliberately **not** fixed in
the task that surfaced them. Each names why it was deferred and where it
should land. This file is input to the whole-branch review (after Task 11).

---

## A. xagent facade defects found by dogfooding

These were found by using the SDD facade to rebuild the SDD facade. Findings
1 and 5 are already addressed by this change; 2, 3, and 4 are not.

### A1. SDD dispatch tools advertised empty input schemas — FIXED (Task 0)

`registerTool` derives a tool's advertised JSON Schema from an object schema;
both SDD tools passed a `z.discriminatedUnion`, which normalizes to
`undefined`, so the SDK published `{}`. Clients that trusted discovery
mis-serialized their arguments.

Fixed in Task 0 (`f7ac2fa4`) under new requirement **xsvc-15**. Recorded here
because the redesign did not originally fix it: v2 swaps the union for another
union, so the defect would have survived the cutover.

### A2. `xagent_sdd_start` / `xagent_sdd_followup` return timeouts to the client while succeeding server-side — FIXED (task 9.1, `88ae1355`)

Both dispatch tools now detach the submit and return once the turn is durably
running, mirroring `runManager.startRun`. The await cursor is snapshotted
before submit advances it, and an early submit failure still closes the run.
Requirement **xsvc-16** now states the contract that was missing.

**Root cause** — found post-plan by a fresh-context Fable review, verified
independently by the controller. **Not a transport problem.**

`Supervisor.submit` does not resolve when the turn is *accepted*. It consumes
the entire provider event stream (`for await (const event of providerEvents)`,
`supervisor.ts:317`) and resolves at turn **completion**.

`SddManager.Start` awaits it directly (`sdd_manager.ts:351`), and
`SddManager.Followup` does the same (`sdd_manager.ts:487`). Both therefore
block for the full duration of the subagent's turn — minutes — against the MCP
client's 60s timeout.

`runManager.startRun` does **not** have this defect: it detaches the submit
(`void submitPromise.catch(() => {})`, `run_manager.ts:329-334`) and returns via
`waitForTurnRunning`, bounded at ~1s. That is exactly why
`xagent_start_non_sdd` returned instantly on the same transport in the same
session — which was the clue that broke it open.

Every measured symptom fits: the run is always created; `supervisor_created →
turn_started` is 0.0s; the renderer is 0.116s; invalid-cwd returns instantly
(it throws before the submit await); and ~15/15 SDD starts plus every SDD
followup timed out.

**Fix shape:** mirror `startRun` at both call sites — detach the submit
promise, await turn-running, return. Independent of the await/SSE design
question, and far smaller.

**Original symptom, as first recorded:**

Every dispatch in this change returned "operation timed out" to the MCP client
while the server completed create → start → submit normally. A controller that
retries on timeout **spawns a duplicate agent**. The only safe recovery is to
poll `xagent_list` and reconcile.

Not fixed: out of scope for every task in this plan, and the workaround
(verify via `xagent_list`, never retry) is reliable. Should become an
requirement — either the tool returns promptly with the allocated `agent_id`
before the provider is ready, or the contract documents that a timeout is not
a failure and names the reconciliation path.

### A3. `xagent_await`'s 7000-second contract exceeds any usable client — FIXED (tasks 9.3–9.5)

Resolved by making the contract true rather than by lowering the number.
`xsvc-5` was rewritten from a service-only capacity claim into a liveness
contract: awaits end on news, the service emits progress pings while the
supervisor vouches, and `deadline_seconds` left the agent-facing schema.
Measured from the controller's own harness — the client that died at 60s — a
**330-second hold**, clearing both the SDK's 60s default and undici's ~300s
timers. Zero intermediate wakeups.

`xsvc-5` specifies a 7200-second HTTP/MCP request lifetime and a 7000-second
default await deadline. No MCP client driving this service can hold a request
that long; every long await returns a client-side timeout. The tool itself is
correct — a 45-second deadline returns a clean `supervision.deadline`.

Not fixed: this is a *specification* problem, not a code defect, so it needs a
decision rather than a patch. Task 10 rewrites the specs and is the natural
place to confront it. Options: lower the default to something a client can
actually hold, or keep the long deadline but document short-deadline polling
as the supported controller pattern.

### A5. A late watchdog event can deadlock the controller out of a healthy agent — FIXED BY THIS CHANGE

**The strongest single justification this change has.** Hit while re-reviewing
Task 3.

The Task 3 reviewer (`xrun_20260728183228287_e8cd2491`) completed its turn
normally — `turn.completed` at sequence 4, run idle at phase `ready`. A
`supervision.attention` event (`watchdog_uncertain` / `classifier_timeout`)
then landed at sequence 5, *after* the completion. The v1 ledger's turn row
stayed at `status = running` with a NULL `completed_sequence`, and every route
back to the agent closed:

| Tool | Result |
|---|---|
| `xagent_sdd_followup` | `sdd_turn_unresolved` — "await it before continuing" |
| `xagent_sdd_await` | returns the attention event; **does not resolve the turn** |
| `xagent_message` | `sdd_turn_in_flight` — "await it before messaging", naming `xagent_sdd_await` |

The facade instructs the controller to await, awaiting does not resolve, and
no other path is permitted. The agent was alive, idle, and permanently
unreachable. There is no repair tool, because in v1 the ledger is authoritative
over liveness and only its own await can advance it.

This is the redesign's thesis demonstrated end to end: ledger state derived
from what the controller *observed*, desynchronized by an unrelated event, with
no reconciliation path. In v2 it cannot occur — liveness is a run-manager fact,
`Followup` writes nothing and validates only that a row exists and the run is
live, and `xagent_message` is legal on SDD runs unconditionally.

Recovery used: close the deadlocked agent and dispatch a fresh reviewer with
the prior findings and the fix diff in its brief — which is exactly the
fresh-agent recovery `sdd_agent_not_live` will name in v2. The v1 dead end was
escaped by hand-executing the v2 recovery pattern.

Cite this in Task 10 alongside A4 when rewriting `xagent-sdd-workflow`, and in
the `xsvc-12` scenario "Careless controllers cannot corrupt the ledger" — the
controller here was not careless, and the ledger corrupted anyway.

### A4. `sdd_turn_unresolved` couples ledger state to controller tool choice — FIXED BY THIS CHANGE

A v1 turn row stays open until the controller calls `xagent_sdd_await`
specifically; the generic `xagent_await` does not resolve it. The controller
hit this twice during execution — once per agent — costing a wasted
round-trip each time.

This is the ledger rot the change exists to remove, and the strongest
available justification for `xsvc-5` (one await tool) and Task 4 (delete the
facade). Cite it when Task 10 rewrites `xagent-sdd-workflow`.

---

## B. Code findings deferred out of the task that found them

### B1. `journal_mode = WAL` is set before the `user_version` gate — OPEN

`OpenSddLedgerDatabase` (`src/service/sdd_store.ts`) applies
`journal_mode = WAL` before `CreateSddAgentStore` checks `user_version`.
Converting a rollback-journal database to WAL rewrites its header, so refusing
a newer-than-2 ledger still mutates a file this build just declared it cannot
read — awkward beside the new "do not delete the ledger; upgrade the service"
remediation added in Task 2.

Found in the Task 2 re-review. Deferred because it is pre-existing, sits in
the open path **shared by the v1 and v2 stores**, and reordering shared open
logic inside an additive task risks a regression in the store the live service
is running on. Fix: move the version check ahead of the pragma. Whole-branch
review, or a follow-up change.

### B6. Coverage the deleted e2e lifecycle test took with it — REPAID (Task 9)

Task 4 deleted `tests/e2e.test.ts`'s "MCP fake adapter drives the full SDD
lifecycle" test outright rather than migrating it. The controller authorized
that — its premise was report persistence and `sdd_turns` status, both deleted
— and the Task 4 reviewer checked what actually died. Three non-report-premised
invariants it uniquely covered have **no replacement**:

1. **Two concurrent SDD sessions** with independent adapters, distinct agent
   ids, and per-agent ledger rows. No surviving test drives two SDD sessions at
   once.
2. **The only start → await → followup → await round-trip through the MCP tool
   layer.** Everything left either bypasses the tool layer or drives one turn.
3. **`assert.notEqual(row.report_text, x_MutableArtifactText)`** — report text
   comes from the event, not from the mutable artifact file on disk. The v2
   analogue is worth restating directly: the report in `turn.completed` must
   not be re-read from the report path. The new `mcp_await` test writes an
   *empty* report file, so it would not catch a regression that read the file.

Also missing since Task 4: no test exercises `xagent_await` / `xagent_message`
/ `xagent_close` **through MCP against an SDD-owned run**. The handler bodies
are now one unbranched line each so structural risk is low, but xsvc-5's
behavioural claim is asserted nowhere at the tool layer, and it was before this
task.

Task 9 is the natural owner of all four. This is not a defect in Task 4; it is
the accounting for a wholesale deletion, recorded so the coverage is rebuilt
deliberately rather than assumed.

### B8. A pruned run directory resurfaces as a dispatch-failure tombstone — OPEN

Found in the Task 8b review.

`ListGeneric` emits a tombstone for every `sdd_agents` row with no
corresponding run record. `store.ListAll()` is unbounded and the v2 ledger has
no deletion path, so once retention or cleanup removes an old run directory,
that agent's row stops matching a run and starts rendering as
`run_missing: true` — semantically "this dispatch never became a run", when in
fact it ran and was later pruned.

Literally consistent with xsvc-13's wording ("no run record"), and low impact
today: newest-first ordering plus `limit` keeps these off the first page, and
nothing prunes run directories yet. But it is a genuine interaction between
xsvc-13 (tombstones) and xsvc-14 (run directories are the system of record),
and the two requirements were written without reference to each other.

Whole-branch review should decide whether a tombstone needs to distinguish
"never started" from "evidence pruned" — and note that xsvc-14 already forbids
deleting a ledger-referenced run directory, which if enforced makes this
unreachable. If that prohibition is the answer, say so in the requirement
rather than leaving it implicit.

### B7. Owner-only ledger permissions — REMOVED, finding moot

Originally recorded as "the log-root directory is secured at creation but never
re-secured". Investigating the *why* showed the guard should not exist at all.

The rationale came from the archived `add-xagent-sdd-mode` design: owner-only
permissions "because briefs may contain sensitive repository context", paired
with a rule to "never include brief text in normalized supervision logs".

**This change inverted that pairing.** `turn.submitted` (xsvc-9) exists
precisely to write the full submitted prompt — rendered brief included — into
`normalized.jsonl`. So the protected artifact and the unprotected one now hold
the same text:

```
-rw-------  sdd.sqlite                 0600, holds brief_text
-rw-r--r--  xrun_.../normalized.jsonl  0644, holds the full prompt
```

A `chmod` on one copy of a secret that also sits in a plain umask file next to
it is not protection; it implies a guarantee the system of record never had.

And the threat model does not survive contact with the actual project: a public
repository of agents that build browser synthesizers, with the data root
gitignored, local, and single-user. The "sensitive repository context" is the
public repo.

`EnsureOwnerOnlyDirectory`, `EnsureOwnerOnlyDatabaseFile`, and
`EnsureOwnerOnlyLedgerFiles` are deleted along with the two tests asserting
modes. The directory is still created; its permissions come from the umask,
which is the operator's policy to set. No spec required the modes — only the
archived design mentioned them.

### B2. Intermittent test failure — IDENTIFIED AND FIXED

**Root cause: three timing-sensitive tests, not one, all load-sensitive under
`node --test`'s parallel file execution. No production defect.**

Reproduced by saving every run's output before diagnosing — the procedure this
entry previously specified and the controller previously failed to follow.
Baseline rate: **3 failures in 25 full-suite runs (~12%)**, and the failing test
varied, which is why single-test isolation kept coming back clean (0/40).

| Test | Failure | Cause |
|---|---|---|
| `turn.submitted never wakes a live await` (`mcp_await.test.ts`) | `Cannot submit while supervision phase is running` | Submitted immediately after `startRun`, which returns once the turn is *running*, not completed. Under load the first turn was still in flight. Dates from Task 1 — almost certainly the original sighting. |
| `xagent_await with progressToken emits pings that do not settle the await` (`await_liveness.test.ts`) | `MCP error -32000: Connection closed` | A 40ms ping interval with a fixed 120ms sleep, plus a pending request at teardown whose rejection masked whatever actually failed. Introduced by task 9.4. |
| `90-minute healthy run…` (`supervision_cost.test.ts`) | `1 !== 3` watchdog calls | The classifier is invoked asynchronously off the evidence thunk, so its count trails the fake clock's cadence by an unbounded number of macrotasks. A single `await Promise.resolve()` was not enough drain under load. |

Each fix removes a **timing assumption** while keeping the assertion: poll for
`ready` instead of assuming it; poll for the ping count and assert the
load-independent half (`settled === false`) separately; drain macrotasks until
the cadence catches up, then assert the exact count. The pending-request
rejection is now caught so it can never again mask a real error.

**After: 0 failures in 40 full-suite runs.** At the prior ~12% rate, 40 clean
runs would occur by chance about 0.6% of the time — strong evidence, not proof.
A rarer fourth offender cannot be excluded, and the capture procedure above
remains the right response if one appears.

### B3. Residual gaps in the no-`UPDATE` guard test — ACCEPTED

After the Task 2 fix the guard scans all of `src/service/*.ts` and covers
quoted, schema-qualified, and `REPLACE INTO` forms. Still outside its reach:
bracket-quoted `[sdd_agents]`, and subdirectories of `src/service/`.

Accepted: the finding's bar is met and the remaining forms are not idioms this
codebase uses.

### B4. The two v1/v2 role maps are deliberately not inverses — ACCEPTED

`code-reviewer → reviewer` on read, but `reviewer → task-reviewer` on write,
so a `code-reviewer` row read and re-inserted would land as `task-reviewer`.
Inherent to v2 merging two v1 roles into one; no read-then-reinsert path
exists. Both maps die with the v1 store in Task 8a.

### B5. The v1 adapter's `Insert` refuses `fixer` and `re-reviewer` — ACCEPTED

Two of the port's four roles have no v1 equivalent, because v1 expressed
fix/re-review as a turn *kind* rather than a role. `Insert` throws
`sdd_role_unmapped` rather than inventing a mapping. Correct modelling; made
harmless by the Task 6 → 8a no-restart window, since the rewritten manager
never runs against a v1 file.
