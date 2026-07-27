# Xagent SDD Mode Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add an opinionated xagent MCP facade that renders Superpowers SDD prompts, preserves same-agent follow-ups, and records every brief/report turn in SQLite before delivering reports to the controller.

**Architecture:** The existing xagent service remains the only supervisor. A new synchronous SQLite store owns SDD session/turn metadata, a prompt adapter invokes the trusted `dispatch-prompt` from the service checkout, and an SDD coordinator wraps `XagentRunManager` for start/follow-up/await/close plus generic-tool guardrails. MCP registration delegates SDD-aware generic operations and the four new SDD tools to that coordinator.

**Tech Stack:** TypeScript 5.8, Node.js 20+, `better-sqlite3`, Zod, Model Context Protocol Streamable HTTP, Python 3 `dispatch-prompt`, Node test runner, Python `unittest`.

## Global Constraints

- Treat the OpenSpec artifacts under `openspec/changes/add-xagent-sdd-mode/` as the source of truth.
- Use strict TDD for production behavior: write one failing test, run it and confirm the expected failure, add minimal implementation, then rerun focused and neighboring tests.
- Do not use the broken task-analyzer decomposition agent or create `.assignments.yaml`.
- All implementation and review dispatches use interrupt-driven xagent service MCP. Do not use native subagents.
- Implementers use Cursor `grok-4.5` or `composer-2.5`; all task and final reviewers use Claude Code `opus`.
- Render every implementer, task-reviewer, re-review, and final code-review prompt with `projects/agents/utils/dispatch-prompt`; dispatch only a short pointer to the rendered file.
- Keep one implementer and one reviewer session open through each task's fix/re-review loop.
- The trusted runtime renderer is `<service repoRoot>/projects/agents/utils/dispatch-prompt`; caller `cwd` is only the subprocess working directory.
- The SDD database is `<service logRoot>/sdd.sqlite`; do not add service-side `XAGENT_LOG_ROOT` environment resolution.
- `resume_sequence` is the cursor captured immediately before turn submission; it is not a JSONL line or byte position.
- Store the sanitized final assistant report delivered through xagent. Store only the mutable Superpowers report artifact path, not that file's contents.
- Do not persist brief/findings text in MCP results, normalized supervision logs, or service stdout/stderr.
- Preserve all six generic xagent tools for non-SDD work.
- Do not edit installed skill copies. Edit canonical sources and regenerate only tracked plugin runtime assets through the existing packaging target.
- Do not modify the unrelated untracked `projects/synth/browser/package-lock.json` or `projects/synth/miniapp/`.
- Follow the user's code conventions: opening braces on new lines, `m_` member variables, `x_` constants, HammerCase member functions, public structs instead of private classes, no C-style casts, and standalone comment terminator lines containing `//`.

## File Map

- Create `projects/xagent/src/service/sdd_store.ts`: versioned SQLite schema and typed session/turn transitions.
- Create `projects/xagent/tests/sdd_store.test.ts`: schema, permissions, lifecycle, restart, and privacy tests.
- Create `projects/xagent/src/service/sdd_prompt.ts`: trusted renderer process adapter and deterministic fix formatter.
- Create `projects/xagent/tests/sdd_prompt.test.ts`: renderer arguments, trust boundary, role fixtures, and fix golden tests.
- Create `projects/xagent/src/service/sdd_manager.ts`: SDD lifecycle coordinator over store, prompt adapter, and `XagentRunManager`.
- Create `projects/xagent/tests/sdd_manager.test.ts`: start/follow-up/await/close and failure-injection tests.
- Modify `projects/xagent/src/service/tool_schemas.ts`: four strict SDD tool schemas and exported input types.
- Modify `projects/xagent/src/service/mcp.ts`: register SDD tools and route generic message/await/close through SDD-aware guards.
- Modify `projects/xagent/src/service/server.ts`: inject the SDD coordinator into the MCP handler.
- Modify `projects/xagent/src/service_main.ts`: construct/close the store and reconcile unresolved turns after xagent startup reconciliation.
- Modify `projects/xagent/tests/mcp.test.ts`: ten-tool discovery and MCP facade behavior.
- Modify `projects/xagent/tests/mcp_await.test.ts`: generic/SDD await report-before-return and cursor retry coverage.
- Modify `projects/xagent/tests/service.test.ts`: startup reconciliation and orderly store shutdown.
- Modify `projects/xagent/tests/e2e.test.ts`: full implement/fix/review/re-review ledger flow.
- Modify `projects/xagent/package.json` and `projects/xagent/package-lock.json`: SQLite runtime and type dependencies.
- Modify `projects/xagent/docs/supervision.md`: SDD API, schema, prerequisites, failure, and security contracts.
- Modify `plugins/xagent/scripts/install_global_test.py`: packaged ten-tool discovery and SDD await smoke.
- Regenerate `plugins/xagent/assets/xagent/`: tracked plugin client runtime assets.
- Modify `plugins/xagent/skills/xagent-subagents/SKILL.md`: SDD-only facade guidance and non-SDD fallback scope.
- Modify `projects/agents/global/skills/openspec-superpowers-workflow/SKILL.md`: mandatory xagent SDD execution flow.
- Modify `projects/agents/scripts/install_test.py`: canonical guidance assertions.

## Execution Assignments

- Task 1 implementer: Cursor `grok-4.5`, high effort.
- Task 2 implementer: Cursor `composer-2.5`, high effort.
- Task 3 implementer: Cursor `grok-4.5`, high effort.
- Task 4 implementer: Cursor `grok-4.5`, high effort.
- Task 5 implementer: Cursor `composer-2.5`, high effort.
- Task 6 implementer: Cursor `composer-2.5`, medium effort.
- Every task reviewer and the final reviewer: Claude Code `opus`, high effort.

---

### Task 1: Versioned SQLite SDD Ledger

**OpenSpec coverage:** 1.1–1.5; xsdd-4; storage portions of xsdd-5 and xsdd-6.

**Files:**
- Create: `projects/xagent/src/service/sdd_store.ts`
- Create: `projects/xagent/tests/sdd_store.test.ts`
- Modify: `projects/xagent/package.json`
- Modify: `projects/xagent/package-lock.json`

**Interfaces:**
- Produces:

```typescript
export type SddRole = "implementer" | "task-reviewer" | "code-reviewer";
export type SddTurnKind = "initial" | "fix" | "re_review";
export type SddTurnStatus = "prepared" | "running" | "completed" | "failed" | "abandoned";

export type SddStore = {
    ReserveInitial(input: ReserveInitialInput): void;
    PrepareFollowup(input: PrepareFollowupInput): number;
    MarkRunning(agentId: string, turnNumber: number, resumeSequence: number): void;
    MarkCompleted(agentId: string, turnNumber: number, reportText: string, completedSequence: number): void;
    MarkFailed(agentId: string, turnNumber: number): void;
    MarkAbandoned(agentId: string, turnNumber: number): void;
    MarkClosed(agentId: string, closedAt: string): void;
    GetSession(agentId: string): SddSessionRecord | undefined;
    GetOpenTurn(agentId: string): SddTurnRecord | undefined;
    IsSddAgent(agentId: string): boolean;
    ReconcileTerminalRuns(phases: ReadonlyMap<string, string>): void;
    Close(): void;
};

export function CreateSddStore(logRoot: string, clock?: () => Date): SddStore;
```

- Consumes: `better-sqlite3`; service `logRoot`; preallocated xagent run IDs.

- [ ] **Step 1: Add the SQLite dependency**

Run:

```bash
cd projects/xagent
npm install better-sqlite3
npm install --save-dev @types/better-sqlite3
```

Expected: `package.json` and `package-lock.json` record the latest compatible packages while retaining `"node": ">=20"`.

- [ ] **Step 2: Write failing schema and permission tests**

Add tests that create a temporary log root, call `CreateSddStore`, and assert:

```typescript
assert.equal(database.pragma("user_version", { simple: true }), 1);
assert.equal(database.pragma("journal_mode", { simple: true }), "wal");
assert.equal(database.pragma("foreign_keys", { simple: true }), 1);
assert.equal(stat.mode & 0o777, 0o600);
assert.equal(parentStat.mode & 0o077, 0);
```

Also create a database with `PRAGMA user_version = 2` and assert opening rejects without changing its version.

- [ ] **Step 3: Run the focused test and confirm RED**

Run:

```bash
cd projects/xagent
npm run build
node --test dist/tests/sdd_store.test.js
```

Expected: failure because `CreateSddStore` and the version-1 schema do not exist.

- [ ] **Step 4: Implement version-1 schema creation**

Use the exact schema from `openspec/changes/add-xagent-sdd-mode/design.md`, including:

```sql
CREATE TABLE sdd_sessions
(
    agent_id TEXT PRIMARY KEY,
    plan_name TEXT NOT NULL,
    plan_path TEXT NOT NULL,
    cwd TEXT NOT NULL,
    task_number INTEGER,
    agent TEXT NOT NULL,
    harness TEXT NOT NULL,
    effort TEXT NOT NULL,
    role TEXT NOT NULL,
    started_at TEXT NOT NULL,
    closed_at TEXT
);
```

Create `sdd_turns`, `sdd_turns_agent_status`, and `sdd_dispatch_log` with constrained kinds/statuses, foreign keys, resume/completion sequences, and copied brief/findings/report fields. Set WAL, foreign keys, bounded busy timeout, owner-only permissions, and `user_version = 1` transactionally.

- [ ] **Step 5: Write failing lifecycle tests**

Test reservation, follow-up numbering, exact copied text, mutable report path, immutable assistant reports, failed/abandoned transitions, close timestamp, restart reads, and `ReconcileTerminalRuns`. Assert returned records never include a rendered prompt or an accidental JSONL offset field.

- [ ] **Step 6: Run lifecycle tests and confirm RED**

Run the focused command from Step 3.

Expected: schema tests pass; lifecycle tests fail because transition methods are not implemented.

- [ ] **Step 7: Implement typed transactions**

Implement every `SddStore` operation as a prepared statement or `better-sqlite3` transaction. `PrepareFollowup` computes `MAX(turn_number) + 1` inside the transaction. Reject illegal transitions rather than silently updating zero rows.

- [ ] **Step 8: Run focused and neighboring tests**

Run:

```bash
cd projects/xagent
npm run build
node --test dist/tests/sdd_store.test.js dist/tests/logs.test.js
```

Expected: all tests pass.

- [ ] **Step 9: Commit**

```bash
git add projects/xagent/package.json projects/xagent/package-lock.json projects/xagent/src/service/sdd_store.ts projects/xagent/tests/sdd_store.test.ts
git commit -m "feat(xagent): add versioned SDD ledger"
```

---

### Task 2: SDD Schemas and Trusted Prompt Formatting

**OpenSpec coverage:** 2.1–2.4; xsdd-2, xsdd-3 prompt clauses, xsdd-7, xsdd-8 input validation.

**Files:**
- Create: `projects/xagent/src/service/sdd_prompt.ts`
- Create: `projects/xagent/tests/sdd_prompt.test.ts`
- Modify: `projects/xagent/src/service/tool_schemas.ts`
- Modify: `projects/xagent/tests/mcp_await.test.ts`

**Interfaces:**
- Produces:

```typescript
export const XagentSddStartInputSchema = z.discriminatedUnion("role", [
    ImplementerStartSchema,
    TaskReviewerStartSchema,
    CodeReviewerStartSchema,
]);

export const XagentSddFollowupInputSchema = z.discriminatedUnion("kind", [
    FixFollowupSchema,
    ReReviewFollowupSchema,
]);

export function RenderSddPrompt(input: RenderSddPromptInput): Promise<RenderedSddPrompt>;
export function FormatFixFollowup(input: FormatFixFollowupInput): string;
```

- Consumes: existing harness/thinking enums and generic supervision policy schema; trusted service `repoRoot`; canonical caller `cwd`.

- [ ] **Step 1: Write failing strict-schema tests**

Add cases for:

```typescript
XagentSddStartInputSchema.parse({
    role: "implementer",
    cwd,
    plan,
    task: 1,
    name: "Versioned SQLite SDD Ledger",
    brief,
    report,
    agent: "grok-4.5",
    harness: "cursor",
    effort: "high",
});
```

Reject empty `agent`, unknown harness/effort/role, missing task for task roles, task on invalid shapes, unknown fields, invalid `agent_id`, missing `after_sequence`, and deadline `7001`. Confirm code-reviewer permits no task and requires a review-brief file.

- [ ] **Step 2: Run schema tests and confirm RED**

Run:

```bash
cd projects/xagent
npm run build
node --test dist/tests/sdd_prompt.test.js dist/tests/mcp_await.test.js
```

Expected: failure because SDD schemas are absent.

- [ ] **Step 3: Implement strict schemas**

Reuse exported generic policy/cwd pieces rather than defining conflicting bounds. Map `effort` to the existing `ThinkingLevel`. Define SDD await as `{ agent_id, after_sequence, deadline_seconds = 7000 }` and close as `{ agent_id }`.

- [ ] **Step 4: Write failing trusted-renderer tests**

Create a fake trusted repo root with an executable `projects/agents/utils/dispatch-prompt` and a caller worktree containing a different sentinel script. Assert `RenderSddPrompt`:

- invokes only the trusted script through `python3`
- sets subprocess `cwd` to the canonical caller worktree
- passes role-discriminated arguments exactly
- reads only the one absolute output path printed on stdout
- surfaces nonzero exit, missing Python, missing script, empty/multiple stdout lines, and unreadable output as structured failures
- maps code-reviewer brief contents through `--requirements @<brief>`

- [ ] **Step 5: Run renderer tests and confirm RED**

Run the focused command from Step 2.

Expected: schema tests pass; renderer and formatter tests fail.

- [ ] **Step 6: Implement renderer and fix formatter**

Use `spawn`/`execFile` argument arrays without a shell. The fix formatter must emit all golden clauses:

```text
Fix round <R>.
Read the original brief at <BRIEF>.
Read and address only the open findings at <FINDINGS>.
Run these covering tests: <TESTS>.
Append the fix report to <REPORT>.
Return only the short Superpowers status contract.
```

Include verbatim findings without controller summarization. Keep secrets and bulk text out of thrown errors.

- [ ] **Step 7: Add all-role fixture tests**

Render implementer, task-reviewer, re-review, and code-reviewer using a pinned temporary templates root. Assert no required placeholder remains and the caller-provided MCP data contains paths rather than prompt or brief bodies.

- [ ] **Step 8: Run focused tests**

Run:

```bash
cd projects/xagent
npm run build
node --test dist/tests/sdd_prompt.test.js dist/tests/mcp_await.test.js
```

Expected: all tests pass.

- [ ] **Step 9: Commit**

```bash
git add projects/xagent/src/service/tool_schemas.ts projects/xagent/src/service/sdd_prompt.ts projects/xagent/tests/sdd_prompt.test.ts projects/xagent/tests/mcp_await.test.ts
git commit -m "feat(xagent): add SDD prompt contracts"
```

---

### Task 3: SDD Start and Same-Session Follow-up

**OpenSpec coverage:** 3.1–3.4 start/follow-up portions; xsdd-1 through xsdd-3; start/follow-up portions of xsdd-5.

**Files:**
- Create: `projects/xagent/src/service/sdd_manager.ts`
- Create: `projects/xagent/tests/sdd_manager.test.ts`
- Modify: `projects/xagent/src/service/run_manager.ts`
- Modify: `projects/xagent/src/service/mcp.ts`
- Modify: `projects/xagent/tests/mcp.test.ts`

**Interfaces:**
- Produces:

```typescript
export type SddManager = {
    Start(input: XagentSddStartInput): Promise<XagentSddStartResult>;
    Followup(input: XagentSddFollowupInput): Promise<XagentSddFollowupResult>;
    Await(input: XagentSddAwaitInput, signal?: AbortSignal): Promise<XagentSddAwaitResult>;
    Close(input: XagentSddCloseInput): Promise<XagentSddCloseResult>;
    MessageGeneric(input: XagentMessageInput): Promise<MessageRunResult>;
    AwaitGeneric(input: XagentAwaitInput, signal?: AbortSignal): Promise<AwaitRunResult>;
    CloseGeneric(input: XagentCloseInput): Promise<CloseRunResult>;
};
```

- Consumes: `SddStore`, `RenderSddPrompt`, `FormatFixFollowup`, `XagentRunManager.create({ runId })`, canonical working-directory validation.

- [ ] **Step 1: Write failing start lifecycle tests**

Inject fake store, prompt renderer, run manager, and clock. Assert the order:

```text
canonicalize cwd
→ read/render brief
→ preallocate run ID
→ ReserveInitial(prepared)
→ create exact run ID
→ start
→ capture pre-turn sequence
→ submit
→ MarkRunning
→ return agent_id/sequence/resolved paths
```

Assert reservation failure creates no run; create/start/submit failure marks failed and closes any run.

- [ ] **Step 2: Run manager tests and confirm RED**

Run:

```bash
cd projects/xagent
npm run build
node --test dist/tests/sdd_manager.test.js
```

Expected: failure because `SddManager` does not exist.

- [ ] **Step 3: Implement start with exact run-ID creation**

Use existing `XagentRunManager.create({ runId, ... })`, `start`, `inspect`, and `submit`; do not weaken generic `startRun`. Derive `plan_name` from the final plan basename suffix and map `agent`/`effort` to `model`/`thinkingLevel`.

- [ ] **Step 4: Write failing follow-up tests**

Cover:

- implementer `fix` uses the same run ID and stored brief/report paths
- reviewer `re-review` uses the same run ID and upstream renderer
- one unresolved turn blocks another follow-up
- wrong role/kind and unknown/terminal agent reject before provider input
- prepared row exists before submit
- submit failure marks the new turn failed
- generic message on an SDD run returns `sdd_followup_required`
- generic message on a non-SDD run remains unchanged

- [ ] **Step 5: Implement follow-up and generic-message guard**

Capture the pre-turn sequence before `submit`, call `PrepareFollowup`, then submit and mark running. Keep findings out of error text.

- [ ] **Step 6: Register start/follow-up tools**

Add all four SDD tool names to MCP registration, but make await/close handlers call the not-yet-complete coordinator methods so discovery is correct. Route generic message through `MessageGeneric`.

- [ ] **Step 7: Run focused tests**

Run:

```bash
cd projects/xagent
npm run build
node --test dist/tests/sdd_manager.test.js dist/tests/mcp.test.js
```

Expected: start/follow-up tests and ten-tool discovery pass.

- [ ] **Step 8: Commit**

```bash
git add projects/xagent/src/service/sdd_manager.ts projects/xagent/src/service/run_manager.ts projects/xagent/src/service/mcp.ts projects/xagent/tests/sdd_manager.test.ts projects/xagent/tests/mcp.test.ts
git commit -m "feat(xagent): add SDD start and follow-up"
```

---

### Task 4: Report-Before-Return Await, Close, and Restart Reconciliation

**OpenSpec coverage:** 3.5–3.6; 4.2–4.3; xsdd-5, xsdd-6, xsdd-8.

**Files:**
- Modify: `projects/xagent/src/service/sdd_manager.ts`
- Modify: `projects/xagent/src/service/server.ts`
- Modify: `projects/xagent/src/service_main.ts`
- Modify: `projects/xagent/tests/sdd_manager.test.ts`
- Modify: `projects/xagent/tests/mcp_await.test.ts`
- Modify: `projects/xagent/tests/service.test.ts`

**Interfaces:**
- Consumes: the coordinator registered in Task 3; existing `AwaitRunResult` and startup reconciliation results.
- Produces: transactional report delivery and terminal-turn reconciliation.

- [ ] **Step 1: Write failing report-before-return tests**

Use a completion result containing `report.text = "sanitized report"`. Assert:

```text
runManager.awaitRun
→ store.MarkCompleted(report, completion sequence)
→ caller receives report
```

Inject `MarkCompleted` failure and assert the call returns `sdd_persistence_failed` without returning the completion sequence; retrying the same `after_sequence` records and returns the durable completion.

- [ ] **Step 2: Run await tests and confirm RED**

Run:

```bash
cd projects/xagent
npm run build
node --test dist/tests/sdd_manager.test.js dist/tests/mcp_await.test.js
```

Expected: report-order and retry tests fail.

- [ ] **Step 3: Implement SDD and generic await hooks**

For an SDD-owned run, both `Await` and `AwaitGeneric` persist successful reports before return. Deadline and attention results do not complete the turn. Cancellation remains request-local. Never rewrite `resume_sequence` after submission.

- [ ] **Step 4: Write failing close tests**

Assert SDD and generic close call the underlying provider close first, then `MarkClosed`. Provider-close failure must leave `closed_at` unset.

- [ ] **Step 5: Implement close hooks**

Route generic close through `CloseGeneric`; non-SDD close remains behaviorally identical.

- [ ] **Step 6: Write failing startup reconciliation tests**

Seed prepared/running/completed turns. Feed startup phases where one run is abandoned, one terminal failed without report, one live, and one completed with report. Assert only unresolved reportless terminal turns become abandoned.

- [ ] **Step 7: Implement startup reconciliation**

Construct the store from `config.logRoot`, pass it into the SDD manager and MCP handler, and after existing `reconcileStaleRuns` resolves call `ReconcileTerminalRuns` with persisted phases. Close the store during orderly shutdown after active runs close.

- [ ] **Step 8: Run focused tests**

Run:

```bash
cd projects/xagent
npm run build
node --test dist/tests/sdd_manager.test.js dist/tests/mcp_await.test.js dist/tests/service.test.js
```

Expected: all tests pass.

- [ ] **Step 9: Commit**

```bash
git add projects/xagent/src/service/sdd_manager.ts projects/xagent/src/service/server.ts projects/xagent/src/service_main.ts projects/xagent/tests/sdd_manager.test.ts projects/xagent/tests/mcp_await.test.ts projects/xagent/tests/service.test.ts
git commit -m "feat(xagent): persist SDD lifecycle results"
```

---

### Task 5: End-to-End MCP, Packaging, and Operations Documentation

**OpenSpec coverage:** 4.1–4.4; 5.2 packaging portion; xsvc-4 through xsvc-6.

**Files:**
- Modify: `projects/xagent/tests/e2e.test.ts`
- Modify: `projects/xagent/tests/mcp.test.ts`
- Modify: `projects/xagent/docs/supervision.md`
- Modify: `plugins/xagent/scripts/install_global_test.py`
- Regenerate: `plugins/xagent/assets/xagent/`

**Interfaces:**
- Consumes: complete SDD coordinator and fake adapter.
- Produces: packaged ten-tool compatibility and operator contract.

- [ ] **Step 1: Write failing full-flow service test**

Drive MCP with the fake adapter:

```text
xagent_sdd_start(implementer)
→ xagent_sdd_await
→ xagent_sdd_followup(fix)
→ xagent_sdd_await
→ xagent_sdd_start(task-reviewer)
→ xagent_sdd_await
→ xagent_sdd_followup(re-review)
→ xagent_sdd_await
→ xagent_sdd_close both sessions
```

Query `sdd_dispatch_log` and assert two sessions, four ordered turns, exact brief/findings copies, pre-turn resume sequences, immutable assistant reports, no JSONL position, and closed timestamps.

- [ ] **Step 2: Run end-to-end test and confirm RED**

Run:

```bash
cd projects/xagent
npm run build
node --test dist/tests/e2e.test.js
```

Expected: failure until service fixture wiring and all-role fake turns support the full flow.

- [ ] **Step 3: Complete fake-adapter and MCP integration**

Add only the fixture seams needed to provide one final report per submitted turn. Do not weaken production supervision.

- [ ] **Step 4: Update packaged MCP probes**

Change `EXPECTED_MCP_TOOL_NAMES` from six to ten and add a packaged fake-adapter SDD start/await smoke that verifies the report is present in SQLite before the MCP result is accepted.

- [ ] **Step 5: Write operations documentation**

Document:

- exact tool input/output contracts
- trusted Python renderer and installed Superpowers template prerequisites
- database path, version-1 schema, permissions, and status transitions
- report-before-return and retry behavior
- startup abandonment reconciliation
- generic-message rejection and generic await/close safety hooks
- `resume_sequence` versus nonexistent JSONL positions
- report text versus mutable report artifact contents

- [ ] **Step 6: Regenerate tracked plugin runtime assets**

Run:

```bash
make xagent-plugin-build
```

Expected: tracked `plugins/xagent/assets/xagent/` matches the current compiled client runtime and packaged dependencies.

- [ ] **Step 7: Run focused package tests**

Run:

```bash
cd projects/xagent
npm test
cd ../..
python3 -m unittest plugins.xagent.scripts.install_global_test
```

Expected: xagent tests and plugin package/install tests pass.

- [ ] **Step 8: Commit**

```bash
git add projects/xagent/tests/e2e.test.ts projects/xagent/tests/mcp.test.ts projects/xagent/docs/supervision.md plugins/xagent/scripts/install_global_test.py plugins/xagent/assets/xagent
git commit -m "test(xagent): cover packaged SDD lifecycle"
```

---

### Task 6: Mandatory SDD Workflow Guidance and Final Verification

**OpenSpec coverage:** 5.1–5.4; 6.1–6.3; asd-23, asd-25 through asd-28.

**Files:**
- Modify: `plugins/xagent/skills/xagent-subagents/SKILL.md`
- Modify: `projects/agents/global/skills/openspec-superpowers-workflow/SKILL.md`
- Modify: `projects/agents/scripts/install_test.py`
- Modify: `openspec/changes/add-xagent-sdd-mode/tasks.md`

**Interfaces:**
- Consumes: the four implemented SDD MCP tools.
- Produces: canonical guidance that cannot select native/raw/terminal fallback for SDD turns.

- [ ] **Step 1: Write failing guidance assertions**

Update installer/package tests to require:

```text
xagent_sdd_start
xagent_sdd_followup
xagent_sdd_await
xagent_sdd_close
agent_id
resume_sequence
report-before-return
```

Assert native subagents, `xagent_start`, raw `xagent_message`, and quiet CLI fallback are described only in explicitly non-SDD/pre-plan sections.

- [ ] **Step 2: Run guidance tests and confirm RED**

Run:

```bash
python3 -m unittest projects.agents.scripts.install_test
python3 -m unittest plugins.xagent.scripts.install_global_test
```

Expected: failures because current skills still prescribe mixed transport.

- [ ] **Step 3: Update the plugin-owned xagent skill**

Keep generic supervision guidance for non-SDD delegation. Add a distinct Superpowers SDD section that requires the four facade tools, retains `agent_id`/`resume_sequence`, uses one long await, reuses sessions for fix/re-review, and treats missing SDD MCP as broken infrastructure without CLI/native fallback.

- [ ] **Step 4: Update the canonical OpenSpec–Superpowers workflow skill**

Keep pre-plan review, decomposition, and plan generation explicitly outside the SDD task facade. Require xagent SDD MCP and `dispatch-prompt`-backed facade calls for implementer, task reviewer, fix, re-review, and final reviewer turns. Preserve OpenSpec checkbox synchronization.

- [ ] **Step 5: Run all focused and full verification**

Run:

```bash
cd projects/xagent
npm test
cd ../..
python3 -m unittest discover -s plugins/xagent/scripts -p '*_test.py'
python3 -m unittest discover -s projects/agents/utils -p '*_test.py'
python3 -m unittest discover -s projects/agents/scripts -p '*_test.py'
openspec validate add-xagent-sdd-mode --type change --strict --json
```

Expected: zero failures; OpenSpec reports the change valid.

- [ ] **Step 6: Update OpenSpec task checkboxes**

Mark each `openspec/changes/add-xagent-sdd-mode/tasks.md` item complete only when its implementation, tests, and review gate have passed. Run:

```bash
openspec instructions apply --change add-xagent-sdd-mode --json
```

Expected: `complete` equals `total` and `remaining` equals `0`.

- [ ] **Step 7: Commit**

```bash
git add plugins/xagent/skills/xagent-subagents/SKILL.md projects/agents/global/skills/openspec-superpowers-workflow/SKILL.md projects/agents/scripts/install_test.py openspec/changes/add-xagent-sdd-mode docs/superpowers/plans/2026-07-26-xagent-sdd-mode.md
git commit -m "docs(agents): require xagent SDD workflow"
```

---

## Final Whole-Branch Gate

- [ ] Generate a review package from the branch merge base through `HEAD`.
- [ ] Render `dispatch-prompt code-reviewer` with this plan as requirements.
- [ ] Dispatch Claude Code `opus` through interrupt-driven xagent.
- [ ] If findings exist, send one complete fix wave to a Grok 4.5 implementer, render one scoped re-review prompt, and reuse the Opus reviewer session.
- [ ] Run the complete verification commands from Task 6 after any fix wave.
- [ ] Confirm no unrelated synth files entered a commit.
