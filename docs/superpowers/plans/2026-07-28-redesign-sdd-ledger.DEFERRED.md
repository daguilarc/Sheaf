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

### A2. `xagent_sdd_start` / `xagent_sdd_followup` return timeouts to the client while succeeding server-side — ROOT CAUSE FOUND, OPEN

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

### A3. `xagent_await`'s 7000-second contract exceeds any usable client — OPEN

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

### B6. Coverage the deleted e2e lifecycle test took with it — FOR TASK 9

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

### B7. The log-root directory is secured at creation only, never re-secured — OPEN

Found while restoring the reopen-permissions coverage the Task 8a review
flagged as lost.

`EnsureOwnerOnlyDirectory` (`src/service/sdd_store.ts:68-72`) calls
`mkdirSync(..., { mode: 0o700 })` **only when the directory does not exist**.
It never `chmod`s an existing one. By contrast `EnsureOwnerOnlyLedgerFiles`
re-secures `sdd.sqlite` and both sidecars to `0o600` on *every* open, twice.

So a log root that becomes group- or world-readable — by an operator `chmod`,
a restore, a copy, a container image layer — stays that way for the life of
the service, while the ledger file inside it is repeatedly re-secured. The
asymmetry is the surprising part: the code clearly intends owner-only, and
achieves it for files but not for their container.

Impact is bounded but real. The ledger itself stays `0o600`, so `brief_text`
is not exposed by this. What a readable log root exposes is the **directory
listing**: agent ids, and the per-run directories. Those run directories are
already created `0o755` and hold `normalized.jsonl` — which after this change
is the *only* copy of every agent's reports and submitted prompts (xsvc-14).
So the run-directory mode is the larger question, and this finding is really
the narrow end of it.

Pre-existing; not introduced by any task in this change, and untouched by the
v1 deletion. Deliberately not fixed inside the cutover — changing directory
permission behaviour during the most irreversible step in the plan is the
wrong trade.

The restored test at `tests/sdd_store.test.ts` ("v2 re-secures the ledger and
its WAL sidecars on reopen") pins the file guarantee and carries a comment
saying explicitly that it does **not** assert the directory mode, so the gap
is visible rather than silently uncovered.

Whole-branch review should decide two things together: whether
`EnsureOwnerOnlyDirectory` should re-secure, and whether run directories
should be `0o700` given they are now the system of record.

### B2. Intermittent test failure — CONFIRMED REAL, STILL UNIDENTIFIED

**Two independent sightings, different agents and different commits.** No
longer dismissible as one agent's bad run.

- **Sighting 1 (Task 1).** The implementer reported a `service_main`
  reconciliation failure that passed on isolated re-run and on the subsequent
  full suite. Controller could not reproduce: 8/8 isolated, 3/3 full-suite.
- **Sighting 2 (Task 5 fix round, commit `750ac2ef`).** The controller's own
  verification run reported `377 tests, 375 pass, 1 fail, 1 skipped` while the
  implementer's run of the same commit reported all green. An immediate re-run
  was clean, and 8 further full-suite runs were clean.

**The evidence from sighting 2 was lost, and that was the controller's
error:** the failing test name was not captured before re-running, despite
this entry already saying to do exactly that. Do not repeat it.

**Capture procedure when it next appears** — save output *first*, diagnose
second:

```bash
cd projects/xagent
for i in $(seq 1 20); do
  npm test > /tmp/suite-$i.log 2>&1
  grep -qE "^ℹ fail [1-9]" /tmp/suite-$i.log && { echo "captured in /tmp/suite-$i.log"; break; }
done
grep -E "^✖|not ok|AssertionError" -A 20 /tmp/suite-*.log
```

Note the reporter prints failures as `✖ name` / `not ok`, and a `grep` for
`failing` finds nothing — that mismatch is part of why the first capture was
missed.

Why it matters more now than at sighting 1: **every task in this plan gates on
a green suite**, and both the implementer and the controller take that green
as evidence. A suite that is red roughly one run in ten means any given task's
"all green" has a real chance of being one unlucky re-run away from red, and
that a genuine regression could be dismissed as "the known flake." Owner: the
whole-branch review, and it should not be closed by another clean sweep —
only by identifying the test.

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
