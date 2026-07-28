## 1. `turn.submitted` Event (precondition for everything else)

- [ ] 1.1 Add failing supervision tests for the `turn.submitted` normalized event exactly as pinned in design D2: emitted on every `Supervisor.submit()` with payload `{ text, turn_id }` carrying the full sanitized submitted text, `phase: "running"`, `reason: "turn_submitted"`, sequenced immediately after the `turn_started` state event and durable via `eventSink` before `session.submit` is invoked on the adapter (not merely before the submit Promise resolves), and emitted for both rendered SDD prompts and raw messages. Deliverable: red tests in `tests/supervision.test.ts`.
- [ ] 1.2 Implement `turn.submitted` emission in `supervision/supervisor.ts` (extend the `SupervisionEvent` `type` union in `supervision/types.ts` with `"turn.submitted"`), including the appended controller note in the recorded text; a failed event-sink append fails the submit before the adapter sees the text. Deliverable: 1.1 tests green.
- [ ] 1.3 Add failing tests that `turn.submitted` never completes a live await and that `isPersistedAwaitWake` in `service/run_manager.ts` ignores it on the persisted path; implement the filter. Deliverable: await tests green in `tests/mcp_await.test.ts`.

## 2. Ledger v2 Store

**Hard precondition — live-service reprovision gate.** The xagent service
currently running is served from this worktree's build against a v1
`sdd.sqlite`. Any build from task 4.x onward wires the v2 store, whose
schema gate refuses `user_version != 2` — so the first service restart onto
such a build takes SDD tooling down until the v1 file is gone. Task 2.0
sequences this; 8.1 only *documents* the step for other operators.

> **Restart boundary, second half.** Task 2.0 gates the ledger schema. The
> MCP schema cutover (§3) and the manager rework (§4) are also one boundary:
> after §3 lands, the tool surface accepts v2 roles while the manager still
> implements v1 ones, so a service restarted between §3 and §4 accepts
> dispatches it cannot serve. Do not restart the live service until §4 is
> complete. Tests run against in-process fixtures throughout and are unaffected.

- [ ] 2.0 Operator gate: before the first restart of the live xagent service onto any build that wires the v2 store (any build including §4/§5 work), stop the service and delete `<log_root>/sdd.sqlite`, `sdd.sqlite-wal`, and `sdd.sqlite-shm`; the restarted service provisions schema v2. Until that restart is intended, do not restart the live service onto in-progress builds of this change. Deliverable: reprovision performed at the §4/§5 restart boundary, confirmed by the service creating a fresh v2 ledger.
- [ ] 2.1 Add failing store tests for schema v2: exactly the `sdd_agents` table and its `sdd_agents_assignment` index created at `user_version = 2` — no views (the v1 `sdd_dispatch_log` view has no v2 replacement); owner-only permissions, WAL, foreign keys, and busy timeout preserved; opening a database with any other `user_version` (including v1) fails with an error naming the file to delete and stating v1 is not migrated. Deliverable: red tests in `tests/sdd_store.test.ts`.
- [ ] 2.2 Implement the v2 store in `service/sdd_store.ts` as new exports alongside the still-wired v1 store (the v1 factory, schema, and symbols remain untouched and in service until §4 rewires the manager — v1 statements prepare eagerly against the v1 schema, so the two stores must coexist rather than share a schema constant): `Insert(agent)` storing `brief_text` read at dispatch, `Get(agentId)`, `ListAll()`, and `IsSddAgent(agentId)`. No v2 update or delete statement of any kind is compiled. Deliverable: 2.1 tests green against the v2 factory; the v1 store's tests still green; build compiles.
- [ ] 2.3 Add a test that a service restart with SDD rows in every run phase leaves the v2 ledger byte-identical (no startup query writes `sdd_agents`). Deliverable: green restart test in `tests/sdd_store.test.ts`.

## 3. Tool Schemas

**Controller-executed precondition — 3.0 blocks every dispatch in this change.**
`registerTool` derives a tool's advertised JSON Schema from a `ZodObject`
shape; both SDD tools are registered by passing a `z.discriminatedUnion`
where a shape is expected, so the live service advertises them with zero
properties while all nine other tools advertise real schemas. Clients that
trust discovery mis-serialize their arguments. Because this change is
executed *through* those tools, 3.0 cannot be dispatched to a subagent — the
controller implements it directly and restarts the service onto the fixed
build before dispatching anything else.

- [x] 3.0 Advertise the SDD dispatch tools' input contract (xsvc-15). Add a failing tool-surface test asserting that `xagent_sdd_start` and `xagent_sdd_followup` each advertise a non-empty input schema naming the discriminating field (`role`/`kind`) and its permitted values; supply the union's JSON Schema explicitly at registration in `service/mcp.ts` while leaving the union itself as the sole runtime validator, so advertised and enforced schemas cannot drift. Deliverable: both tools discoverable from `tools/list` alone; a call constructed from discovery passes validation.
- [ ] 3.1 Add failing schema tests for the four-way `xagent_sdd_start` discriminated union exactly as pinned in design D6 (`implementer` unchanged; merged `reviewer` with optional `task`, unified `brief`, and the task-present/task-absent conditional fields; `fixer` and `re-reviewer` with required `task` and `brief` and no `name`/`round`): v1 role names and the `review_brief` field name rejected, run-id leak guard and `note` retained on all worker-facing text. Also cover the v2 followup schemas: `report` required on both kinds, `round` retained as a render-only field. Deliverable: red tests in `tests/mcp.test.ts`.
- [ ] 3.2 Implement the v2 start and followup schemas in `service/tool_schemas.ts` per design D6, deleting `XagentSddAwaitInputSchema` and `XagentSddCloseInputSchema`. Deliverable: 3.1 tests green.

## 4. SDD Manager

- [ ] 4.1 Add failing manager tests for v2 `Start`: cwd canonicalized and validated before any insert; row inserted before `runManager.create`; render → create → start → submit ordering; a failure after insert leaves the row untouched as a tombstone (no status write, no row deletion — `MarkFailed` has no v2 analogue); result returns exactly `agent_id`, `sequence`, `prompt_path`, `renderer_path`, deliberately dropping v1's `brief_path`/`report_path` echoes of the caller's own inputs. Deliverable: red tests in `tests/sdd_manager.test.ts`.
- [ ] 4.2 Implement v2 `Start` in `service/sdd_manager.ts` for all four roles, including reviewer template selection by task presence and the fixer/re-reviewer render inputs. The fresh-fixer prompt is rendered in TypeScript from the existing `FormatFixFollowup` formatter extended with a plan/task/role header — no new dispatch-prompt renderer role is added; `re-reviewer` reuses the renderer's existing `re-review` role (extend `service/sdd_prompt.ts` render inputs only as needed for that reuse). Deliverable: 4.1 tests green plus golden prompt fixtures in `tests/sdd_prompt.test.ts` for `fixer` (pinning parity with the same-agent fix continuation) and task-less `reviewer`.
- [ ] 4.3 Add failing tests for demoted `Followup`: renders and submits on a live agent with zero ledger writes; returns `{ agent_id, sequence }` with no `turn_number`; rejects an agent_id with no ledger row (`unknown_sdd_agent`, kept from v1); validates kind against the immutable start role (`fix` → `implementer`/`fixer`, `re-review` → `reviewer`/`re-reviewer`, else `sdd_followup_role_mismatch`, kept from v1); returns `sdd_agent_not_live` (replacing v1's `sdd_session_terminal`) with the fresh-agent recovery details when the run is not live; double-call and after-death calls leave the ledger untouched. Deliverable: red tests in `tests/sdd_manager.test.ts`.
- [ ] 4.4 Implement demoted `Followup`: the brief comes from the target's `sdd_agents` row (`brief_path`/`brief_text`), the report path from the required `report` tool input, findings/tests/base/head/diff from tool inputs — no cached turn artifacts, no ledger `report_path` (none exists in v2). Deliverable: 4.3 tests green.
- [ ] 4.5 Delete `conversationalAgents`, the `MessageGeneric` classification branch, the `sdd_turn_in_flight` guard, and the `FollowupRequired` helper with its `sdd_followup_required` error: `xagent_message` on an SDD run submits like any run and is recorded solely by `turn.submitted`. Deliverable: symbols absent; a test proves a message-then-reply cycle on an SDD run round-trips with no ledger write and no special-casing.
- [ ] 4.6 Delete `PersistReportBeforeReturn`, `artifactsByAgent`, `CloseAfterProvider`'s ledger write, and the `Await`/`Close`/`AwaitGeneric`/`CloseGeneric` wrappers that existed to invoke them; delete the `sdd_report_unbound`, `sdd_turn_unresolved`, `sdd_session_closed`, `sdd_followup_missing_paths`, and `sdd_report_path_required` error constructors. Deliverable: symbols absent; a test proves awaiting an SDD run's completion delivers `report.text` from the durable event log with no ledger write.
- [ ] 4.7 With no manager call sites remaining, delete the v1 store: `ReconcileTerminalRuns`, `abandonOpenTurns`, `MarkRunning`, `MarkCompleted`, `MarkFailed`, `MarkAbandoned`, `MarkClosed`, `GetOpenTurn`, `GetLatestTurn`, `GetTurnByCompletedSequence`, the one-shot closed-session repair (`probeClosedSessionTurns`/`repairClosedSessionTurns`), the v1 factory and schema SQL (including the `sdd_dispatch_log` view definition), and their call sites in `service_main`/startup; wire the v2 store everywhere. This is deliberately sequenced after 4.1–4.6 — `sdd_manager.ts` calls these symbols until then, so deleting them earlier cannot leave a compiling tree. Deliverable: symbols absent from the codebase; xagent build compiles; `grep -c 'UPDATE sdd' src/service/sdd_store.ts` returns 0.

## 5. MCP Surface

- [ ] 5.1 Add failing MCP discovery tests: seven generic tools plus exactly `xagent_sdd_start` and `xagent_sdd_followup`; `xagent_sdd_await` and `xagent_sdd_close` are not registered and calls to them report an unknown tool. Deliverable: red tests in `tests/mcp.test.ts`.
- [ ] 5.2 Implement the surface in `service/mcp.ts`: unregister the two deleted tools, route `xagent_await`/`xagent_close`/`xagent_message` straight to the run manager (no SDD manager delegation), and keep `xagent_list` as the sole SDD-aware generic tool. Deliverable: 5.1 tests green.
- [ ] 5.3 Add failing tests and implement the `xagent_list` v2 join in `service/sdd_manager.ts`/`service/run_manager.ts` per the types pinned in design D8: `sdd` block with exactly `role`, `plan` (basename, v1 meaning), `task?`, `cwd`, `brief_path`, `dispatched_at` (dropping v1's `agent` and `closed` fields), plus tombstone entries of the parallel `XagentSddTombstoneRow` shape (`run_id`, `run_missing: true`, `sdd` — no fabricated run fields) for ledger rows without run records, interleaved by `dispatched_at`. Deliverable: green tests in `tests/mcp.test.ts` covering an SDD row, a generic row, and a tombstone.

## 6. Lifecycle Verification

- [ ] 6.1 Add an end-to-end service test: dispatch an implementer, complete a turn, send a same-agent fix followup, complete it, then dispatch a fresh `fixer` after closing the implementer — asserting the ledger holds exactly two immutable rows, all four submissions exist as `turn.submitted` events, and both reports are recoverable from `normalized.jsonl` alone. Deliverable: green e2e test in `tests/e2e.test.ts`.
- [ ] 6.2 Add failure-injection tests: provider start failure after insert (tombstone verified via `xagent_list`), service kill mid-turn followed by restart (startup reconciliation abandons the run record, ledger untouched, `sdd_agent_not_live` steers to a fresh fixer), and a v1 `sdd.sqlite` present at startup (loud refusal naming the reprovision step). Deliverable: green tests in `tests/supervision_e2e.test.ts` and `tests/sdd_store.test.ts`.

## 7. Documentation, Skill, and Spec Sync

Note: xsvc-14 (run directories are the system of record) is satisfied
documentation-only in this change — the service has no pruning, truncation,
or rotation code today, so there is nothing to gate in code. The
requirement constrains future cleanup tooling; no enforcement task exists
here by design.

- [ ] 7.1 Update `plugins/xagent/skills/xagent-subagents/SKILL.md`: dispatch with `sdd_start`/`sdd_followup`, await/message/close like any run, fresh-agent fix/re-review recovery by dispatching a `fixer`/`re-reviewer` for the same plan and task, the four-way role set, and removal of every `xagent_sdd_await`/`xagent_sdd_close` mention; update plugin packaging/install tests to assert the new guidance. Deliverable: green `install_global_test.py`.
- [ ] 7.2 Sync `openspec/specs/xagent-sdd-workflow/spec.md`: remove or rewrite the requirements this change supersedes (turn ledger rows, report-before-return, same-session-mandatory follow-ups, closed-session semantics) to match the v2 contract, and sync `openspec/specs/xagent-service/spec.md` from this change's delta. Deliverable: `openspec` validation passes for both specs.
- [ ] 7.3 Update the canonical `projects/agents/global/skills/openspec-superpowers-workflow/SKILL.md` and agents installer tests for the two-tool SDD dispatch surface and fresh-agent recovery guidance. Deliverable: green agents installer test suite.

## 8. Reprovision and Final Verification

- [ ] 8.1 Document the one-time operator step already performed under the 2.0 gate (delete `<log_root>/sdd.sqlite`, `-wal`, `-shm`; service creates v2 on next start) in `plugins/xagent/README.md`, and verify the refusal message for a stale v1 file names it. Deliverable: README section plus the 6.2 refusal test referencing the same wording.
- [ ] 8.2 Run the full xagent test suite, the dispatch-prompt suite, the plugin packaging tests, and the agents installer tests; repackage plugin runtime assets. Deliverable: all suites green; regenerated `plugins/xagent/assets/`.
