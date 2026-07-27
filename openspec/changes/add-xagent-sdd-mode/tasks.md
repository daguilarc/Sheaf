## 1. SQLite SDD Ledger

- [x] 1.1 Add `better-sqlite3` and its TypeScript declarations to xagent, then add failing store tests for `<service logRoot>/sdd.sqlite`, owner-only permissions, WAL, foreign keys, busy timeout, version-1 creation, and rejection of unknown newer schemas.
- [x] 1.2 Implement the version-1 `sdd_sessions`, `sdd_turns`, index, and `sdd_dispatch_log` schema with canonical `cwd`, constrained statuses, and pre-turn `resume_sequence`, using serialized transactional access.
- [x] 1.3 Add failing tests for plan-name derivation, session creation, monotonically numbered initial/fix/re-review turns, exact brief and findings copies, report-path retention without report-file copying, resume/completion sequences, report completion, failure/abandonment status, close time, and restart-safe reads.
- [x] 1.4 Implement the typed ledger operations and lifecycle transitions required by the store tests without exposing copied brief or findings text in return values or logs.
- [x] 1.5 Add tests and implement startup reconciliation that marks unresolved SDD turns abandoned when the corresponding xagent run is reconciled to an abandoned or other reportless terminal state.

## 2. SDD Prompt Formatting

- [x] 2.1 Add failing tests for strict role-discriminated start and follow-up schemas, including harness/effort/model validation, task-number rules, await/close inputs and deadline bounds, incompatible role/follow-up combinations, and missing or empty artifact files.
- [x] 2.2 Implement an xagent prompt-renderer adapter that invokes `<service repoRoot>/projects/agents/utils/dispatch-prompt` through Python 3 with the caller's canonical worktree only as `cwd`, accepts its single output path, reads the rendered prompt, and preserves renderer validation and drift failures.
- [x] 2.3 Add golden tests and implement the fix follow-up formatter with the stored brief/report paths, verbatim findings, round, named covering tests, fix-only scope, test rerun, report append, and short-status clauses; keep re-review rendering on the upstream `re-review` template.
- [x] 2.4 Add integration fixtures for implementer, task-reviewer, re-review, and code-reviewer prompts and prove controller inputs never need to contain the rendered prompt or brief body.

## 3. Xagent SDD MCP Facade

- [x] 3.1 Add failing MCP discovery and validation tests for `xagent_sdd_start`, `xagent_sdd_followup`, `xagent_sdd_await`, and `xagent_sdd_close`, while preserving all six generic tools.
- [x] 3.2 Implement `xagent_sdd_start` on the existing run manager, including canonical path validation, plan-name derivation, render-before-start, agent-ID preallocation, prepared-before-provider persistence, assignment mapping, failure transitions, and resolved-path results.
- [x] 3.3 Implement `xagent_sdd_followup` with prepared-before-submit persistence, same-session role checks, unresolved-turn exclusion, submission sequence/status updates, and failed-submission recording.
- [x] 3.4 Reject generic `xagent_message` for SDD-owned runs and add tests proving raw messages cannot create untracked SDD turns.
- [x] 3.5 Implement SDD-aware await behavior with generic deadline/cancellation bounds that commits the sanitized delivered assistant report and completion sequence before returning, preserves the caller cursor on persistence failure, and applies the same invariant when generic await is accidentally used for an SDD run.
- [x] 3.6 Implement SDD-aware close behavior and tests that both SDD close and generic close update the session only after the underlying provider session closes.

## 4. Lifecycle and Failure Verification

- [x] 4.1 Add an end-to-end service test covering initial implementer completion, same-agent fix completion, initial reviewer completion, same-agent re-review completion, and final database query results.
- [x] 4.2 Add failure-injection tests for missing Python/templates/trusted renderer, database reservation failure, provider failure after reservation, follow-up submission failure, report transaction failure and retry, incompatible follow-up, concurrent follow-up, unknown agent ID, and startup abandonment reconciliation.
- [x] 4.3 Add cursor-boundary tests proving submitted/completed supervision sequences are stored and no MCP response or ledger column claims a provider JSONL offset or line position.
- [x] 4.4 Update xagent service supervision documentation and capability coverage to document the SDD tool contracts, trusted-renderer and Python/Superpowers prerequisites, database location/schema, write timing, permissions, restart reconciliation, report definition, and generic-tool boundaries.

## 5. Workflow and Plugin Guidance

- [x] 5.1 Update `plugins/xagent/skills/xagent-subagents/SKILL.md` to require the SDD MCP facade for Superpowers SDD, explain start/follow-up/await/close and ledger identity, and scope generic MCP plus quiet CLI fallback to non-SDD work.
- [x] 5.2 Update xagent plugin packaging and install tests to assert the new SDD guidance and MCP-only failure behavior without creating a second skill source.
- [x] 5.3 Update the canonical `projects/agents/global/skills/openspec-superpowers-workflow/SKILL.md` to require xagent SDD MCP for implementation, task review, fixes, re-reviews, and final review while leaving pre-plan helpers outside the task facade.
- [x] 5.4 Update agents installer tests to require all four SDD tools, same-agent follow-ups, report-before-consumption, SDD-only prohibitions, and explicit scoping of native/raw-xagent/terminal fallback guidance to non-SDD helpers.

## 6. Final Verification

- [x] 6.1 Run the focused xagent build, store, renderer, MCP, supervision, packaging, and install tests, then run the complete xagent test suite.
- [x] 6.2 Run the dispatch-prompt and agents installer test suites, including global skill rendering checks against isolated destinations.
- [x] 6.3 Run OpenSpec validation for `add-xagent-sdd-mode` and verify every requirement and scenario is covered by the implementation tests or documented manual inspection.
