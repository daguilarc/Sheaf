## 1. `turn.submitted` Event (precondition for everything else)

- [ ] 1.1 Add failing supervision tests for a `turn.submitted` normalized event: emitted on every `Supervisor.submit()` with the full sanitized submitted text, sequenced before the turn's subsequent events, durable via `eventSink` before submit resolves, and emitted for both rendered SDD prompts and raw messages. Deliverable: red tests in `tests/supervision.test.ts`.
- [ ] 1.2 Implement `turn.submitted` emission in `supervision/supervisor.ts` (new event type in `supervision/types.ts`), including the appended controller note in the recorded text. Deliverable: 1.1 tests green.
- [ ] 1.3 Add failing tests that `turn.submitted` never completes a live await and that `isPersistedAwaitWake` in `service/run_manager.ts` ignores it on the persisted path; implement the filter. Deliverable: await tests green in `tests/mcp_await.test.ts`.

## 2. Ledger v2 Store

- [ ] 2.1 Add failing store tests for schema v2: `sdd_agents` table and `sdd_dispatch_log` view created at `user_version = 2`; owner-only permissions, WAL, foreign keys, and busy timeout preserved; opening a database with any other `user_version` (including v1) fails with an error naming the file to delete and stating v1 is not migrated. Deliverable: red tests in `tests/sdd_store.test.ts`.
- [ ] 2.2 Implement the v2 store in `service/sdd_store.ts`: `Insert(agent)` with brief SHA-256 computed from the brief content at dispatch, `Get(agentId)`, `ListAll()`, `IsSddAgent(agentId)`, and validation that `predecessor_agent_id` references an existing row. No update or delete statement of any kind is compiled. Deliverable: 2.1 tests green; `grep -c 'UPDATE sdd' src/service/sdd_store.ts` returns 0.
- [ ] 2.3 Delete `ReconcileTerminalRuns`, `abandonOpenTurns`, `MarkRunning`, `MarkCompleted`, `MarkFailed`, `MarkAbandoned`, `MarkClosed`, `GetOpenTurn`, `GetLatestTurn`, `GetTurnByCompletedSequence`, and the one-shot closed-session repair (`probeClosedSessionTurns`/`repairClosedSessionTurns`) from `service/sdd_store.ts`, and remove their call sites in `service_main`/startup. Deliverable: symbols absent from the codebase; xagent build compiles.
- [ ] 2.4 Add a test that a service restart with SDD rows in every run phase leaves the ledger byte-identical (no startup query writes `sdd_agents`). Deliverable: green restart test in `tests/sdd_store.test.ts`.

## 3. Tool Schemas

- [ ] 3.1 Add failing schema tests for the four-way `xagent_sdd_start` discriminated union (`implementer`, `reviewer` with optional `task`, `fixer`, `re-reviewer`): `predecessor_agent_id` required for `fixer`/`re-reviewer` and optional for the others, v1 role names rejected, run-id leak guard and `note` retained on all worker-facing text. Deliverable: red tests in `tests/mcp.test.ts`.
- [ ] 3.2 Implement the v2 schemas in `service/tool_schemas.ts`, deleting `XagentSddAwaitInputSchema` and `XagentSddCloseInputSchema`. Deliverable: 3.1 tests green.

## 4. SDD Manager

- [ ] 4.1 Add failing manager tests for v2 `Start`: cwd canonicalized and validated before any insert; row inserted before `runManager.create`; render → create → start → submit ordering; a failure after insert leaves the row untouched as a tombstone (no status write, no row deletion); result returns `agent_id`, `sequence`, `prompt_path`, `renderer_path`. Deliverable: red tests in `tests/sdd_manager.test.ts`.
- [ ] 4.2 Implement v2 `Start` in `service/sdd_manager.ts` for all four roles, including reviewer template selection by task presence and the fixer/re-reviewer render inputs carrying predecessor identity (extend `service/sdd_prompt.ts` render inputs as needed; the fix continuation formatter becomes the basis of the fresh-fixer template rendering). Deliverable: 4.1 tests green plus golden prompt fixtures for `fixer` and task-less `reviewer` in `tests/sdd_prompt.test.ts`.
- [ ] 4.3 Add failing tests for demoted `Followup`: renders and submits on a live agent with zero ledger writes; validates kind against the immutable start role (`fix` → `implementer`/`fixer`, `re-review` → `reviewer`/`re-reviewer`); returns `sdd_agent_not_live` with the fresh-agent recovery details when the run is not live; double-call and after-death calls leave the ledger untouched. Deliverable: red tests in `tests/sdd_manager.test.ts`.
- [ ] 4.4 Implement demoted `Followup`, sourcing brief/report paths from tool inputs and the `sdd_agents` row rather than cached turn artifacts. Deliverable: 4.3 tests green.
- [ ] 4.5 Delete `conversationalAgents` and the `MessageGeneric` classification branch: `xagent_message` on an SDD run submits like any run and is recorded solely by `turn.submitted`. Deliverable: symbol absent; a test proves a message-then-reply cycle on an SDD run round-trips with no ledger write and no special-casing.
- [ ] 4.6 Delete `PersistReportBeforeReturn`, `artifactsByAgent`, `CloseAfterProvider`'s ledger write, and the `Await`/`Close`/`AwaitGeneric`/`CloseGeneric` wrappers that existed to invoke them; delete the `sdd_report_unbound`, `sdd_turn_unresolved`, `sdd_session_closed`, `sdd_followup_missing_paths`, and `sdd_report_path_required` error constructors. Deliverable: symbols absent; a test proves awaiting an SDD run's completion delivers `report.text` from the durable event log with no ledger write.

## 5. MCP Surface

- [ ] 5.1 Add failing MCP discovery tests: seven generic tools plus exactly `xagent_sdd_start` and `xagent_sdd_followup`; `xagent_sdd_await` and `xagent_sdd_close` are not registered and calls to them report an unknown tool. Deliverable: red tests in `tests/mcp.test.ts`.
- [ ] 5.2 Implement the surface in `service/mcp.ts`: unregister the two deleted tools, route `xagent_await`/`xagent_close`/`xagent_message` straight to the run manager (no SDD manager delegation), and keep `xagent_list` as the sole SDD-aware generic tool. Deliverable: 5.1 tests green.
- [ ] 5.3 Add failing tests and implement the `xagent_list` v2 join in `service/sdd_manager.ts`/`service/run_manager.ts`: `sdd` block with `role`, `plan`, `task`, `brief_path`, `predecessor_agent_id`, `dispatched_at` (dropping v1's `closed` flag), plus `run_missing: true` tombstone entries for ledger rows without run records, ordered by `dispatched_at`. Deliverable: green tests in `tests/mcp.test.ts` covering an SDD row, a generic row, and a tombstone.

## 6. Lifecycle Verification

- [ ] 6.1 Add an end-to-end service test: dispatch an implementer, complete a turn, send a same-agent fix followup, complete it, then dispatch a fresh `fixer` with `predecessor_agent_id` after closing the implementer — asserting the ledger holds exactly two immutable rows, all four submissions exist as `turn.submitted` events, and both reports are recoverable from `normalized.jsonl` alone. Deliverable: green e2e test in `tests/e2e.test.ts`.
- [ ] 6.2 Add failure-injection tests: provider start failure after insert (tombstone verified via `xagent_list`), service kill mid-turn followed by restart (startup reconciliation abandons the run record, ledger untouched, `sdd_agent_not_live` steers to a fresh fixer), and a v1 `sdd.sqlite` present at startup (loud refusal naming the reprovision step). Deliverable: green tests in `tests/supervision_e2e.test.ts` and `tests/sdd_store.test.ts`.

## 7. Documentation, Skill, and Spec Sync

- [ ] 7.1 Update `plugins/xagent/skills/xagent-subagents/SKILL.md`: dispatch with `sdd_start`/`sdd_followup`, await/message/close like any run, fresh-agent fix/re-review recovery via `predecessor_agent_id`, the four-way role set, and removal of every `xagent_sdd_await`/`xagent_sdd_close` mention; update plugin packaging/install tests to assert the new guidance. Deliverable: green `install_global_test.py`.
- [ ] 7.2 Sync `openspec/specs/xagent-sdd-workflow/spec.md`: remove or rewrite the requirements this change supersedes (turn ledger rows, report-before-return, same-session-mandatory follow-ups, closed-session semantics) to match the v2 contract, and sync `openspec/specs/xagent-service/spec.md` from this change's delta. Deliverable: `openspec` validation passes for both specs.
- [ ] 7.3 Update the canonical `projects/agents/global/skills/openspec-superpowers-workflow/SKILL.md` and agents installer tests for the two-tool SDD dispatch surface and fresh-agent recovery guidance. Deliverable: green agents installer test suite.

## 8. Reprovision and Final Verification

- [ ] 8.1 Document the one-time operator step (delete `<log_root>/sdd.sqlite`, `-wal`, `-shm`; service creates v2 on next start) in `plugins/xagent/README.md`, and verify the refusal message for a stale v1 file names it. Deliverable: README section plus the 6.2 refusal test referencing the same wording.
- [ ] 8.2 Run the full xagent test suite, the dispatch-prompt suite, the plugin packaging tests, and the agents installer tests; repackage plugin runtime assets. Deliverable: all suites green; regenerated `plugins/xagent/assets/`.
