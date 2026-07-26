## 1. Supervision State and Persistence

- [x] 1.1 Add failing fake-clock tests for supervised run states, sequenced `supervision.*` events, terminal-state durability, and cursor deduplication.
- [x] 1.2 Implement the transport-independent supervisor state machine and event queue behind narrow clock, process, adapter, and classifier interfaces.
- [x] 1.3 Extend run metadata and logs with supervisor state, event cursor, progress timestamps, owned-process identity, and sanitized watchdog telemetry.
- [x] 1.4 Add startup reconciliation and orderly process-group cleanup tests, then implement `abandoned` reconciliation for active metadata that cannot be safely reattached.

## 2. Deterministic Health and Evidence

- [x] 2.1 Add adapter/runtime tests for process exit, provider completion/failure, transport loss, exposed input/permission waits, explicit cancellation, hard deadline, and live-process silence.
- [x] 2.2 Implement deterministic health classification so every mechanical state produces completion, failure, or attention without calling the semantic classifier.
- [x] 2.3 Add tests for transport-liveness timestamps, semantic-event selection, repeated tool/error fingerprints, evidence truncation, path relativization, and secret redaction.
- [x] 2.4 Implement the bounded semantic evidence window and configurable silence, deadline, suspicion, and input-size policies.

## 3. Haiku Semantic Watchdog

- [x] 3.1 Define and test the watchdog request and verdict schemas, including normalization of invalid, low-confidence, failed, and over-budget classifier results to `uncertain`.
- [x] 3.2 Implement an injected Haiku classifier launcher that uses a fresh safe-mode Claude Code invocation with tools, MCP, repository access, and session persistence disabled.
- [x] 3.3 Add fake-clock tests proving Haiku is never used for silence/crash/completion/input/deadline states and is eligible only for active semantic checkpoints or suspicion signals.
- [x] 3.4 Implement the 10/20/40-minute default backoff, minimum interval, per-turn reset, per-invocation bounds, and eight-call run cap.
- [x] 3.5 Add verdict tests proving healthy high-confidence checks remain controller-silent while `derailed`, `uncertain`, low-confidence, and invalid results emit one advisory attention event without acting on the worker.

## 4. Conductor-Managed Xagent Service

- [x] 4.1 Add failing service tests for registry-derived loopback bind, `GET /health`, idempotent `POST /exit`, unknown routes, and graceful listener shutdown.
- [x] 4.2 Add `xagent` at `127.0.0.1:9005` to `config/services.json` plus tracked root/project `xagent-service-run` Make targets, and implement the HTTP service entry point.
- [x] 4.3 Move supervised-run ownership into the long-lived service so MCP/HTTP request cancellation and controller disconnect leave the provider, timers, event queue, and logs active.
- [x] 4.4 Add service lifecycle tests proving Conductor-style start, health, log capture, stop, and restart behavior, including orderly closure of owned provider process groups.
- [x] 4.5 Persist PID plus process-start identity and test startup reconciliation that marks stale runs `abandoned`, cleans up only proven owned processes, and never signals a PID with mismatched identity.

## 5. Streamable HTTP MCP and Final Report Delivery

- [x] 5.1 Add Streamable HTTP MCP contract tests for `xagent_start`, `xagent_await`, `xagent_inspect`, `xagent_message`, `xagent_interrupt`, and `xagent_close` at `/mcp`.
- [x] 5.2 Implement all MCP tools as handlers over service-owned supervisors and the configured central log root; validate and canonicalize the requested absolute working directory before creating run state.
- [x] 5.3 Define the versioned completion envelope and add tests proving it contains the complete sanitized final assistant report and compact metadata but no intermediate transcript, tool events, raw provider events, or watchdog evidence.
- [x] 5.4 Add deterministic `missing_final_report` tests for a successful provider turn without a final assistant message.
- [x] 5.5 Add blocking-await tests proving routine progress does not complete the request, completion/attention does, `after_sequence` prevents duplicate delivery, and a replacement controller can inspect and await the same `run_id`.
- [x] 5.6 Configure 7200-second server and plugin MCP request timeouts with a 7000-second default/maximum await; test cancellation cleanup and a synthetic 90-minute healthy run that produces no intermediate boss wake.
- [ ] 5.7 Add plugin `.mcp.json` HTTP discovery for `http://127.0.0.1:9005/mcp`, reference it from the plugin manifest, remove any plugin-local supervisor packaging, and test discovery from a temporary non-Sheaf repository.

## 6. Quiet Service-Client CLI

- [ ] 6.1 Add CLI parser and help tests for service-backed `xagent supervise` start/await plus inspect, follow-up, interrupt, and close operations against an existing `run_id`.
- [ ] 6.2 Implement the quiet CLI as a client of the registered xagent service while leaving `xagent run --subagent|--full` parsing, embedded runtime, and output behavior unchanged.
- [ ] 6.3 Add long-running fake-service tests proving quiet stdout contains no healthy deltas, tools, raw events, or unchanged status and emits only infrastructure failure, attention, terminal result, deadline, or explicit inspection output.
- [ ] 6.4 Add CLI integration tests for attention followed by continued await, explicit interrupt, same-session follow-up when ready, state-invalid follow-up rejection, controller restart/reattachment, cancellation, and close.
- [ ] 6.5 Add an unavailable-service test proving the CLI emits structured infrastructure failure and never launches an unmanaged embedded supervisor.

## 7. Workflow Guidance

- [ ] 7.1 Update the canonical and plugin-packaged `xagent-subagents` skill to verify the Conductor-managed service, use HTTP MCP supervision, consume the final report directly, document the quiet service-client fallback, explain the deterministic/semantic boundary, and prohibit routine polling.
- [ ] 7.2 Update the canonical `openspec-superpowers-workflow` skill to require long native mailbox waits, blocker-or-final child messages, and reason-gated status inspection for both native and xagent subagents.
- [ ] 7.3 Add installer/package assertions that distributed skills contain the required service-health, event-wait, direct-report, no-polling, sparse-message, fallback, and agentic-infrastructure escalation guidance.

## 8. Validation and Cost Regression

- [ ] 8.1 Extend packaged validation with Conductor-managed service and temporary-repository CLI/MCP smoke runs covering discovery, health, blocking wait, full final-report delivery, controller disconnect/reattachment, attention, cursor deduplication, cancellation, and owned-process cleanup.
- [ ] 8.2 Add recorded-transcript watchdog fixtures for healthy exploration, repeated-tool loops, error thrashing, task contradiction, insufficient evidence, silence, and crash; measure and document false-alert behavior.
- [ ] 8.3 Add a controlled long-fake-run comparison that reports controller-visible wake count and parent processed tokens for 30-second polling, service-client fallback, and MCP await, including a 90-minute case.
- [ ] 8.4 Run xagent unit/e2e/package tests, Conductor service tests, agents installer tests, strict OpenSpec validation, and `git diff --check`; document the verified service topology, final-report envelope, watchdog cadence, budgets, timeouts, and rollback procedure.
