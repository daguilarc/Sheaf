# xagent Controller Usability Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make an xagent SDD controller survivable for a model with zero xagent context — failures explain themselves, lost state is recoverable, and sessions/prompts stop lying.

**Architecture:** All Tier 1 changes are inside `projects/xagent` plus the packaged launcher in `plugins/xagent`. Each fix is independently testable against the existing `node:test` suite. No schema migration is required; the one ledger repair is idempotent and runs at store open.

**Tech Stack:** TypeScript (ES modules, `tsc` → `dist/`), `node:test` + `node:assert/strict`, `better-sqlite3`, `@modelcontextprotocol/sdk`, `zod`.

**Source spec:** `docs/superpowers/specs/2026-07-27-xagent-controller-usability-design.md`

## Global Constraints

- Node `>=20`; the repo currently runs Node v25.6.1.
- Build and test with `cd projects/xagent && npm test` (which runs `npm run build` first, then `node --test dist/tests/*.test.js`).
- Tests live in `projects/xagent/tests/*.test.ts` and import from `../src/**/*.js` (compiled-path imports, `.js` extension, even for TypeScript sources).
- Every payload that reaches a controller goes through `sanitizeValue(value, cwd)` — never add a sink that bypasses it.
- No behavior change to the legacy `xagent run` CLI path (`src/runtime.ts`) unless a task says so.
- Do not push. Commit per task.
- Tier 1 only in this plan. Tier 2 (A1/A2 harness distribution) and the Discuss items are out of scope and must not be started here.

---

### Task 1: Surface the provider's stderr on process exit (B1)

**Files:**
- Modify: `projects/xagent/src/supervision/health.ts:7`
- Modify: `projects/xagent/src/supervision/supervisor.ts:885-891`
- Test: `projects/xagent/tests/supervision_health.test.ts`

**Interfaces:**
- Consumes: `MechanicalHealthEvent`, `DeterministicHealthClassification` from `src/supervision/health.js`.
- Produces: `process.exited` gains `message?: string`; the resulting failure classification payload becomes `{ exit_code, signal, message? }`. Task 2 and later tasks do not depend on this.

- [ ] **Step 1: Write the failing test**

Append to `projects/xagent/tests/supervision_health.test.ts`:

```typescript
test("process exit classification carries the provider stderr message", () => {
  const clock = new FakeClock();
  const monitor = new DeterministicHealthMonitor({
    silenceTimeoutMs: 300_000,
    clock: clock.now,
    scheduler: clock,
    onClassification: () => {},
  });

  monitor.recordMechanicalEvent({ type: "process.spawned" });
  assert.deepEqual(monitor.recordMechanicalEvent({
    type: "process.exited",
    exitCode: 1,
    signal: null,
    message: "Claude usage limit reached. Your limit will reset at 12pm.",
  }), {
    kind: "failure",
    reason: "process_exit",
    payload: {
      exit_code: 1,
      signal: null,
      message: "Claude usage limit reached. Your limit will reset at 12pm.",
    },
  });
});

test("process exit classification omits message when the provider printed nothing", () => {
  const clock = new FakeClock();
  const monitor = new DeterministicHealthMonitor({
    silenceTimeoutMs: 300_000,
    clock: clock.now,
    scheduler: clock,
    onClassification: () => {},
  });

  monitor.recordMechanicalEvent({ type: "process.spawned" });
  assert.deepEqual(monitor.recordMechanicalEvent({
    type: "process.exited",
    exitCode: 2,
    signal: null,
  }), {
    kind: "failure",
    reason: "process_exit",
    payload: { exit_code: 2, signal: null },
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd projects/xagent && npm test 2>&1 | grep -A 20 "stderr message"`
Expected: FAIL — the `message` key is absent from the payload (and TypeScript rejects the extra property on the event literal).

- [ ] **Step 3: Add `message` to the mechanical event and the payload**

In `src/supervision/health.ts`, change the `process.exited` variant:

```typescript
  | {
      readonly type: "process.exited";
      readonly exitCode: number | null;
      readonly signal: string | null;
      readonly message?: string;
    }
```

and the classification in `recordMechanicalEvent`:

```typescript
      case "process.exited":
        this.#deactivate();
        return {
          kind: "failure",
          reason: "process_exit",
          payload: {
            exit_code: event.exitCode,
            signal: event.signal,
            ...(event.message === undefined || event.message.trim() === ""
              ? {}
              : { message: event.message }),
          },
        };
```

- [ ] **Step 4: Forward the adapter's message from the supervisor**

In `src/supervision/supervisor.ts`, in the `event.code === "process_exit"` branch (~line 885):

```typescript
  if (event.code === "process_exit") {
    const exitStatus = processExitFromDetails(event.details);
    return monitor.recordMechanicalEvent({
      type: "process.exited",
      exitCode: exitStatus.exitCode,
      signal: exitStatus.signal,
      ...(event.message === undefined ? {} : { message: event.message }),
    });
  }
```

- [ ] **Step 5: Run the full suite**

Run: `cd projects/xagent && npm test`
Expected: PASS, no regressions.

- [ ] **Step 6: Commit**

```bash
git add projects/xagent/src/supervision/health.ts projects/xagent/src/supervision/supervisor.ts projects/xagent/tests/supervision_health.test.ts
git commit -m "fix(xagent): surface provider stderr on supervised process exit"
```

---

### Task 2: Persist a terminal exit_status for supervised runs (B3)

**Files:**
- Modify: `projects/xagent/src/logs.ts:220-233` (`updateRunSupervision`)
- Test: `projects/xagent/tests/logs.test.ts`

**Interfaces:**
- Consumes: `updateRunSupervision(record, update, clock)`, `terminalSupervisionPhases` (already defined at `logs.ts:209`).
- Produces: no signature change. `record.exit_status` becomes `"completed"` when the phase is `completed`, `"failed"` for `failed`/`cancelled`/`abandoned`, and is left `"running"` otherwise.

- [ ] **Step 1: Write the failing test**

Append to `projects/xagent/tests/logs.test.ts` (follow the file's existing temp-dir helper; if it has none, use the pattern below):

```typescript
test("supervised terminal phases persist a matching exit status", async () => {
  const logRoot = await mkdtemp(path.join(tmpdir(), "xagent-exit-status-"));
  try {
    const record = await createRunRecord({
      repoRoot: logRoot,
      logRoot,
      harness: "claude_code",
      mode: "subagent",
      supervised: true,
    });
    assert.equal(record.exit_status, "running");

    await updateRunSupervision(record, {
      ...record.supervision,
      phase: "running",
      sequence: 3,
    });
    assert.equal(record.exit_status, "running");

    await updateRunSupervision(record, {
      ...record.supervision,
      phase: "failed",
      sequence: 4,
    });
    assert.equal(record.exit_status, "failed");

    const persisted = await openRunRecord(logRoot, record.run_id);
    assert.equal(persisted.exit_status, "failed");
    assert.equal(persisted.supervision.phase, "failed");
  } finally {
    await rm(logRoot, { recursive: true, force: true });
  }
});

test("a completed supervised phase persists exit status completed", async () => {
  const logRoot = await mkdtemp(path.join(tmpdir(), "xagent-exit-status-ok-"));
  try {
    const record = await createRunRecord({
      repoRoot: logRoot,
      logRoot,
      harness: "cursor",
      mode: "subagent",
      supervised: true,
    });
    await updateRunSupervision(record, {
      ...record.supervision,
      phase: "completed",
      sequence: 7,
    });
    assert.equal((await openRunRecord(logRoot, record.run_id)).exit_status, "completed");
  } finally {
    await rm(logRoot, { recursive: true, force: true });
  }
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd projects/xagent && npm test 2>&1 | grep -A 15 "exit status"`
Expected: FAIL — `exit_status` stays `"running"` after a terminal phase.

- [ ] **Step 3: Derive exit_status inside updateRunSupervision**

In `src/logs.ts`, inside `updateRunSupervision`, after `record.owned_process = owned_process;`:

```typescript
  // The supervised service never called `updateRunExitStatus` (that is the
  // legacy `xagent run` path only), so every service-owned run persisted
  // `exit_status: "running"` forever while `supervision.phase` said
  // otherwise. Derive the legacy field from the authoritative phase so both
  // agree for supervised and interactive runs alike.
  //
  if (terminalSupervisionPhases.has(supervision.phase)) {
    record.exit_status = supervision.phase === "completed" ? "completed" : "failed";
  }
```

- [ ] **Step 4: Run the full suite**

Run: `cd projects/xagent && npm test`
Expected: PASS. Pay attention to `reconciliation.test.ts` — reconciliation reads phases, not `exit_status`, so it must stay green.

- [ ] **Step 5: Commit**

```bash
git add projects/xagent/src/logs.ts projects/xagent/tests/logs.test.ts
git commit -m "fix(xagent): derive exit_status from terminal supervision phase"
```

---

### Task 3: Write the provider transcript on the supervised path (B2)

**Files:**
- Modify: `projects/xagent/src/supervision/supervisor.ts` (options type + adapter-event loop at ~line 281)
- Modify: `projects/xagent/src/service/run_manager.ts:181-197`
- Test: `projects/xagent/tests/supervision.test.ts`

**Interfaces:**
- Consumes: `AdapterEvent.rawProvider` (`src/adapters/types.ts:51`), `appendRawProviderEvent(record, event)` (`src/logs.ts:163`), `sanitizeValue(value, cwd)` (`src/sanitize.js`).
- Produces: `SupervisorOptions.providerTranscriptSink?: (raw: unknown) => Promise<void>`.

- [ ] **Step 1: Write the failing test**

Append to `projects/xagent/tests/supervision.test.ts`, using the file's existing `FakeHarnessAdapter` setup:

```typescript
test("the supervisor forwards raw provider events to the transcript sink", async () => {
  const transcript: unknown[] = [];
  const adapter = new FakeHarnessAdapter();
  const supervisor = new Supervisor({
    runId: "xrun_20260727000000000_0000abcd",
    adapter,
    startOptions: { cwd: "/tmp" },
    policy: { silenceTimeoutMs: 300_000, watchdog: {} },
    providerTranscriptSink: async (raw) => {
      transcript.push(raw);
    },
  });

  await supervisor.start();
  await supervisor.submit("hello");
  await adapter.emit({
    type: "message.completed",
    message_id: "m1",
    role: "assistant",
    text: "hi",
    rawProvider: { type: "assistant", message: { content: [{ type: "text", text: "hi" }] } },
  });
  await adapter.completeTurn("hi");

  assert.equal(transcript.length, 1);
  assert.deepEqual(transcript[0], {
    type: "assistant",
    message: { content: [{ type: "text", text: "hi" }] },
  });
});
```

Adapt the emit/complete helpers to whatever `FakeHarnessAdapter` actually exposes in `src/adapters/fake.ts` — read it first and mirror the existing tests in that file rather than inventing helpers.

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd projects/xagent && npm test 2>&1 | grep -A 15 "transcript sink"`
Expected: FAIL — `providerTranscriptSink` is not a `SupervisorOptions` member.

- [ ] **Step 3: Add the sink to the supervisor**

In `src/supervision/supervisor.ts`, add to `SupervisorOptions`:

```typescript
  // The supervised path never persisted the provider transcript, so every
  // service-owned run left an empty raw-provider.jsonl and a failed run had
  // no post-mortem artifact at all. Disk-only: this does not change what
  // enters the leader context.
  //
  readonly providerTranscriptSink?: (raw: unknown) => Promise<void>;
```

Store it on the instance (mirroring how `#watchdogTelemetrySink` is stored, defaulting to a no-op `async () => {}`), and inside the `for await (const event of providerEvents)` loop, immediately after `this.#recordProgress(event);`:

```typescript
          if (event.rawProvider !== undefined) {
            await this.#providerTranscriptSink(
              sanitizeValue(event.rawProvider, this.#startOptions.cwd),
            );
          }
```

- [ ] **Step 4: Wire it in the run manager**

In `src/service/run_manager.ts`, add `appendRawProviderEvent` to the existing `../logs.js` import and add this option to the `new Supervisor({...})` literal, next to `watchdogTelemetrySink`:

```typescript
      providerTranscriptSink: async (raw) => {
        await appendRawProviderEvent(record, raw);
      },
```

The supervisor already sanitized the value, so do not sanitize twice.

- [ ] **Step 5: Run the full suite**

Run: `cd projects/xagent && npm test`
Expected: PASS.

- [ ] **Step 6: Verify against a live run**

Run:
```bash
cd /Users/joyo/Sheaf/projects/xagent && npm run build && node -e "console.log('build ok')"
```
Then confirm the wiring by inspecting the compiled output:
```bash
grep -c providerTranscriptSink projects/xagent/dist/src/service/run_manager.js projects/xagent/dist/src/supervision/supervisor.js
```
Expected: a non-zero count in both files.

- [ ] **Step 7: Commit**

```bash
git add projects/xagent/src/supervision/supervisor.ts projects/xagent/src/service/run_manager.ts projects/xagent/tests/supervision.test.ts
git commit -m "fix(xagent): persist the provider transcript for supervised runs"
```

---

### Task 4: Resolve open turns when an SDD session closes (C4)

**Files:**
- Modify: `projects/xagent/src/service/sdd_store.ts:582-588` (`MarkClosed`) and the store-open path around `sdd_store.ts:192`
- Test: `projects/xagent/tests/sdd_store.test.ts`

**Interfaces:**
- Consumes: prepared statements `markClosed` (`sdd_store.ts:428`) and `abandonOpenTurns` (`sdd_store.ts:435`), `database.transaction`.
- Produces: no signature change to `SddStore.MarkClosed(agentId, closedAt)`.

- [ ] **Step 1: Write the failing test**

Append to `projects/xagent/tests/sdd_store.test.ts`:

```typescript
test("closing a session abandons its unresolved turns", async () => {
  const dir = await mkdtemp(path.join(tmpdir(), "xagent-sdd-close-"));
  try {
    const store = CreateSddStore({ dataRoot: dir });
    store.ReserveInitial(sampleInitialInput);
    store.MarkRunning(sampleAgentId, 1, 2);

    store.MarkClosed(sampleAgentId, "2026-07-27T20:00:00.000Z");

    assert.equal(store.GetOpenTurn(sampleAgentId), undefined);
    const database = new Database(GetSddDatabasePath(dir), { readonly: true });
    const row = database
      .prepare("SELECT status, completed_at FROM sdd_turns WHERE agent_id = ? AND turn_number = 1")
      .get(sampleAgentId) as { status: string; completed_at: string | null };
    database.close();
    assert.equal(row.status, "abandoned");
    assert.notEqual(row.completed_at, null);
    store.Close();
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("opening the store repairs turns left running under a closed session", async () => {
  const dir = await mkdtemp(path.join(tmpdir(), "xagent-sdd-repair-"));
  try {
    const first = CreateSddStore({ dataRoot: dir });
    first.ReserveInitial(sampleInitialInput);
    first.MarkRunning(sampleAgentId, 1, 2);
    first.Close();

    // Simulate the pre-fix state: session closed, turn still running.
    const database = new Database(GetSddDatabasePath(dir));
    database
      .prepare("UPDATE sdd_sessions SET closed_at = ? WHERE agent_id = ?")
      .run("2026-07-27T20:00:00.000Z", sampleAgentId);
    database.close();

    const second = CreateSddStore({ dataRoot: dir });
    assert.equal(second.GetOpenTurn(sampleAgentId), undefined);
    second.Close();
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
```

Match `CreateSddStore`'s real options object — read its signature at `sdd_store.ts:192` and use the same argument shape the existing tests in this file use.

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd projects/xagent && npm test 2>&1 | grep -A 15 "abandons its unresolved turns"`
Expected: FAIL — `GetOpenTurn` still returns the running turn.

- [ ] **Step 3: Make MarkClosed transactional**

In `src/service/sdd_store.ts`, replace the body of `MarkClosed`:

```typescript
    MarkClosed(agentId: string, closedAt: string): void {
      AssertOpen();
      // Closing the session must also resolve any turn still marked
      // prepared/running. Before this, `abandonOpenTurns` ran only from
      // startup reconciliation for failed/cancelled/abandoned phases, so a
      // normal close left the turn row `running` with a null completed_at
      // forever, and any ledger reader saw phantom in-flight work.
      //
      const close = database.transaction(() => {
        const result = markClosed.run(closedAt, agentId);
        if (result.changes === 0) {
          throw new SddStoreError(
            `Cannot close SDD session ${agentId}: session missing or already closed.`,
          );
        }
        abandonOpenTurns.run(closedAt, agentId);
      });
      close();
    },
```

- [ ] **Step 4: Add the one-shot repair at store open**

Still in `src/service/sdd_store.ts`, after the prepared statements are created and before the store object is returned, add and invoke:

```typescript
  const repairClosedSessionTurns = database.prepare(`
    UPDATE sdd_turns
    SET status = 'abandoned',
        completed_at = COALESCE(
          (SELECT closed_at FROM sdd_sessions WHERE sdd_sessions.agent_id = sdd_turns.agent_id),
          completed_at
        )
    WHERE status IN ('prepared', 'running')
      AND agent_id IN (SELECT agent_id FROM sdd_sessions WHERE closed_at IS NOT NULL)
  `);
  repairClosedSessionTurns.run();
```

- [ ] **Step 5: Run the full suite**

Run: `cd projects/xagent && npm test`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add projects/xagent/src/service/sdd_store.ts projects/xagent/tests/sdd_store.test.ts
git commit -m "fix(xagent): resolve open SDD turns when a session closes"
```

---

### Task 5: Recover follow-up artifacts from the ledger (C6)

**Files:**
- Modify: `projects/xagent/src/service/sdd_store.ts` (add `GetLatestTurn`)
- Modify: `projects/xagent/src/service/sdd_manager.ts:252, 483-491`
- Test: `projects/xagent/tests/sdd_store.test.ts`, `projects/xagent/tests/sdd_manager.test.ts`

**Interfaces:**
- Consumes: `SddTurnRecord` (`sdd_store.ts:20`), which already carries `brief_path`, `brief_text`, `report_path`.
- Produces: `SddStore.GetLatestTurn(agentId: string): SddTurnRecord | undefined` — the highest `turn_number` row for the agent, regardless of status.

- [ ] **Step 1: Write the failing store test**

Append to `projects/xagent/tests/sdd_store.test.ts`:

```typescript
test("GetLatestTurn returns the highest numbered turn regardless of status", async () => {
  const dir = await mkdtemp(path.join(tmpdir(), "xagent-sdd-latest-"));
  try {
    const store = CreateSddStore({ dataRoot: dir });
    store.ReserveInitial(sampleInitialInput);
    store.MarkRunning(sampleAgentId, 1, 2);
    store.MarkCompleted(sampleAgentId, 1, "first report", 4);

    const latest = store.GetLatestTurn(sampleAgentId);
    assert.equal(latest?.turn_number, 1);
    assert.equal(latest?.brief_path, sampleInitialInput.briefPath);
    assert.equal(latest?.report_path, sampleInitialInput.reportPath);
    assert.equal(store.GetLatestTurn("xrun_20260101000000000_deadbeef"), undefined);
    store.Close();
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
```

- [ ] **Step 2: Write the failing manager test**

Append to `projects/xagent/tests/sdd_manager.test.ts`, following that file's existing fake-store/fake-run-manager construction:

```typescript
test("a fix follow-up recovers brief and report paths after an in-memory cache loss", async () => {
  const { manager, store, runManager } = createManagerFixture();
  const start = await manager.Start(sampleImplementerStart);
  await manager.Await({ agent_id: start.agent_id, after_sequence: 2, deadline_seconds: 60 });

  // Simulate a service restart: the manager's in-process artifact cache is gone
  // but the ledger still holds every path.
  const restarted = createManagerFixture({ store, runManager }).manager;

  const followup = await restarted.Followup({
    kind: "fix",
    agent_id: start.agent_id,
    round: 1,
    findings: sampleFindingsPath,
    findings_text: "Important #1: fix the marker.",
    tests: ["npm test"],
  });

  assert.equal(followup.turn_number, 2);
});
```

Read `tests/sdd_manager.test.ts` first and reuse its actual fixture helpers and sample inputs rather than the illustrative names above.

- [ ] **Step 3: Run both tests to verify they fail**

Run: `cd projects/xagent && npm test 2>&1 | grep -A 15 "GetLatestTurn\|in-memory cache loss"`
Expected: FAIL — `GetLatestTurn` is not a function; the follow-up rejects with `sdd_followup_missing_paths`.

- [ ] **Step 4: Add GetLatestTurn to the store**

In `src/service/sdd_store.ts`, add to the `SddStore` type next to `GetOpenTurn`:

```typescript
  GetLatestTurn(agentId: string): SddTurnRecord | undefined;
```

Add the prepared statement beside `selectOpenTurn`:

```typescript
  const selectLatestTurn = database.prepare(`
    SELECT * FROM sdd_turns
    WHERE agent_id = ?
    ORDER BY turn_number DESC
    LIMIT 1
  `);
```

and the method beside `GetOpenTurn`:

```typescript
    GetLatestTurn(agentId: string): SddTurnRecord | undefined {
      AssertOpen();
      const row = selectLatestTurn.get(agentId) as Record<string, unknown> | undefined;
      return row === undefined ? undefined : MapTurnRow(row);
    },
```

Use whatever the file's existing turn-row mapper is actually named (`GetOpenTurn` shows it) rather than assuming `MapTurnRow`.

- [ ] **Step 5: Fall back to the ledger in Followup**

In `src/service/sdd_manager.ts`, replace the artifact lookup at ~line 483:

```typescript
    // The in-process cache is an optimisation, not the source of truth: the
    // ledger already persists brief_path/brief_text/report_path for every
    // turn. Recovering from it means a service restart no longer turns every
    // live SDD session into `sdd_followup_missing_paths`.
    //
    let artifacts = artifactsByAgent.get(input.agent_id);
    if (artifacts === undefined) {
      const latest = store.GetLatestTurn(input.agent_id);
      if (latest !== undefined) {
        artifacts = {
          briefPath: latest.brief_path,
          briefText: latest.brief_text,
          ...(latest.report_path === null ? {} : { reportPath: latest.report_path }),
        };
        artifactsByAgent.set(input.agent_id, artifacts);
      }
    }
    if (artifacts === undefined) {
      throw StructuredFailure({
        error: "sdd_followup_missing_paths",
        message: `Unable to recover stored brief/report paths for ${input.agent_id}.`,
        details: { agent_id: input.agent_id },
      });
    }
```

- [ ] **Step 6: Run the full suite**

Run: `cd projects/xagent && npm test`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add projects/xagent/src/service/sdd_store.ts projects/xagent/src/service/sdd_manager.ts projects/xagent/tests/sdd_store.test.ts projects/xagent/tests/sdd_manager.test.ts
git commit -m "fix(xagent): recover SDD follow-up artifacts from the ledger"
```

---

### Task 6: Add an `xagent_list` MCP tool for run recovery (C5)

**Files:**
- Modify: `projects/xagent/src/service/tool_schemas.ts`
- Modify: `projects/xagent/src/service/run_manager.ts`
- Modify: `projects/xagent/src/service/mcp.ts:148-247`
- Test: `projects/xagent/tests/mcp.test.ts`

**Interfaces:**
- Consumes: `listRuns(logRoot): Promise<RunMetadata[]>` (`src/logs.ts:236`), `this.#runs` (the live-run map in `XagentRunManager`).
- Produces:
  - `XagentListInputSchema` — `{ live_only?: boolean (default false), limit?: number (int, 1..200, default 50) }`, `.strict()`.
  - `XagentRunManager.listRuns(input: XagentListInput): Promise<{ runs: XagentListRow[] }>` where
    `XagentListRow = { run_id: string; harness: string; model?: string; phase: string; sequence: number; exit_status: string; live: boolean; supervised: boolean; created_at: string; updated_at: string }`,
    newest `created_at` first.

- [ ] **Step 1: Write the failing test**

Append to `projects/xagent/tests/mcp.test.ts`, mirroring how that file already drives tools through the handler:

```typescript
test("xagent_list returns owned runs newest first and flags live ones", async () => {
  const harness = await createMcpTestHarness();
  try {
    const started = await harness.callTool("xagent_start", {
      cwd: harness.cwd,
      prompt: "hello",
      harness: "fake",
    });
    const listed = await harness.callTool("xagent_list", {});

    const rows = listed.structuredContent.runs as Array<Record<string, unknown>>;
    assert.ok(rows.length >= 1);
    const row = rows.find((entry) => entry.run_id === started.structuredContent.run_id);
    assert.ok(row, "the started run must be listed");
    assert.equal(row.live, true);
    assert.equal(row.supervised, true);
    assert.equal(typeof row.phase, "string");
  } finally {
    await harness.close();
  }
});

test("xagent_list rejects unknown arguments", async () => {
  const harness = await createMcpTestHarness();
  try {
    const result = await harness.callTool("xagent_list", { bogus: true });
    assert.equal(result.isError, true);
    assert.equal(result.structuredContent.error, "invalid_tool_input");
  } finally {
    await harness.close();
  }
});
```

Use the harness helpers that `tests/mcp.test.ts` already defines; do not invent `createMcpTestHarness` if the file names it something else.

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd projects/xagent && npm test 2>&1 | grep -A 15 "xagent_list"`
Expected: FAIL — unknown tool `xagent_list`.

- [ ] **Step 3: Add the input schema**

In `src/service/tool_schemas.ts`, next to `XagentInspectInputSchema`:

```typescript
export const XagentListInputSchema = z
  .object({
    live_only: z.boolean().default(false),
    limit: z.number().int().positive().max(200).default(50),
  })
  .strict();

export type XagentListInput = z.infer<typeof XagentListInputSchema>;
```

- [ ] **Step 4: Implement listRuns on the run manager**

In `src/service/run_manager.ts`, add `listRuns` to the `../logs.js` import, add the row type near `InspectRunResult`:

```typescript
export type XagentListRow = {
  readonly run_id: string;
  readonly harness: string;
  readonly model?: string;
  readonly phase: string;
  readonly sequence: number;
  readonly exit_status: string;
  readonly live: boolean;
  readonly supervised: boolean;
  readonly created_at: string;
  readonly updated_at: string;
};
```

and the method on `XagentRunManager`:

```typescript
  // Recovery, not polling: when a start response is lost, this is the only
  // supported way to find the orphaned run id over MCP.
  //
  async listRuns(input: XagentListInput): Promise<{ readonly runs: XagentListRow[] }> {
    const persisted = await listRuns(this.#logRoot);
    const rows = persisted
      .filter((metadata) => metadata.supervised === true)
      .map((metadata) => ({
        run_id: metadata.run_id,
        harness: metadata.harness,
        ...(metadata.model === undefined ? {} : { model: metadata.model }),
        phase: metadata.supervision.phase,
        sequence: metadata.supervision.sequence,
        exit_status: metadata.exit_status,
        live: this.#runs.has(metadata.run_id),
        supervised: true,
        created_at: metadata.created_at,
        updated_at: metadata.updated_at,
      }))
      .filter((row) => !input.live_only || row.live)
      .sort((left, right) => right.created_at.localeCompare(left.created_at))
      .slice(0, input.limit);
    return { runs: rows };
  }
```

- [ ] **Step 5: Register the tool**

In `src/service/mcp.ts`, add the imports (`XagentListInputSchema`) and register after `xagent_inspect`:

```typescript
  server.registerTool(
    "xagent_list",
    {
      title: "List supervised runs",
      description:
        "List service-owned runs newest first for recovery — use when a start response was lost and its run id is unknown. Not a progress-polling tool.",
      inputSchema: XagentListInputSchema,
    },
    async (args) => {
      return runTool(async () => {
        const input = parseToolInput(XagentListInputSchema, args);
        return runManager.listRuns(input);
      });
    },
  );
```

- [ ] **Step 6: Run the full suite**

Run: `cd projects/xagent && npm test`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add projects/xagent/src/service/tool_schemas.ts projects/xagent/src/service/run_manager.ts projects/xagent/src/service/mcp.ts projects/xagent/tests/mcp.test.ts
git commit -m "feat(xagent): add xagent_list MCP tool for lost run recovery"
```

---

### Task 7: Reject controller run ids leaking into worker prompts (D2)

**Files:**
- Modify: `projects/xagent/src/service/tool_schemas.ts:88-98, 131-140`
- Test: `projects/xagent/tests/mcp.test.ts`

**Interfaces:**
- Consumes: `x_GeneratedAgentIdPattern` (`tool_schemas.ts:27`).
- Produces: `ImplementerStartSchema.context` and `FixFollowupSchema.findings_text` reject any embedded `xrun_<17 digits>_<8 hex>`.

- [ ] **Step 1: Write the failing test**

Append to `projects/xagent/tests/mcp.test.ts`:

```typescript
test("sdd start rejects a context that leaks a controller run id", async () => {
  const harness = await createMcpTestHarness();
  try {
    const result = await harness.callTool("xagent_sdd_start", {
      role: "implementer",
      cwd: harness.cwd,
      plan: `${harness.cwd}/plan.md`,
      agent: "grok-4.5",
      harness: "cursor",
      effort: "high",
      task: 4,
      name: "Superpowers managed plugins",
      brief: `${harness.cwd}/brief.md`,
      report: `${harness.cwd}/report.md`,
      context: "Keep the reviewer session xrun_20260727192847117_b30af348 open for re-review.",
    });
    assert.equal(result.isError, true);
    assert.equal(result.structuredContent.error, "invalid_tool_input");
    assert.match(String(result.structuredContent.message), /xrun_20260727192847117_b30af348/);
  } finally {
    await harness.close();
  }
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd projects/xagent && npm test 2>&1 | grep -A 15 "leaks a controller run id"`
Expected: FAIL — the start is accepted (or fails for an unrelated reason).

- [ ] **Step 3: Add the guard**

In `src/service/tool_schemas.ts`, below `x_GeneratedAgentIdPattern`:

```typescript
const x_EmbeddedRunIdPattern = /xrun_[0-9]{17}_[0-9a-f]{8}/;

// Controller bookkeeping is not worker-actionable. A dispatched worker has no
// xagent access, so "keep session xrun_… open" reads as an instruction it must
// obey and cannot. Fail the dispatch instead of shipping the confusion.
//
function WorkerFacingText(label: string) {
  return z.string().min(1).superRefine((value, ctx) => {
    const match = x_EmbeddedRunIdPattern.exec(value);
    if (match !== null) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message:
          `${label} must not contain a controller run id (found ${match[0]}); `
          + "workers cannot act on xagent session ids",
      });
    }
  });
}
```

Then change `ImplementerStartSchema`'s `context` to `WorkerFacingText("context").optional()` and `FixFollowupSchema`'s `findings_text` to `WorkerFacingText("findings_text")`.

- [ ] **Step 4: Run the full suite**

Run: `cd projects/xagent && npm test`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add projects/xagent/src/service/tool_schemas.ts projects/xagent/tests/mcp.test.ts
git commit -m "fix(xagent): reject controller run ids in worker-facing prompt text"
```

---

### Task 8: Resolve the dispatch-prompt renderer from the run cwd (D4)

**Files:**
- Modify: `projects/xagent/src/service/sdd_prompt.ts:119-123, 237-246, 316-327`
- Modify: `projects/xagent/src/service/sdd_manager.ts:342-414` (surface `renderer_path`)
- Test: `projects/xagent/tests/sdd_prompt.test.ts`

**Interfaces:**
- Consumes: `RenderSddPromptInput.cwd` and `.repoRoot`, `SddPromptRuntime.access`.
- Produces: `RenderedSddPrompt.metadata` gains `rendererPath: string`; `XagentSddStartResult` gains `renderer_path: string`.

- [ ] **Step 1: Write the failing test**

Append to `projects/xagent/tests/sdd_prompt.test.ts`:

```typescript
test("the renderer in the run cwd wins over the service checkout", async () => {
  const calls: string[] = [];
  const cwdRenderer = "/tmp/worktree/projects/agents/utils/dispatch-prompt";

  const rendered = await RenderSddPrompt({
    role: "implementer",
    repoRoot: "/service/checkout",
    cwd: "/tmp/worktree",
    plan: "/tmp/worktree/plan.md",
    task: 4,
    name: "Superpowers managed plugins",
    brief: "/tmp/worktree/brief.md",
  }, {
    access: async (filePath) => {
      if (filePath !== cwdRenderer) {
        throw new Error("ENOENT");
      }
    },
    execFile: async (_file, args) => {
      calls.push(args[0]!);
      return { stdout: "/tmp/worktree/dispatch.md\n", stderr: "" };
    },
    readFile: async () => "rendered prompt body",
  });

  assert.equal(calls[0], cwdRenderer);
  assert.equal(rendered.metadata.rendererPath, cwdRenderer);
});

test("the service checkout renderer is used when the run cwd has none", async () => {
  const serviceRenderer = "/service/checkout/projects/agents/utils/dispatch-prompt";
  const calls: string[] = [];

  const rendered = await RenderSddPrompt({
    role: "implementer",
    repoRoot: "/service/checkout",
    cwd: "/tmp/worktree",
    plan: "/tmp/worktree/plan.md",
    task: 4,
    name: "Superpowers managed plugins",
    brief: "/tmp/worktree/brief.md",
  }, {
    access: async (filePath) => {
      if (filePath !== serviceRenderer) {
        throw new Error("ENOENT");
      }
    },
    execFile: async (_file, args) => {
      calls.push(args[0]!);
      return { stdout: "/tmp/worktree/dispatch.md\n", stderr: "" };
    },
    readFile: async () => "rendered prompt body",
  });

  assert.equal(calls[0], serviceRenderer);
  assert.equal(rendered.metadata.rendererPath, serviceRenderer);
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cd projects/xagent && npm test 2>&1 | grep -A 15 "run cwd wins"`
Expected: FAIL — the service checkout renderer is always chosen and `rendererPath` is undefined.

- [ ] **Step 3: Prefer the cwd renderer**

In `src/service/sdd_prompt.ts`, replace the single-candidate resolution:

```typescript
// A supervised run's cwd is frequently a worktree, not the service checkout.
// Resolving the renderer only from the service repo root silently rendered
// every prompt with main's renderer and main's templates while the worker ran
// against branch code. Prefer the run's own checkout, fall back to the
// service's, and report which one was used so the choice is never invisible.
//
async function ResolveRendererPath(
  input: RenderSddPromptInput,
  checkAccess: (filePath: string) => Promise<void>,
): Promise<string> {
  const candidates = [
    path.join(input.cwd, x_TrustedRendererRelativePath),
    path.join(input.repoRoot, x_TrustedRendererRelativePath),
  ];
  for (const candidate of candidates) {
    try {
      await checkAccess(candidate);
      return candidate;
    }
    catch {
      continue;
    }
  }
  throw new SddPromptError({
    error: "sdd_renderer_missing",
    message: "Trusted dispatch-prompt renderer is unavailable.",
    details: { searched: candidates },
  });
}
```

Replace the existing `const rendererPath = TrustedRendererPath(input.repoRoot);` + `try { await checkAccess(rendererPath); } catch { … }` block with
`const rendererPath = await ResolveRendererPath(input, checkAccess);`, and add
`rendererPath` to the returned `metadata` object.

- [ ] **Step 4: Surface it on the start result**

In `src/service/sdd_manager.ts`, add `readonly renderer_path: string;` to `XagentSddStartResult` and include `renderer_path: rendered.metadata.rendererPath` in the object returned from `Start`.

- [ ] **Step 5: Run the full suite**

Run: `cd projects/xagent && npm test`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add projects/xagent/src/service/sdd_prompt.ts projects/xagent/src/service/sdd_manager.ts projects/xagent/tests/sdd_prompt.test.ts
git commit -m "fix(xagent): resolve the SDD renderer from the run cwd first"
```

---

### Task 9: Return the real final message for cursor runs (E1)

**Files:**
- Modify: `projects/xagent/src/adapters/process_jsonl.ts:16-25` (`ProcessHarnessState`)
- Modify: `projects/xagent/src/adapters/cursor.ts:75-88, 119-129`
- Test: `projects/xagent/tests/adapters.test.ts`

**Interfaces:**
- Consumes: `ProcessHarnessState`, `parseCursorProviderEvent(raw, context, state)`.
- Produces: `ProcessHarnessState.cursorFinalSegmentText?: string`; `message.completed.text` and `turn.completed.final_text` for the cursor harness become the last end-of-turn assistant segment.

- [ ] **Step 1: Write the failing test**

Append to `projects/xagent/tests/adapters.test.ts`:

```typescript
test("cursor turn completion reports the final assistant segment, not the whole stream", () => {
  const state = { providerSequence: 0 } as ProcessHarnessState;
  const context = { turnId: "turn_1", inputSequence: 1, text: "go" } as AdapterTurnContext;

  // Narration segment, flushed before a tool call.
  parseCursorProviderEvent(
    { type: "assistant", timestamp_ms: 1, message: { content: [{ type: "text", text: "I'll read the brief." }] } },
    context,
    state,
  );
  parseCursorProviderEvent(
    { type: "assistant", model_call_id: "c1", message: { content: [{ type: "text", text: "I'll read the brief." }] } },
    context,
    state,
  );

  // Final segment, flushed at turn end (no timestamp_ms, no model_call_id).
  parseCursorProviderEvent(
    { type: "assistant", timestamp_ms: 2, message: { content: [{ type: "text", text: "**Status:** DONE" }] } },
    context,
    state,
  );
  parseCursorProviderEvent(
    { type: "assistant", message: { content: [{ type: "text", text: "**Status:** DONE" }] } },
    context,
    state,
  );

  const events = parseCursorProviderEvent(
    { type: "result", result: "I'll read the brief.**Status:** DONE" },
    context,
    state,
  );

  const completed = events.find((event) => event.type === "message.completed");
  const turn = events.find((event) => event.type === "turn.completed");
  assert.equal((completed as { text: string }).text, "**Status:** DONE");
  assert.equal((turn as { final_text: string }).final_text, "**Status:** DONE");
});

test("cursor falls back to the result field when no final flush was seen", () => {
  const state = { providerSequence: 0 } as ProcessHarnessState;
  const context = { turnId: "turn_1", inputSequence: 1, text: "go" } as AdapterTurnContext;

  const events = parseCursorProviderEvent({ type: "result", result: "only text" }, context, state);
  const turn = events.find((event) => event.type === "turn.completed");
  assert.equal((turn as { final_text: string }).final_text, "only text");
});
```

Match the imports and helper shapes already used in `tests/adapters.test.ts`.

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cd projects/xagent && npm test 2>&1 | grep -A 15 "final assistant segment"`
Expected: FAIL — `final_text` is `"I'll read the brief.**Status:** DONE"`.

- [ ] **Step 3: Track the end-of-turn flush**

In `src/adapters/process_jsonl.ts`, add to `ProcessHarnessState`:

```typescript
  // cursor-agent's `result` event carries the whole turn's assistant stream
  // concatenated without separators, which violates the "final assistant
  // report" contract the controller relies on. Remember the segment observed
  // at the end-of-turn flush and prefer it.
  //
  cursorFinalSegmentText?: string;
```

In `src/adapters/cursor.ts`, inside `parseCursorAssistantEvent`, replace the flush branch:

```typescript
  if (isFinalFlush || isToolFlush || isSegmentReplay) {
    if (isFinalFlush) {
      state.cursorFinalSegmentText = text;
    }
    clearCursorSegment(state);
    return [];
  }
```

- [ ] **Step 4: Prefer it on the result event**

Still in `src/adapters/cursor.ts`, in the `type === "result"` branch:

```typescript
  if (type === "result") {
    const streamed = stringValue(raw.result ?? raw.text, extractCursorAssistantText(raw.message));
    const text = state.cursorFinalSegmentText !== undefined
      && state.cursorFinalSegmentText.trim() !== ""
      ? state.cursorFinalSegmentText
      : streamed;
    state.cursorFinalSegmentText = undefined;
    clearCursorSegment(state);
    return [{ /* unchanged message.completed */ }, { /* unchanged turn.completed */ }];
  }
```

Also reset `state.cursorFinalSegmentText = undefined;` in `buildCursorCommand`, alongside the existing `state.cursorSegmentText = ""` reset, so an interrupted turn cannot poison the next one.

- [ ] **Step 5: Run the full suite**

Run: `cd projects/xagent && npm test`
Expected: PASS. `tests/adapters.test.ts` has existing cursor streaming tests — they must stay green.

- [ ] **Step 6: Commit**

```bash
git add projects/xagent/src/adapters/cursor.ts projects/xagent/src/adapters/process_jsonl.ts projects/xagent/tests/adapters.test.ts
git commit -m "fix(xagent): report the cursor final assistant segment as the turn report"
```

---

### Task 10: Remove the hardcoded log root from the packaged launcher (F1)

**Files:**
- Modify: `plugins/xagent/scripts/xagent:7,26`
- Test: `plugins/xagent/scripts/install_global_test.py` (add a launcher-content assertion)

**Interfaces:**
- Consumes: the Sheaf root marker pair `config/services.json` + `structure/` (the same rule `findSheafRoot` uses at `projects/xagent/src/service/config.ts:36-49`).
- Produces: no interface change. `XAGENT_LOG_ROOT` precedence becomes: existing `XAGENT_LOG_ROOT` → `SHEAF_XAGENT_LOG_ROOT` → discovered `<sheaf-root>/data/xagent` → `$HOME/.xagent/data`.

- [ ] **Step 1: Write the failing test**

Append to `plugins/xagent/scripts/install_global_test.py`:

```python
    def test_launcher_has_no_hardcoded_user_path(self) -> None:
        launcher = (REPO_ROOT / "plugins/xagent/scripts/xagent").read_text(encoding="utf-8")
        self.assertNotIn("/Users/", launcher)
        self.assertIn("SHEAF_XAGENT_LOG_ROOT", launcher)
        self.assertIn(".xagent/data", launcher)
```

Use whatever constant that test module already uses for the repo root instead of `REPO_ROOT` if it differs.

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd /Users/joyo/Sheaf && python3 -m unittest plugins.xagent.scripts.install_global_test -k hardcoded -v`
Expected: FAIL — `/Users/joyo/Sheaf/data/xagent` is present.

If that module path does not import cleanly, run it the way the repo already
runs it (check `plugins/xagent/Makefile` or the root `Makefile` for the
existing invocation) and use that command for the rest of this task.

- [ ] **Step 3: Discover the Sheaf root instead of hardcoding it**

In `plugins/xagent/scripts/xagent`, replace line 7 and the export at line 26:

```bash
find_sheaf_root() {
  local dir="${1}"
  while [ "${dir}" != "/" ]; do
    if [ -f "${dir}/config/services.json" ] && [ -d "${dir}/structure" ]; then
      printf '%s\n' "${dir}"
      return 0
    fi
    dir="$(dirname "${dir}")"
  done
  return 1
}

default_log_root() {
  local sheaf_root
  if sheaf_root="$(find_sheaf_root "$(pwd -P)")"; then
    printf '%s\n' "${sheaf_root}/data/xagent"
    return 0
  fi
  printf '%s\n' "${HOME}/.xagent/data"
}

export XAGENT_LOG_ROOT="${XAGENT_LOG_ROOT:-${SHEAF_XAGENT_LOG_ROOT:-$(default_log_root)}}"
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `cd /Users/joyo/Sheaf && python3 -m unittest plugins.xagent.scripts.install_global_test -k hardcoded -v`
Expected: PASS.

- [ ] **Step 5: Verify the launcher still runs**

Run: `cd /Users/joyo/Sheaf && bash plugins/xagent/scripts/xagent --help | head -3`
Expected: the usage block, unchanged.

- [ ] **Step 6: Commit**

```bash
git add plugins/xagent/scripts/xagent plugins/xagent/scripts/install_global_test.py
git commit -m "fix(xagent): discover the Sheaf log root instead of hardcoding one user's path"
```

---

### Task 11: Reap the leaked legacy subagent processes (F2)

**Files:** none — operational cleanup.

- [ ] **Step 1: List what is about to be killed**

Run:
```bash
ps -eo pid,etime,command | grep "main.js run --harness" | grep -v grep
```
Expected: ~30 `node …/xagent/dist/src/main.js run --harness …` processes, oldest ~6 days.

- [ ] **Step 2: Confirm none belong to a live session**

Run:
```bash
ps -eo pid,etime,command | grep "main.js run --harness" | grep -v grep | awk '$2 !~ /-/ {print "RECENT:", $0}'
```
Expected: no output (every survivor is days old, so none is an in-flight run).
If anything prints, stop and report it rather than killing it.

- [ ] **Step 3: Kill them**

Run:
```bash
pkill -f "main.js run --harness"
```

- [ ] **Step 4: Verify**

Run: `ps -eo pid,command | grep -c "main.js run --harness"`
Expected: `1` (the grep itself) or `0`.

- [ ] **Step 5: Record the count in the findings doc**

Append the reaped count and date under finding F2 in
`docs/superpowers/specs/2026-07-27-xagent-controller-usability-design.md`, then:

```bash
git add docs/superpowers/specs/2026-07-27-xagent-controller-usability-design.md
git commit -m "docs(xagent): record the leaked legacy subagent reap"
```

---

## Out of scope for this plan

| Item | Why it is not here |
|---|---|
| A1 (MCP for all harnesses), A2 (harness-neutral skill for all harnesses) | Tier 2 — installer/registry surface across four harnesses; needs its own plan |
| A3 (SDD CLI verbs vs. MCP-only) | Awaiting decision |
| A5 (facade discoverability) | Awaiting decision |
| C1 (restart path after close), C2 (direct fixer start) | Awaiting decision |
| C3 (dirty tree on cancel) | Deferred |
| D1 (worker → controller question channel) | Awaiting design |
| D3 (template marketplace pin) | No action — transient, fixed by the audited branch |
