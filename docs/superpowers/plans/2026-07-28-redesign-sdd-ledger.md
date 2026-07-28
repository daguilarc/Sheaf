# SDD Ledger v2 Redesign Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the xagent SDD turn ledger with an insert-only per-agent dispatch index whose correctness does not depend on the controller, and make the run logs able to answer "what was this agent told".

**Architecture:** The v1 ledger (`sdd_sessions` + `sdd_turns`, schema version 1) mirrors what the controller observed and rots whenever the controller and reality diverge. It is deleted outright and replaced by a schema-version-2 `sdd_agents` table holding one immutable row per dispatched agent — identity and assignment only, written once at dispatch, never updated, never deleted. Everything mutable (phase, reports, submitted prompts, failures) lives in the supervisor-written run directory at `<log_root>/<agent_id>/`, which becomes the system of record. A new `turn.submitted` normalized event is the precondition for that: the supervisor durably records the full submitted text before the provider ever sees it. The MCP surface shrinks to seven generic tools plus `xagent_sdd_start` (now a four-way role union) and `xagent_sdd_followup` (demoted to a render-and-submit convenience that writes nothing).

**Tech Stack:** TypeScript (NodeNext, `strict: true`), Node 20+, `node:test`, `better-sqlite3`, `zod` v3, `@modelcontextprotocol/sdk`. Python 3 for the `dispatch-prompt` renderer, the plugin packaging scripts, and the agents installer.

## Global Constraints

- All work happens in the worktree at `/Users/joyo/Sheaf/.claude/worktrees/sdd-ledger-v2-redesign-6203c5`. Paths below are relative to that root unless absolute.
- **Do not restart the live xagent service, do not stop it, and do not run `make xagent-service-run`, at any point except where Tasks 7 and 8 explicitly instruct it.** The controller is dispatching *through* that service: taking it down mid-task takes the SDD tooling down with it.
- **The no-restart window runs from Task 4 to Task 8a, and both ends are load-bearing.** Task 4 deletes the last caller of `store.MarkCompleted`, so from that build onward a turn opened by `Start` can never be resolved, while v1 `Followup` still refuses to run against an open turn (`GetOpenTurn` → `sdd_turn_unresolved`). A service restarted between Task 4 and Task 5 therefore accepts dispatches and then permanently refuses every follow-up to them — the controller's own loop, with no recovery. From Task 6 the second hazard stacks on top: `Start` writes through the v1 transitional adapter, leaking a `prepared` turn per dispatch. Both close at Task 8a, which wires the v2 store whose `Followup` neither reads nor writes turn state. The running process keeps the code it loaded at startup, so builds landing during this window are harmless *provided nothing restarts it*.
- **The live service runs from a different worktree** (`/Users/joyo/Sheaf/.claude/worktrees/xagent-controller-usability`, a v1 build) and shares the log root `/Users/joyo/Sheaf/data/xagent`. Nothing you land here reaches the running process until the lead repoints it at Task 8a. Never edit, build, or run anything in that other worktree.
- **Every task must leave the tree compiling and its tests green.** Run `cd projects/xagent && npm run build` before claiming any task done. TypeScript is `strict`; an unused import or an unreachable literal comparison is a build failure.
- The v1 store stays wired and correct until Task 8. Do not delete v1 exports while `sdd_manager.ts` or `service_main.ts` still call them.
- Code style in `projects/xagent/src/service/` uses Allman braces for functions in `sdd_manager.ts` and K&R elsewhere; match the file you are editing. Module-private constants are prefixed `x_`. Exported store/manager functions are `PascalCase`.
- No `UPDATE` or `DELETE` statement against `sdd_agents` may be compiled anywhere, ever.
- Commit after every task. Do not squash tasks into one commit.

## Requirement traceability

Requirement ids are from `openspec/changes/redesign-sdd-ledger/specs/xagent-service/spec.md`. Each task names the ids it satisfies.

| Requirement | Tasks |
|---|---|
| xsvc-4 — MCP tool surface, deleted facade tools | 4 |
| xsvc-5 — `xagent_await` is the only await tool | 4 |
| xsvc-6 — working-directory validation before any ledger row | 6 |
| xsvc-8 — insert-only per-agent ledger, schema gate | 2, 6, 8, 9 |
| xsvc-9 — durable `turn.submitted` record | 1, 9 |
| xsvc-10 — immutable start role, durable brief, no lineage | 2, 6 |
| xsvc-11 — four-way start role union | 3, 6 |
| xsvc-12 — demoted `xagent_sdd_followup` | 3, 5 |
| xsvc-13 — SDD identity and tombstones in `xagent_list` | 8 |
| xsvc-14 — run directories are the system of record | 10 |
| xsvc-15 — SDD dispatch tools advertise their input contract | 0 |

## File Structure

**Created:**
- None. Every change lands in an existing file.

**Modified — service:**
- `projects/xagent/src/supervision/types.ts` — `SupervisionEvent["type"]` gains `"turn.submitted"`.
- `projects/xagent/src/supervision/supervisor.ts` — emit `turn.submitted` inside `submit()`.
- `projects/xagent/src/service/run_manager.ts` — exclude `turn.submitted` from persisted-await wakes; v2 `xagent_list` row types.
- `projects/xagent/src/service/sdd_store.ts` — add the v2 `sdd_agents` store and the `SddAgentStore` port; later delete all of v1.
- `projects/xagent/src/service/tool_schemas.ts` — v2 start-role union, v2 followup shapes, delete the SDD await/close input schemas.
- `projects/xagent/src/service/sdd_prompt.ts` — fix-dispatch formatter for the fresh `fixer` role.
- `projects/xagent/src/service/sdd_manager.ts` — `Start` v2, `Followup` demoted, all v1 machinery deleted.
- `projects/xagent/src/service/mcp.ts` — unregister the two SDD facade tools, route generics straight to the run manager.
- `projects/xagent/src/service_main.ts` — wire the v2 store, drop the ledger reconciliation call.

**Modified — tests:**
- `projects/xagent/tests/supervision.test.ts`, `mcp_await.test.ts`, `sdd_store.test.ts`, `sdd_manager.test.ts`, `sdd_prompt.test.ts`, `mcp.test.ts`, `e2e.test.ts`, `supervision_e2e.test.ts`.

**Modified — docs, skills, packaging:**
- `plugins/xagent/skills/xagent-subagents/SKILL.md`, `plugins/xagent/README.md`, `plugins/xagent/scripts/install_global_test.py`, `plugins/xagent/assets/`.
- `projects/agents/global/skills/openspec-superpowers-workflow/SKILL.md`.
- `openspec/specs/xagent-service/spec.md`, `openspec/specs/xagent-sdd-workflow/spec.md`.

## Sequencing rationale (read before starting)

The order is not arbitrary. Tasks 2 and 3 are **additive** — new exports beside the old ones, no behavior change. Task 4 is **subtractive** — it removes v1 machinery that nothing in v2 wants, and it is safe before the cutover because the report it stopped persisting was always redundant with the `turn.completed` event. Tasks 5 and 6 rewrite the manager against a narrow `SddAgentStore` port that **both** the v1 and v2 stores implement, so the live service keeps working on the v1 file. Task 7 is the operator reprovision gate. Task 8 is the only task that wires the v2 store, and therefore the only build whose first restart can trip the `user_version != 2` schema gate — which is why Task 7 immediately precedes it.

Two restart boundaries are load-bearing and must not be re-ordered:

1. **Ledger schema gate.** No build from Task 8 onward may reach the live service before Task 7's reprovision has been performed.
2. **Tool surface and manager land together.** The `xagent_sdd_start` union swap lives inside Task 6 with the `Start` rewrite, and the followup schema change lives inside Task 5 with the `Followup` rewrite. Never split them: a service whose tool surface accepts v2 roles while its manager implements v1 accepts dispatches it cannot serve.


## Execution guidance (read before dispatching anything)

**Nine tasks get dispatched. Three do not.**

Task 0 is a **controller checkpoint** and the precondition for every dispatch
in this plan. It repairs the tool surface the controller dispatches *through*,
so it cannot be handed to a subagent: the facade must already advertise its
input contract before an implementer can be started at all. The lead
implements it, restarts the live service onto the fixed build, and verifies
discovery before Task 1 is dispatched.


Tasks 7 and 11 are **controller checkpoints, not implementer work.** Task 7 is
`stop the service; rm sdd.sqlite; leave it down`. Task 11 is `run four suites;
repackage; commit`. Dispatching an implementer plus two reviewers for either
costs three agent runs and two review verdicts to wrap a command the lead runs
in seconds and verifies by reading the output. Worse, an implementer cannot
honestly verify them: both depend on live service state only the lead can see.
The lead executes 7 and 11 directly and records the evidence in the task.

**Task 8 is split into two dispatches with a review gate between them**, and
must not be given to one implementer:

- **Task 8a — the cutover.** Steps 1–4 and 6–9: wire the v2 store into
  `service_main.ts`, port `ListGeneric` to the v2 store keeping its current
  output shape, delete the v1 store, prove no `UPDATE`/`DELETE` against
  `sdd_agents` compiles, restart the service. This is the single most
  irreversible step in the plan.
- **Task 8b — the list shape.** Step 5 only: `xagent_list` v2 output per design
  D8 — the parallel `XagentSddTombstoneRow`, the dropped `agent`/`closed`
  fields, `run_missing: true` entries.

They are bundled in the task text below because they touch the same files, but
8b is a *new feature* and 8a is a *deletion that cannot be undone*. A tombstone
bug must not block the cutover, and a cutover that needs reverting must not
drag a feature back with it.

**Everything else is correctly sized.** Tasks 1, 2, 3, 5, 6, 9, and 10 are each
one coherent change with its own tests, 6–9 steps. Task 4 bundles three
deletions but they are one theme (the report-binding machinery); it is the
riskiest dispatch because it edits five separate line ranges in `mcp.ts` — give
it the closest review, and expect a fix round.

---

### Task 0: Advertise the SDD dispatch tools' input contract
**CONTROLLER CHECKPOINT — do not dispatch. This repairs the dispatch path itself.**

**Satisfies:** xsvc-15

**Files:**
- Modify: `projects/xagent/src/service/mcp.ts` (the two `registerTool` calls for `xagent_sdd_start` and `xagent_sdd_followup`)
- Test: `projects/xagent/tests/mcp.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces: a `tools/list` response in which both SDD tools carry a non-empty
  `inputSchema`. Task 6's tool-surface test depends on this; without it that
  test cannot pass.

**The defect.** `McpServer.registerTool` derives the advertised JSON Schema
from a `ZodObject`/`ZodRawShape`. Both SDD tools are registered by passing
`XagentSddStartInputSchema` / `XagentSddFollowupInputSchema`, which are
`z.discriminatedUnion`s. The SDK cannot derive a shape from a union and
advertises `{}`. Verified against the live service:

```
xagent_await         props=3   ['after_sequence', 'deadline_seconds', 'run_id']
xagent_sdd_start     props=0   []
xagent_sdd_followup  props=0   []
```

Runtime validation is unaffected — a well-typed call reaches business logic
normally. Only discovery is broken, which is enough to make every client that
trusts the schema serialize its arguments wrongly.

- [x] **Step 1: Write the failing tool-surface tests**

Add to `projects/xagent/tests/mcp.test.ts`: for each of `xagent_sdd_start`
and `xagent_sdd_followup`, assert the advertised `inputSchema` has a
non-empty `properties` map, names the discriminating field (`role` / `kind`),
and enumerates that field's permitted values. Then assert the superset
direction that matters: for every start role and every follow-up kind, a
payload the union accepts is also accepted by the advertised schema. The
reverse is deliberately not asserted — the advertised schema is permissive
and the union does the rejecting.

- [x] **Step 2: Run to verify failure**

```bash
cd projects/xagent && npm run build && node --test dist/tests/mcp.test.js
```

Expected: FAIL — `properties` is empty for both tools.

- [x] **Step 3: Supply the JSON Schema explicitly at registration**

Passing the union's JSON Schema directly does not work: `normalizeObjectSchema`
accepts only a raw shape or an object schema, so a plain JSON Schema object
falls through to the same empty result. Register both SDD tools with a
`ZodObject` that is a superset of the union instead — `role`/`kind` as an
enum of its permitted values, the fields shared by every variant required,
every variant-specific field optional and `.describe()`d with the variants
that require it.

The handler is unchanged: `parseToolInput(XagentSddStartInputSchema, args)`
still parses against the union, which remains the sole authority for
rejection. Keep the description and title text as they are.

- [x] **Step 4: Verify and commit**

```bash
cd projects/xagent && npm run build && node --test dist/tests/mcp.test.js && npm test
```

Expected: PASS, 0 failures.

```bash
git add projects/xagent/src/service/mcp.ts projects/xagent/tests/mcp.test.ts
git commit -m "fix(xagent): advertise the SDD dispatch tools' input schema (xsvc-15)"
```

- [x] **Step 5: Restart the live service onto the fixed build**

This restart is explicitly permitted and is the only one before Task 7. The
build at this point still wires the **v1** store against the existing v1
ledger, so no schema gate is involved. Confirm no runs are live first, then
restart and verify discovery:

```bash
curl -sS http://127.0.0.1:9005/health
```

Expected: `healthy: true`, and `tools/list` now reports non-zero property
counts for both SDD tools.

---

### Task 1: `turn.submitted` supervision event

**Satisfies:** xsvc-9

**Files:**
- Modify: `projects/xagent/src/supervision/types.ts:18`
- Modify: `projects/xagent/src/supervision/supervisor.ts:236-268` (`submit`), and add a private helper next to `#publishState` at `:559`
- Modify: `projects/xagent/src/service/run_manager.ts:644-663` (`isPersistedAwaitWake`)
- Test: `projects/xagent/tests/supervision.test.ts`
- Test: `projects/xagent/tests/mcp_await.test.ts`

**Interfaces:**
- Consumes: nothing from earlier tasks.
- Produces: normalized events of type `"turn.submitted"` with `phase: "running"`, `reason: "turn_submitted"`, and payload `{ text: string; turn_id: string }` where `turn_id` is `` `turn_${inputSequence}` `` — byte-identical to the `turn_id` the same turn's `turn.completed` / `missing_final_report` payloads already carry. Tasks 5, 6, and 9 assert against this shape.

**Context you need:**

`SequencedEventQueue.publish` (`src/supervision/event_queue.ts:50`) awaits `this.sink(event)` and rejects if the sink throws — so publishing before `session.submit` is exactly what makes a sink failure fail the submit. `Supervisor.#publishEvent` (`supervisor.ts:573`) calls `#assertTransition(body.phase)`; `running → running` is an allowed transition, so publishing a second `running` event inside `submit` is legal.

- [x] **Step 1: Write the failing tests**

Append to `projects/xagent/tests/supervision.test.ts`. Use the same fixture helpers the file already uses for other `submit` tests (find an existing `test("...submit...")` case and copy its setup verbatim — the supervisor construction, fake adapter, and captured `eventSink` array).

```ts
test("submit emits turn.submitted with the full text before the adapter sees it", async () => {
  const harness = createSupervisorHarness();          // existing helper in this file
  await harness.supervisor.start();
  await harness.supervisor.submit("Rendered prompt body\n\n## Controller Note\n\nbe careful\n");

  const submitted = harness.events.filter((event) => event.type === "turn.submitted");
  assert.equal(submitted.length, 1);
  assert.equal(submitted[0]!.phase, "running");
  assert.equal(submitted[0]!.reason, "turn_submitted");
  const payload = submitted[0]!.payload as { text: string; turn_id: string };
  assert.equal(payload.text, "Rendered prompt body\n\n## Controller Note\n\nbe careful\n");
  assert.equal(payload.turn_id, "turn_1");

  const started = harness.events.find(
    (event) => event.type === "supervision.state" && event.reason === "turn_started",
  );
  assert.ok(started);
  assert.equal(submitted[0]!.sequence, started.sequence + 1);

  const completed = harness.events.find((event) => event.type === "turn.completed");
  assert.ok(completed);
  assert.equal((completed.payload as { turn_id: string }).turn_id, payload.turn_id);
});

test("turn.submitted is durable before the provider adapter is invoked", async () => {
  const harness = createSupervisorHarness();
  await harness.supervisor.start();
  const seenBeforeAdapter: string[] = [];
  harness.adapter.onSubmit = () => {
    seenBeforeAdapter.push(...harness.events.map((event) => event.type));
  };
  await harness.supervisor.submit("hello");
  assert.ok(seenBeforeAdapter.includes("turn.submitted"));
});

test("a failed event-sink append fails the submit without reaching the provider", async () => {
  const harness = createSupervisorHarness();
  await harness.supervisor.start();
  let adapterCalled = false;
  harness.adapter.onSubmit = () => { adapterCalled = true; };
  harness.failEventSinkOnType("turn.submitted");
  await assert.rejects(() => harness.supervisor.submit("hello"));
  assert.equal(adapterCalled, false);
});

test("turn.submitted text is sanitized like every other payload", async () => {
  const harness = createSupervisorHarness();
  await harness.supervisor.start();
  await harness.supervisor.submit(`work in ${harness.cwd}/src and use sk-secret`);
  const submitted = harness.events.find((event) => event.type === "turn.submitted");
  const text = (submitted!.payload as { text: string }).text;
  assert.ok(!text.includes(harness.cwd));
});
```

If `createSupervisorHarness`, `harness.adapter.onSubmit`, or `failEventSinkOnType` do not already exist in the file under those names, add them to the file's existing helper section modelled on `FakeHarnessAdapter` in `src/adapters/fake.ts`. Do not invent a new test file.

Append to `projects/xagent/tests/mcp_await.test.ts`:

```ts
test("turn.submitted never wakes a live await", async () => {
  const service = await startMcpService();               // existing helper in this file
  try {
    const started = await service.startRun("await-filter");
    const pending = service.await(started.run_id, started.sequence, 5);
    await service.submit(started.run_id, "chit chat");
    const result = await pending;
    assert.notEqual(result.event, "turn.submitted");
  } finally {
    await service.close();
  }
});

test("the persisted-await wake filter ignores turn.submitted", () => {
  const event = {
    schema_version: 1,
    type: "turn.submitted",
    run_id: "xrun_20260728000000000_0000abcd",
    sequence: 4,
    timestamp: "2026-07-28T00:00:00.000Z",
    phase: "running",
    reason: "turn_submitted",
    payload: { text: "hello", turn_id: "turn_1" },
  };
  assert.equal(isPersistedAwaitWake(event), false);
});
```

Export `isPersistedAwaitWake` from `src/service/run_manager.ts` so the second test can import it (`export function isPersistedAwaitWake`).

- [x] **Step 2: Run the tests to verify they fail**

```bash
cd projects/xagent && npm run build && node --test dist/tests/supervision.test.js dist/tests/mcp_await.test.js
```

Expected: FAIL. The build fails first with `TS2322` on the `"turn.submitted"` literal not being assignable to `SupervisionEvent["type"]`.

- [x] **Step 3: Widen the event type union**

In `src/supervision/types.ts`, replace line 18:

```ts
  type: "supervision.state" | "supervision.attention" | "turn.completed" | "turn.submitted";
```

- [x] **Step 4: Emit the event in `Supervisor.submit`**

In `src/supervision/supervisor.ts`, inside `submit()`'s `#withLifecycleMutation` callback, insert one line immediately after the existing `await this.#publishState("running", "turn_started", false);` (line 244) and before the `this.#evidence = new SemanticEvidenceWindow({...})` assignment:

```ts
      await this.#publishSubmitted(turnId, text);
```

Add the helper immediately after `#publishState` (after line 570):

```ts
  // The full submitted text — rendered prompt plus any appended controller
  // note, or a raw xagent_message — recorded before the provider adapter is
  // handed the text. Published non-deliverable so it never completes a live
  // await. If this append fails, submit() rejects and the text is never sent:
  // text the log cannot prove was sent is not sent.
  //
  async #publishSubmitted(turnId: string, text: string): Promise<void> {
    await this.#publishEvent({
      type: "turn.submitted",
      phase: "running",
      reason: "turn_submitted",
      payload: sanitizeValue({ text, turn_id: turnId }, this.#startOptions.cwd),
    }, false);
  }
```

- [x] **Step 5: Exclude it from the persisted-await wake filter**

In `src/service/run_manager.ts`, `isPersistedAwaitWake` already whitelists only `supervision.attention`, `turn.completed`, and terminal `supervision.state`, so `turn.submitted` falls through to `false` today. Make that guarantee explicit and testable by exporting the function and adding a comment above line 658:

```ts
// Whitelist, not a blacklist: only these three shapes may wake a persisted
// await. `turn.submitted` is deliberately absent — it is a record of what was
// sent, never a deliverable outcome.
```

Change `function isPersistedAwaitWake` to `export function isPersistedAwaitWake`.

- [x] **Step 6: Run the tests to verify they pass**

```bash
cd projects/xagent && npm run build && node --test dist/tests/supervision.test.js dist/tests/mcp_await.test.js
```

Expected: PASS, 0 failures.

- [x] **Step 7: Run the full suite**

```bash
cd projects/xagent && npm test
```

Expected: PASS. Any pre-existing test that counts events on a run will now see one extra event per submit; update those counts rather than suppressing the new event.

- [x] **Step 8: Commit**

```bash
git add projects/xagent/src/supervision/types.ts projects/xagent/src/supervision/supervisor.ts projects/xagent/src/service/run_manager.ts projects/xagent/tests/supervision.test.ts projects/xagent/tests/mcp_await.test.ts
git commit -m "feat(xagent): record submitted text as a durable turn.submitted event (xsvc-9)"
```

---

### Task 2: v2 ledger store, additive alongside v1

**Satisfies:** xsvc-8, xsvc-10

**Files:**
- Modify: `projects/xagent/src/service/sdd_store.ts`
- Test: `projects/xagent/tests/sdd_store.test.ts`

**Interfaces:**
- Consumes: nothing from earlier tasks.
- Produces: the `SddAgentStore` port and its two implementations. Tasks 5, 6, and 8 program against this port and nothing else.

```ts
export type SddStartRole = "implementer" | "reviewer" | "fixer" | "re-reviewer";

export type SddAgentRecord = {
  readonly agent_id: string;
  readonly plan_path: string;
  readonly task: number | null;
  readonly role: SddStartRole;
  readonly brief_path: string;
  readonly brief_text: string;
  readonly cwd: string;
  readonly dispatched_at: string;
};

export type InsertSddAgentInput = {
  readonly agentId: string;
  readonly planPath: string;
  readonly task?: number;
  readonly role: SddStartRole;
  readonly briefPath: string;
  readonly briefText: string;
  readonly cwd: string;
};

export type SddAgentStore = {
  Insert(input: InsertSddAgentInput): void;
  Get(agentId: string): SddAgentRecord | undefined;
  ListAll(): readonly SddAgentRecord[];
  IsSddAgent(agentId: string): boolean;
  Close(): void;
};

export function CreateSddAgentStore(logRoot: string, clock?: () => Date): SddAgentStore;
```

**Critical:** v1's `CreateSddStore` and every v1 export stay exactly as they are. This task adds code; it removes none. `SddStore` gains the three `SddAgentStore` methods it does not already have (`Insert`, `Get`, `ListAll`) so that the v1 store also satisfies the port — that is transitional scaffolding, deleted in Task 8.

- [x] **Step 1: Write the failing store tests**

Append to `projects/xagent/tests/sdd_store.test.ts`. The file already has a temp-directory pattern (`mkdtemp` / `rm`); reuse it.

```ts
const x_V2AgentInput = {
  agentId: "xrun_20260728000000000_0000000a",
  planPath: "/tmp/plans/2026-07-28-redesign-sdd-ledger.md",
  task: 4,
  role: "implementer" as const,
  briefPath: "/tmp/sdd/task-4-brief.md",
  briefText: "Implement the v2 ledger store.\n",
  cwd: "/private/tmp/worktree",
};

test("v2 provisions exactly sdd_agents and its index at user_version 2", async () => {
  const logRoot = await mkdtemp(path.join(tmpdir(), "sdd-v2-"));
  try {
    const store = CreateSddAgentStore(logRoot);
    store.Close();
    const database = new Database(GetSddDatabasePath(logRoot), { readonly: true });
    try {
      assert.equal(database.pragma("user_version", { simple: true }), 2);
      const tables = database
        .prepare("SELECT name, type FROM sqlite_master WHERE type IN ('table','view','index') AND name NOT LIKE 'sqlite_%' ORDER BY name")
        .all() as Array<{ name: string; type: string }>;
      assert.deepEqual(tables, [
        { name: "sdd_agents", type: "table" },
        { name: "sdd_agents_assignment", type: "index" },
      ]);
    } finally {
      database.close();
    }
  } finally {
    await rm(logRoot, { recursive: true, force: true });
  }
});

test("v2 inserts are readable and carry the brief text as dispatched", async () => {
  const logRoot = await mkdtemp(path.join(tmpdir(), "sdd-v2-"));
  try {
    const store = CreateSddAgentStore(logRoot, () => new Date("2026-07-28T10:00:00.000Z"));
    store.Insert(x_V2AgentInput);
    const row = store.Get(x_V2AgentInput.agentId);
    assert.deepEqual(row, {
      agent_id: x_V2AgentInput.agentId,
      plan_path: x_V2AgentInput.planPath,
      task: 4,
      role: "implementer",
      brief_path: x_V2AgentInput.briefPath,
      brief_text: x_V2AgentInput.briefText,
      cwd: x_V2AgentInput.cwd,
      dispatched_at: "2026-07-28T10:00:00.000Z",
    });
    assert.equal(store.IsSddAgent(x_V2AgentInput.agentId), true);
    assert.equal(store.IsSddAgent("xrun_20260728000000000_ffffffff"), false);
    store.Close();
  } finally {
    await rm(logRoot, { recursive: true, force: true });
  }
});

test("a task-less reviewer row stores NULL task", async () => {
  const logRoot = await mkdtemp(path.join(tmpdir(), "sdd-v2-"));
  try {
    const store = CreateSddAgentStore(logRoot);
    store.Insert({ ...x_V2AgentInput, role: "reviewer", task: undefined });
    assert.equal(store.Get(x_V2AgentInput.agentId)!.task, null);
    store.Close();
  } finally {
    await rm(logRoot, { recursive: true, force: true });
  }
});

test("multiple agents may share plan, task, and role", async () => {
  const logRoot = await mkdtemp(path.join(tmpdir(), "sdd-v2-"));
  try {
    const store = CreateSddAgentStore(logRoot);
    store.Insert(x_V2AgentInput);
    store.Insert({ ...x_V2AgentInput, agentId: "xrun_20260728000000000_0000000b" });
    assert.equal(store.ListAll().length, 2);
    store.Close();
  } finally {
    await rm(logRoot, { recursive: true, force: true });
  }
});

test("opening a v1 ledger refuses with an actionable reprovision message", async () => {
  const logRoot = await mkdtemp(path.join(tmpdir(), "sdd-v2-"));
  try {
    CreateSddStore(logRoot).Close();          // writes user_version = 1
    assert.throws(
      () => CreateSddAgentStore(logRoot),
      (error: unknown) => {
        assert.ok(error instanceof SddStoreError);
        assert.match(error.message, /sdd\.sqlite/);
        assert.match(error.message, /-wal/);
        assert.match(error.message, /-shm/);
        assert.match(error.message, /not migrated/);
        return true;
      },
    );
  } finally {
    await rm(logRoot, { recursive: true, force: true });
  }
});

test("reopening a v2 ledger writes nothing", async () => {
  const logRoot = await mkdtemp(path.join(tmpdir(), "sdd-v2-"));
  try {
    const first = CreateSddAgentStore(logRoot);
    first.Insert(x_V2AgentInput);
    first.Close();
    const before = statSync(GetSddDatabasePath(logRoot)).size;
    const digestBefore = CreateSddAgentStore(logRoot);
    const rows = digestBefore.ListAll();
    digestBefore.Close();
    assert.equal(rows.length, 1);
    assert.equal(statSync(GetSddDatabasePath(logRoot)).size, before);
  } finally {
    await rm(logRoot, { recursive: true, force: true });
  }
});

test("no update or delete statement against sdd_agents is compiled", async () => {
  const source = await readFile(
    new URL("../../src/service/sdd_store.ts", import.meta.url),
    "utf8",
  );
  const v2Section = source.slice(source.indexOf("CreateSddAgentStore"));
  assert.equal(/UPDATE\s+sdd_agents/i.test(v2Section), false);
  assert.equal(/DELETE\s+FROM\s+sdd_agents/i.test(v2Section), false);
});
```

Add `readFile` to the file's `node:fs/promises` import and `CreateSddAgentStore` to the store import.

- [x] **Step 2: Run to verify failure**

```bash
cd projects/xagent && npm run build && node --test dist/tests/sdd_store.test.js
```

Expected: FAIL — build error, `CreateSddAgentStore` is not exported from `sdd_store.ts`.

- [x] **Step 3: Add the v2 schema and store**

In `src/service/sdd_store.ts`, after the existing `x_SchemaSql` constant (line 167), add:

```ts
const x_AgentSchemaVersion = 2;

const x_AgentSchemaSql = `
CREATE TABLE sdd_agents
(
    agent_id      TEXT PRIMARY KEY,
    plan_path     TEXT NOT NULL,
    task          INTEGER,
    role          TEXT NOT NULL CHECK (role IN
                      ('implementer', 'reviewer', 'fixer', 're-reviewer')),
    brief_path    TEXT NOT NULL,
    brief_text    TEXT NOT NULL,
    cwd           TEXT NOT NULL,
    dispatched_at TEXT NOT NULL,
    CHECK (task IS NULL OR task > 0)
);

CREATE INDEX sdd_agents_assignment ON sdd_agents(plan_path, task, role);
`;
```

Add the port types from the **Interfaces** block above near the top of the file, beside the existing `SddRole` type.

Then add the factory at the end of the file, before `GetSddDatabasePath`:

```ts
function MapAgentRow(row: Record<string, unknown>): SddAgentRecord
{
  return {
    agent_id: String(row.agent_id),
    plan_path: String(row.plan_path),
    task: row.task === null || row.task === undefined ? null : Number(row.task),
    role: row.role as SddStartRole,
    brief_path: String(row.brief_path),
    brief_text: String(row.brief_text),
    cwd: String(row.cwd),
    dispatched_at: String(row.dispatched_at),
  };
}

// The v2 ledger is an immutable dispatch index. It is provisioned at
// user_version 2 and never migrated: a v1 file is refused outright, because a
// half-working ledger is worse than a loud one. No UPDATE or DELETE statement
// against sdd_agents is prepared here, so no code path can rot a row.
//
export function CreateSddAgentStore(
  logRoot: string,
  clock: () => Date = () => new Date(),
): SddAgentStore {
  EnsureOwnerOnlyDirectory(logRoot);
  const databasePath = path.join(logRoot, x_DatabaseFileName);
  if (existsSync(databasePath)) {
    EnsureOwnerOnlyLedgerFiles(databasePath);
  }
  const database = OpenSddLedgerDatabase(databasePath);
  EnsureOwnerOnlyLedgerFiles(databasePath);

  const userVersion = database.pragma("user_version", { simple: true }) as number;
  if (userVersion !== 0 && userVersion !== x_AgentSchemaVersion) {
    database.close();
    throw new SddStoreError(
      `SDD ledger at ${databasePath} is schema version ${userVersion}; `
      + `this service requires version ${x_AgentSchemaVersion}. `
      + "v1 data is not migrated: stop the service, delete "
      + `${databasePath}, ${databasePath}-wal, and ${databasePath}-shm, `
      + "then start the service to provision a fresh v2 ledger.",
      "sdd_ledger_schema_mismatch",
    );
  }
  if (userVersion === 0) {
    const provision = database.transaction(() => {
      database.exec(x_AgentSchemaSql);
      database.pragma(`user_version = ${x_AgentSchemaVersion}`);
    });
    provision();
  }

  const insertAgent = database.prepare(`
    INSERT INTO sdd_agents (
      agent_id, plan_path, task, role, brief_path, brief_text, cwd, dispatched_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `);
  const selectAgent = database.prepare(
    "SELECT agent_id, plan_path, task, role, brief_path, brief_text, cwd, dispatched_at "
    + "FROM sdd_agents WHERE agent_id = ?",
  );
  const selectAllAgents = database.prepare(
    "SELECT agent_id, plan_path, task, role, brief_path, brief_text, cwd, dispatched_at "
    + "FROM sdd_agents ORDER BY dispatched_at",
  );

  let closed = false;

  return {
    Insert(input: InsertSddAgentInput): void {
      if (closed) {
        throw new SddStoreError("SDD agent store is closed.");
      }
      insertAgent.run(
        input.agentId,
        input.planPath,
        input.task ?? null,
        input.role,
        input.briefPath,
        input.briefText,
        input.cwd,
        clock().toISOString(),
      );
    },
    Get(agentId: string): SddAgentRecord | undefined {
      const row = selectAgent.get(agentId) as Record<string, unknown> | undefined;
      return row === undefined ? undefined : MapAgentRow(row);
    },
    ListAll(): readonly SddAgentRecord[] {
      return (selectAllAgents.all() as Array<Record<string, unknown>>).map(MapAgentRow);
    },
    IsSddAgent(agentId: string): boolean {
      return selectAgent.get(agentId) !== undefined;
    },
    Close(): void {
      if (!closed) {
        closed = true;
        database.close();
      }
    },
  };
}
```

- [x] **Step 4: Make the v1 store satisfy the same port (transitional)**

Widen `SddSessionRecord.role` from `SddRole` to `string` (line 19), then add three methods to the `SddStore` type (line 68) and to `CreateSddStore`'s returned object:

```ts
  Insert(input: InsertSddAgentInput): void;
  Get(agentId: string): SddAgentRecord | undefined;
  ListAll(): readonly SddAgentRecord[];
```

Implement them over the v1 tables. Add above the `return {` in `CreateSddStore`:

```ts
  // TRANSITIONAL (deleted in the v1 store removal task). Lets the v1 ledger
  // satisfy SddAgentStore so the manager can be rewritten against the v2 port
  // while the live service is still running on a v1 file. The v1 columns the
  // v2 model drops are written as 'unrecorded' rather than guessed.
  //
  const selectFirstTurn = database.prepare(`
    SELECT brief_path, brief_text FROM sdd_turns
    WHERE agent_id = ? ORDER BY turn_number ASC LIMIT 1
  `);
  const selectAllSessions = database.prepare(`
    SELECT agent_id, plan_path, task_number, role, cwd, started_at
    FROM sdd_sessions ORDER BY started_at
  `);

  function AgentRecordFor(row: Record<string, unknown>): SddAgentRecord {
    const turn = selectFirstTurn.get(String(row.agent_id)) as
      | { brief_path: string; brief_text: string }
      | undefined;
    return {
      agent_id: String(row.agent_id),
      plan_path: String(row.plan_path),
      task: row.task_number === null || row.task_number === undefined
        ? null
        : Number(row.task_number),
      role: row.role as SddStartRole,
      brief_path: turn?.brief_path ?? "",
      brief_text: turn?.brief_text ?? "",
      cwd: String(row.cwd),
      dispatched_at: String(row.started_at),
    };
  }
```

and in the returned object:

```ts
    Insert(input: InsertSddAgentInput): void {
      AssertOpen();
      const startedAt = clock().toISOString();
      const insert = database.transaction(() => {
        insertSession.run(
          input.agentId,
          path.basename(input.planPath, path.extname(input.planPath)),
          input.planPath,
          input.cwd,
          input.task ?? null,
          "unrecorded",
          "unrecorded",
          "unrecorded",
          input.role,
          startedAt,
        );
        insertTurn.run(
          input.agentId, 1, "initial", null,
          input.briefPath, input.briefText, null, null, null, "prepared", startedAt,
        );
      });
      insert();
    },

    Get(agentId: string): SddAgentRecord | undefined {
      AssertOpen();
      const row = selectSession.get(agentId) as Record<string, unknown> | undefined;
      return row === undefined ? undefined : AgentRecordFor(row);
    },

    ListAll(): readonly SddAgentRecord[] {
      AssertOpen();
      return (selectAllSessions.all() as Array<Record<string, unknown>>).map(AgentRecordFor);
    },
```

- [x] **Step 5: Run the store tests**

```bash
cd projects/xagent && npm run build && node --test dist/tests/sdd_store.test.js
```

Expected: PASS, 0 failures.

- [x] **Step 6: Run the full suite**

```bash
cd projects/xagent && npm test
```

Expected: PASS.

- [x] **Step 7: Commit**

```bash
git add projects/xagent/src/service/sdd_store.ts projects/xagent/tests/sdd_store.test.ts
git commit -m "feat(xagent): add the insert-only v2 sdd_agents store beside v1 (xsvc-8, xsvc-10)"
```

---

### Task 3: v2 start-role schemas and the fix-dispatch formatter, additive

**Satisfies:** xsvc-11, xsvc-12

**Files:**
- Modify: `projects/xagent/src/service/tool_schemas.ts`
- Modify: `projects/xagent/src/service/sdd_prompt.ts:234-247`
- Test: `projects/xagent/tests/mcp.test.ts`
- Test: `projects/xagent/tests/sdd_prompt.test.ts`

**Interfaces:**
- Consumes: nothing from earlier tasks.
- Produces:
  - `ReviewerStartSchema`, `FixerStartSchema`, `ReReviewerStartSchema`, and `XagentSddStartInputSchemaV2` (a `z.discriminatedUnion("role", …)` over `ImplementerStartSchema` and those three). Task 6 renames `XagentSddStartInputSchemaV2` to `XagentSddStartInputSchema` and deletes the v1 role schemas.
  - `FormatFixDispatch(input: FormatFixDispatchInput): string` in `sdd_prompt.ts`, where

    ```ts
    export type FormatFixDispatchInput = FormatFixFollowupInput & {
      readonly planPath: string;
      readonly task: number;
    };
    ```

**Critical:** `XagentSddStartInputSchema` (the v1 union), `TaskReviewerStartSchema`, and `CodeReviewerStartSchema` stay exactly as they are. `mcp.ts` and `sdd_manager.ts` are not touched.

- [x] **Step 1: Write the failing schema tests**

Append to `projects/xagent/tests/mcp.test.ts`:

```ts
const x_Assignment = {
  cwd: "/private/tmp/worktree",
  plan: "/tmp/plans/2026-07-28-redesign-sdd-ledger.md",
  agent: "grok-4.5",
  harness: "cursor",
  effort: "high",
};

test("reviewer with a task requires report and forbids description", () => {
  const scoped = ReviewerStartSchema.safeParse({
    role: "reviewer", ...x_Assignment, task: 4,
    brief: "/tmp/sdd/task-4-review-brief.md",
    report: "/tmp/sdd/task-4-report.md",
    base: "main", head: "HEAD",
  });
  assert.equal(scoped.success, true);

  assert.equal(ReviewerStartSchema.safeParse({
    role: "reviewer", ...x_Assignment, task: 4,
    brief: "/tmp/sdd/task-4-review-brief.md", base: "main", head: "HEAD",
  }).success, false);

  assert.equal(ReviewerStartSchema.safeParse({
    role: "reviewer", ...x_Assignment, task: 4,
    brief: "/tmp/b.md", report: "/tmp/r.md", base: "main", head: "HEAD",
    description: "whole branch",
  }).success, false);
});

test("reviewer without a task requires description and forbids task-scoped fields", () => {
  assert.equal(ReviewerStartSchema.safeParse({
    role: "reviewer", ...x_Assignment,
    brief: "/tmp/review-brief.md", base: "main", head: "HEAD",
    description: "Branch adds the v2 ledger.",
  }).success, true);

  assert.equal(ReviewerStartSchema.safeParse({
    role: "reviewer", ...x_Assignment,
    brief: "/tmp/review-brief.md", base: "main", head: "HEAD",
  }).success, false);

  assert.equal(ReviewerStartSchema.safeParse({
    role: "reviewer", ...x_Assignment,
    brief: "/tmp/review-brief.md", base: "main", head: "HEAD",
    description: "Branch adds the v2 ledger.", report: "/tmp/r.md",
  }).success, false);
});

test("v1 role names and the review_brief field name are rejected", () => {
  assert.equal(XagentSddStartInputSchemaV2.safeParse({
    role: "task-reviewer", ...x_Assignment, task: 4,
    brief: "/tmp/b.md", report: "/tmp/r.md", base: "main", head: "HEAD",
  }).success, false);
  assert.equal(XagentSddStartInputSchemaV2.safeParse({
    role: "code-reviewer", ...x_Assignment,
    review_brief: "/tmp/b.md", description: "x", base: "main", head: "HEAD",
  }).success, false);
  assert.equal(ReviewerStartSchema.safeParse({
    role: "reviewer", ...x_Assignment,
    review_brief: "/tmp/b.md", base: "main", head: "HEAD", description: "x",
  }).success, false);
});

test("fixer requires task, brief, findings, tests, and report and rejects name", () => {
  const valid = {
    role: "fixer" as const, ...x_Assignment, task: 4,
    brief: "/tmp/sdd/task-4-brief.md",
    findings: "/tmp/sdd/task-4-findings.md",
    findings_text: "Two open findings.",
    tests: ["npm test"],
    report: "/tmp/sdd/task-4-report.md",
  };
  assert.equal(FixerStartSchema.safeParse(valid).success, true);
  assert.equal(FixerStartSchema.parse(valid).round, 1);
  assert.equal(FixerStartSchema.safeParse({ ...valid, round: 3 }).success, true);
  assert.equal(FixerStartSchema.safeParse({ ...valid, name: "Task 4 Fix Round 1" }).success, false);
  assert.equal(FixerStartSchema.safeParse({ ...valid, context: "extra" }).success, false);
  assert.equal(FixerStartSchema.safeParse({ ...valid, tests: [] }).success, false);
});

test("re-reviewer requires the original review brief", () => {
  const valid = {
    role: "re-reviewer" as const, ...x_Assignment, task: 4,
    brief: "/tmp/sdd/task-4-review-brief.md",
    findings: "/tmp/sdd/task-4-findings.md",
    report: "/tmp/sdd/task-4-report.md",
    base: "main", head: "HEAD",
  };
  assert.equal(ReReviewerStartSchema.safeParse(valid).success, true);
  const { brief, ...withoutBrief } = valid;
  assert.equal(ReReviewerStartSchema.safeParse(withoutBrief).success, false);
});

test("worker-facing text on v2 roles still rejects controller run ids", () => {
  assert.equal(FixerStartSchema.safeParse({
    role: "fixer", ...x_Assignment, task: 4,
    brief: "/tmp/b.md", findings: "/tmp/f.md",
    findings_text: "see xrun_20260728000000000_0000abcd",
    tests: ["npm test"], report: "/tmp/r.md",
  }).success, false);
});

test("v2 followup shapes require report and keep round render-only", () => {
  const fix = {
    kind: "fix" as const,
    agent_id: "xrun_20260728000000000_0000abcd",
    round: 2,
    findings: "/tmp/f.md",
    findings_text: "one finding",
    tests: ["npm test"],
    report: "/tmp/r.md",
  };
  assert.equal(FixFollowupSchema.safeParse(fix).success, true);
  const { report, ...withoutReport } = fix;
  assert.equal(FixFollowupSchema.safeParse(withoutReport).success, false);

  const reReview = {
    kind: "re-review" as const,
    agent_id: "xrun_20260728000000000_0000abcd",
    round: 2,
    findings: "/tmp/f.md",
    report: "/tmp/r.md",
    base: "main", head: "HEAD",
  };
  assert.equal(ReReviewFollowupSchema.safeParse(reReview).success, true);
  const { report: r2, ...reReviewWithoutReport } = reReview;
  assert.equal(ReReviewFollowupSchema.safeParse(reReviewWithoutReport).success, false);
});
```

Import `ReviewerStartSchema`, `FixerStartSchema`, `ReReviewerStartSchema`, `XagentSddStartInputSchemaV2`, `FixFollowupSchema`, and `ReReviewFollowupSchema` from `../src/service/tool_schemas.js`.

Append to `projects/xagent/tests/sdd_prompt.test.ts`:

```ts
test("FormatFixDispatch is the same-agent fix text plus a plan/task/role header", () => {
  const shared = {
    round: 2,
    briefPath: "/tmp/sdd/task-4-brief.md",
    findingsPath: "/tmp/sdd/task-4-findings.md",
    findingsText: "Finding 1: the gate is missing.",
    tests: ["npm test", "node --test dist/tests/sdd_store.test.js"],
    reportPath: "/tmp/sdd/task-4-report.md",
  };
  const continuation = FormatFixFollowup(shared);
  const dispatch = FormatFixDispatch({
    ...shared,
    planPath: "/tmp/plans/2026-07-28-redesign-sdd-ledger.md",
    task: 4,
  });
  assert.equal(
    dispatch,
    "You are a fixer for task 4 of plan "
    + "/tmp/plans/2026-07-28-redesign-sdd-ledger.md.\n"
    + "You are a fresh agent: read the brief and the findings before changing anything.\n\n"
    + continuation,
  );
  assert.ok(dispatch.endsWith(continuation));
});
```

- [x] **Step 2: Run to verify failure**

```bash
cd projects/xagent && npm run build && node --test dist/tests/mcp.test.js dist/tests/sdd_prompt.test.js
```

Expected: FAIL — build error, none of the new exports exist.

- [x] **Step 3: Add the v2 role schemas**

In `src/service/tool_schemas.ts`, after `CodeReviewerStartSchema` (line 164), add:

```ts
// v2 start roles. Added beside the v1 shapes so the tool surface can be cut
// over in the same task that rewrites the manager — never before it.
//
export const ReviewerStartSchema = z
  .object({
    role: z.literal("reviewer"),
    ...SddAssignmentFields,
    task: z.number().int().positive().optional(),
    brief: SddArtifactPathSchema,
    base: z.string().min(1),
    head: z.string().min(1),
    report: SddArtifactPathSchema.optional(),
    constraints: SddArtifactPathSchema.optional(),
    diff: SddArtifactPathSchema.optional(),
    description: WorkerFacingText("description").optional(),
  })
  .strict()
  .superRefine((value, ctx) => {
    if (value.task === undefined) {
      if (value.description === undefined) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: "reviewer without a task requires description (whole-branch review)",
        });
      }
      for (const field of ["report", "constraints", "diff"] as const) {
        if (value[field] !== undefined) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            message: `reviewer without a task must not set ${field}`,
          });
        }
      }
      return;
    }
    if (value.report === undefined) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "reviewer with a task requires report",
      });
    }
    if (value.description !== undefined) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "reviewer with a task must not set description",
      });
    }
  });

export const FixerStartSchema = z
  .object({
    role: z.literal("fixer"),
    ...SddAssignmentFields,
    task: z.number().int().positive(),
    brief: SddArtifactPathSchema,
    findings: SddArtifactPathSchema,
    findings_text: WorkerFacingText("findings_text"),
    tests: z.array(z.string().min(1)).min(1),
    report: SddArtifactPathSchema,
    round: z.number().int().positive().default(1),
  })
  .strict();

export const ReReviewerStartSchema = z
  .object({
    role: z.literal("re-reviewer"),
    ...SddAssignmentFields,
    task: z.number().int().positive(),
    brief: SddArtifactPathSchema,
    findings: SddArtifactPathSchema,
    report: SddArtifactPathSchema,
    base: z.string().min(1),
    head: z.string().min(1),
    diff: SddArtifactPathSchema.optional(),
    round: z.number().int().positive().default(1),
  })
  .strict();

export const XagentSddStartInputSchemaV2 = z.discriminatedUnion("role", [
  ImplementerStartSchema,
  ReviewerStartSchema,
  FixerStartSchema,
  ReReviewerStartSchema,
]);
```

**Note on `z.discriminatedUnion` and `superRefine`:** zod v3 rejects a `ZodEffects` member in a discriminated union. Build `ReviewerStartSchema` as the `.strict()` object, export the refined version separately, and put the **unrefined** object in the union while applying the refinement at parse time:

```ts
const ReviewerStartObject = z.object({ /* fields exactly as above */ }).strict();
export const ReviewerStartSchema = ReviewerStartObject.superRefine(reviewerRefinement);
export const XagentSddStartInputSchemaV2 = z
  .discriminatedUnion("role", [
    ImplementerStartSchema, ReviewerStartObject, FixerStartSchema, ReReviewerStartSchema,
  ])
  .superRefine((value, ctx) => {
    if (value.role === "reviewer") {
      reviewerRefinement(value, ctx);
    }
  });
```

Extract `reviewerRefinement` as a named function holding the body shown in the first snippet so both call sites share it.

- [x] **Step 4: Add `report` to the followup schemas**

In `FixFollowupSchema` (line 172) add `report: SddArtifactPathSchema,` after `tests`. In `ReReviewFollowupSchema` (line 184) add `report: SddArtifactPathSchema,` after `findings`. Leave `round` as it is — it is render-only and stays required.

- [x] **Step 5: Add the fix-dispatch formatter**

In `src/service/sdd_prompt.ts`, after `FormatFixFollowup` (line 247), add:

```ts
export type FormatFixDispatchInput = FormatFixFollowupInput & {
  readonly planPath: string;
  readonly task: number;
};

// A fresh fixer gets the same instructions as a same-agent fix continuation,
// preceded by the identity a continuation gets from provider context. Pinning
// the shared tail keeps the two prompts from drifting apart.
//
export function FormatFixDispatch(input: FormatFixDispatchInput): string {
  const { planPath, task, ...continuation } = input;
  return [
    `You are a fixer for task ${task} of plan ${planPath}.`,
    "You are a fresh agent: read the brief and the findings before changing anything.",
    "",
    FormatFixFollowup(continuation),
  ].join("\n");
}
```

- [x] **Step 6: Fix the existing followup call sites that now fail validation**

`FixFollowupSchema` and `ReReviewFollowupSchema` now require `report`. Search the test suite and add a `report` field to every literal that parses them:

```bash
cd projects/xagent && grep -rn 'kind: "fix"\|kind: "re-review"' tests/ src/
```

Update each to include a `report` path. `sdd_manager.ts` does not read `input.report` yet — that lands in Task 5 — so no source change is needed here.

- [x] **Step 7: Run the tests**

```bash
cd projects/xagent && npm run build && node --test dist/tests/mcp.test.js dist/tests/sdd_prompt.test.js
```

Expected: PASS.

- [x] **Step 8: Run the full suite**

```bash
cd projects/xagent && npm test
```

Expected: PASS.

- [x] **Step 9: Commit**

```bash
git add projects/xagent/src/service/tool_schemas.ts projects/xagent/src/service/sdd_prompt.ts projects/xagent/tests/mcp.test.ts projects/xagent/tests/sdd_prompt.test.ts
git commit -m "feat(xagent): add v2 start-role schemas and the fix-dispatch formatter (xsvc-11, xsvc-12)"
```

---

### Task 4: Delete report binding, the artifact cache's report path, and the SDD await/close facade

**Satisfies:** xsvc-4, xsvc-5

**Files:**
- Modify: `projects/xagent/src/service/sdd_manager.ts`
- Modify: `projects/xagent/src/service/mcp.ts:19-21, 175-184, 220-236, 253-269, 304-333`
- Modify: `projects/xagent/src/service/tool_schemas.ts:202-219, 292-293`
- Test: `projects/xagent/tests/sdd_manager.test.ts`
- Test: `projects/xagent/tests/mcp.test.ts`
- Test: `projects/xagent/tests/mcp_await.test.ts`

**Interfaces:**
- Consumes: `turn.submitted` from Task 1 (this task removes the ledger copy of the report because the event log already holds it).
- Produces: an `SddManager` type reduced to exactly `Start`, `Followup`, and `ListGeneric`. Tasks 5, 6, and 8 build on that reduced surface.

**Why this is safe before the cutover:** `PersistReportBeforeReturn` wrote `report_text` into the turn row *after* the supervisor had already published the report in a `turn.completed` event. Deleting it removes a duplicate, not the record. With report binding gone, the `sdd_turn_in_flight` guard on `xagent_message` (which existed only to protect that binding) and the `conversationalAgents` classification set (which existed only to suppress it) have nothing left to protect and go with it.

- [x] **Step 1: Write the failing tests**

In `projects/xagent/tests/sdd_manager.test.ts`, delete every test that asserts on report persistence, session closure, conversational classification, or the `sdd_turn_in_flight` / `sdd_followup_required` errors. Then add:

```ts
test("SddManager exposes only Start, Followup, and ListGeneric", () => {
  const manager = CreateSddManager(CreateDeps());     // existing helper in this file
  assert.deepEqual(Object.keys(manager).sort(), ["Followup", "ListGeneric", "Start"]);
});

test("messaging an SDD run submits like any run with no ledger write", async () => {
  const recorder = CreateOrderRecorder();
  const store = CreateFakeStore(recorder);
  const runManager = CreateFakeRunManager(recorder);
  const manager = CreateSddManager({ ...CreateDeps(), store, runManager });
  await SeedImplementer(manager, store, runManager);
  await runManager.messageRun({ run_id: x_AgentId, text: "which marketplace source type?" });
  assert.equal(store.completed.length, 0);
  assert.equal(store.closed.length, 0);
  assert.ok(!recorder.Names().includes("store.MarkCompleted"));
});
```

In `projects/xagent/tests/mcp.test.ts`, add:

```ts
test("the SDD await and close facade tools are not registered", async () => {
  const service = await startMcpService();
  try {
    const listed = await service.client.listTools();
    const names = listed.tools.map((tool) => tool.name).sort();
    assert.deepEqual(names, [
      "xagent_await",
      "xagent_close",
      "xagent_inspect",
      "xagent_interrupt",
      "xagent_list",
      "xagent_message",
      "xagent_sdd_followup",
      "xagent_sdd_start",
      "xagent_start_non_sdd",
    ]);
    await assert.rejects(() => service.client.callTool({ name: "xagent_sdd_await", arguments: {} }));
    await assert.rejects(() => service.client.callTool({ name: "xagent_sdd_close", arguments: {} }));
  } finally {
    await service.close();
  }
});
```

In `projects/xagent/tests/mcp_await.test.ts`, add:

```ts
test("awaiting an SDD run delivers report text from the event log with no ledger write", async () => {
  const service = await startMcpService();
  try {
    const started = await service.startSddImplementer();      // existing helper
    const result = await service.await(started.agent_id, started.sequence, 30);
    assert.equal(result.event, "turn.completed");
    assert.equal(typeof (result as { report?: { text: string } }).report?.text, "string");
    assert.equal(service.ledgerWriteCount(), 1);              // the dispatch insert only
  } finally {
    await service.close();
  }
});
```

If `startSddImplementer` or `ledgerWriteCount` do not exist in `tests/support/mcp_service.ts`, add them there: `ledgerWriteCount` counts rows in the ledger table.

- [x] **Step 2: Run to verify failure**

```bash
cd projects/xagent && npm run build && node --test dist/tests/sdd_manager.test.js dist/tests/mcp.test.js dist/tests/mcp_await.test.js
```

Expected: FAIL — `Object.keys(manager)` still contains `Await`, `Close`, `MessageGeneric`, `AwaitGeneric`, `CloseGeneric`; the tool list still contains the two facade tools.

- [x] **Step 3: Delete the manager machinery**

In `src/service/sdd_manager.ts` delete, by name:

- `PersistReportBeforeReturn` and `HasDeliveredReport`
- `CloseAfterProvider`
- the `Await` and `Close` functions
- the `AwaitGeneric`, `CloseGeneric`, and `MessageGeneric` members of the returned object
- the `conversationalAgents` set and every `conversationalAgents.add/delete` call
- the `FollowupRequired` helper
- the `XagentSddAwaitResult` and `XagentSddCloseResult` types
- the `Await`, `Close`, `MessageGeneric`, `AwaitGeneric`, `CloseGeneric` members of the `SddManager` type
- the now-unused imports `XagentSddAwaitInput`, `XagentSddCloseInput`, `XagentAwaitInput`, `XagentCloseInput`, `XagentMessageInput`, `AwaitRunResult`, `CloseRunResult`, `MessageRunResult`
- the `awaitRun`, `closeRun`, and `messageRun` members of `SddRunManagerPort` (nothing calls them through the SDD manager anymore)

The `SddManager` type becomes:

```ts
export type SddManager = {
  Start(input: XagentSddStartInput): Promise<XagentSddStartResult>;
  Followup(input: XagentSddFollowupInput): Promise<XagentSddFollowupResult>;
  ListGeneric(input: XagentListInput): Promise<ListRunsResult>;
};
```

In `Start`'s success path, delete the `conversationalAgents.delete(agentId);` line but keep `store.MarkRunning(agentId, 1, resumeSequence);` — it is removed in Task 6.

- [x] **Step 4: Unregister the facade tools and route the generics directly**

In `src/service/mcp.ts`:

- Delete the `XagentSddAwaitInputSchema` and `XagentSddCloseInputSchema` imports.
- Delete both `server.registerTool("xagent_sdd_await", …)` and `server.registerTool("xagent_sdd_close", …)` blocks (lines 304-333).
- In `xagent_await`, replace the body with `return runManager.awaitRun(input, extra.signal);` and delete the `if (sddManager !== undefined)` branch.
- In `xagent_message`, replace the body with `return runManager.messageRun(input);` and delete the branch.
- In `xagent_close`, replace the body with `return runManager.closeRun(input);` and delete the branch.
- Leave `xagent_list`'s `sddManager.ListGeneric(input)` branch exactly as it is — `xagent_list` remains the only SDD-aware generic tool.

Update `xagent_start_non_sdd`'s description: replace "reserves the ledger row" with "records the dispatch in the SDD ledger".

- [x] **Step 5: Delete the facade input schemas**

In `src/service/tool_schemas.ts` delete `XagentSddAwaitInputSchema`, `XagentSddCloseInputSchema`, and the `XagentSddAwaitInput` / `XagentSddCloseInput` type exports.

- [x] **Step 6: Run the tests**

```bash
cd projects/xagent && npm run build && node --test dist/tests/sdd_manager.test.js dist/tests/mcp.test.js dist/tests/mcp_await.test.js
```

Expected: PASS.

- [x] **Step 7: Run the full suite**

```bash
cd projects/xagent && npm test
```

Expected: PASS.

- [x] **Step 8: Commit**

```bash
git add projects/xagent/src/service/sdd_manager.ts projects/xagent/src/service/mcp.ts projects/xagent/src/service/tool_schemas.ts projects/xagent/tests/
git commit -m "refactor(xagent): delete SDD report binding and the sdd await/close facade (xsvc-4, xsvc-5)"
```

---

### Task 5: Demote `xagent_sdd_followup` to a render-and-submit convenience

**Satisfies:** xsvc-12

**Carry-forward from Task 4 — one of two orphaned `closed_at` readers.** Task 4
deleted `CloseAfterProvider`, the only writer of `sdd_sessions.closed_at`. Two
readers outlived it. This task owns the first: `Followup`'s
`sdd_session_closed` guard (`sdd_manager.ts:336-343`) is now unreachable in
production and is kept green only because a test writes `closed_at` directly
into the fake store. Delete the guard **and** that test; a guard that can only
fire in a fake is worse than no guard, because it reads as coverage. The
deleted-by-name checklist already assigns `sdd_session_closed` here — this note
records *why* it became urgent. The second reader is `ListGeneric`'s `closed`
field, owned by Task 8b. Found in the Task 4 review.

**Files:**
- Modify: `projects/xagent/src/service/sdd_manager.ts` (`Followup`, `SddManagerDeps`, `RoleAllowsFollowup`)
- Test: `projects/xagent/tests/sdd_manager.test.ts`

**Interfaces:**
- Consumes: `SddAgentStore` / `SddAgentRecord` from Task 2; the `report` field on both followup schemas from Task 3.
- Produces: `XagentSddFollowupResult` reduced to `{ readonly agent_id: string; readonly sequence: number }`, and the structured error code `sdd_agent_not_live` whose `details` are `{ agent_id, role, plan_path, task, recovery: { tool: "xagent_sdd_start", role: "fixer" | "re-reviewer" } }`. Task 9 asserts on these.

**Critical:** `SddManagerDeps.store` changes type from `SddStore` to `SddAgentStore`. Task 2 made the v1 store satisfy that port, so `service_main.ts` keeps compiling unchanged and the live service keeps running on the v1 file. `Start` still calls `store.MarkRunning`, which is *not* on the port — so temporarily widen the dep to `SddAgentStore & Pick<SddStore, "MarkRunning" | "ReserveInitial" | "GetSession" | "IsSddAgent">` and narrow it to plain `SddAgentStore` in Task 6 when `Start` stops calling those.

- [ ] **Step 1: Write the failing tests**

Replace the existing `Followup` tests in `projects/xagent/tests/sdd_manager.test.ts` with:

```ts
test("a fix followup renders and submits with zero ledger writes", async () => {
  const recorder = CreateOrderRecorder();
  const store = CreateFakeAgentStore(recorder, {
    agent_id: x_AgentId,
    plan_path: x_PlanPath,
    task: 3,
    role: "implementer",
    brief_path: x_BriefPath,
    brief_text: x_BriefText,
    cwd: x_CanonicalCwd,
    dispatched_at: "2026-07-28T10:00:00.000Z",
  });
  const runManager = CreateFakeRunManager(recorder);
  const formatted: FormatFixDispatchInput[] = [];
  const manager = CreateSddManager({
    ...CreateDeps(), store, runManager,
    formatFix: (input) => { formatted.push(input as FormatFixDispatchInput); return "FIX TEXT"; },
  });

  const result = await manager.Followup({
    kind: "fix",
    agent_id: x_AgentId,
    round: 2,
    findings: "/tmp/sdd/task-3-findings.md",
    findings_text: "one finding",
    tests: ["npm test"],
    report: "/tmp/sdd/task-3-report.md",
  });

  assert.deepEqual(Object.keys(result).sort(), ["agent_id", "sequence"]);
  assert.equal(result.agent_id, x_AgentId);
  assert.equal(formatted[0]!.briefPath, x_BriefPath);
  assert.equal(formatted[0]!.reportPath, "/tmp/sdd/task-3-report.md");
  assert.equal(formatted[0]!.round, 2);
  assert.equal(store.inserted.length, 0);
  assert.ok(recorder.Names().every((name) => !name.startsWith("store.Insert")));
});

test("an unknown agent id is rejected before anything is submitted", async () => {
  const recorder = CreateOrderRecorder();
  const runManager = CreateFakeRunManager(recorder);
  const manager = CreateSddManager({
    ...CreateDeps(), store: CreateFakeAgentStore(recorder, undefined), runManager,
  });
  await assert.rejects(
    () => manager.Followup({
      kind: "fix", agent_id: x_AgentId, round: 1,
      findings: "/tmp/f.md", findings_text: "x", tests: ["npm test"], report: "/tmp/r.md",
    }),
    (error: unknown) => {
      assert.equal(structuredErrorFromUnknown(error).error, "unknown_sdd_agent");
      return true;
    },
  );
  assert.equal(runManager.submitted.length, 0);
});

test("a dead agent gets sdd_agent_not_live naming the fresh-agent recovery", async () => {
  const recorder = CreateOrderRecorder();
  const store = CreateFakeAgentStore(recorder, {
    agent_id: x_AgentId, plan_path: x_PlanPath, task: 3, role: "implementer",
    brief_path: x_BriefPath, brief_text: x_BriefText, cwd: x_CanonicalCwd,
    dispatched_at: "2026-07-28T10:00:00.000Z",
  });
  const runManager = CreateFakeRunManager(recorder, { live: false });
  const manager = CreateSddManager({ ...CreateDeps(), store, runManager });
  await assert.rejects(
    () => manager.Followup({
      kind: "fix", agent_id: x_AgentId, round: 1,
      findings: "/tmp/f.md", findings_text: "x", tests: ["npm test"], report: "/tmp/r.md",
    }),
    (error: unknown) => {
      const structured = structuredErrorFromUnknown(error);
      assert.equal(structured.error, "sdd_agent_not_live");
      assert.deepEqual(structured.details, {
        agent_id: x_AgentId,
        role: "implementer",
        plan_path: x_PlanPath,
        task: 3,
        recovery: { tool: "xagent_sdd_start", role: "fixer" },
      });
      return true;
    },
  );
  assert.equal(runManager.submitted.length, 0);
});

test("kind must match the immutable start role", async () => {
  for (const [role, kind, allowed] of [
    ["implementer", "fix", true], ["fixer", "fix", true],
    ["reviewer", "re-review", true], ["re-reviewer", "re-review", true],
    ["implementer", "re-review", false], ["reviewer", "fix", false],
    ["fixer", "re-review", false], ["re-reviewer", "fix", false],
  ] as const) {
    const recorder = CreateOrderRecorder();
    const store = CreateFakeAgentStore(recorder, {
      agent_id: x_AgentId, plan_path: x_PlanPath, task: 3, role,
      brief_path: x_BriefPath, brief_text: x_BriefText, cwd: x_CanonicalCwd,
      dispatched_at: "2026-07-28T10:00:00.000Z",
    });
    const manager = CreateSddManager({
      ...CreateDeps(), store, runManager: CreateFakeRunManager(recorder),
    });
    const input = kind === "fix"
      ? { kind, agent_id: x_AgentId, round: 1, findings: "/tmp/f.md",
          findings_text: "x", tests: ["npm test"], report: "/tmp/r.md" } as const
      : { kind, agent_id: x_AgentId, round: 1, findings: "/tmp/f.md",
          report: "/tmp/r.md", base: "main", head: "HEAD" } as const;
    if (allowed) {
      await manager.Followup(input);
    } else {
      await assert.rejects(() => manager.Followup(input), (error: unknown) => {
        assert.equal(structuredErrorFromUnknown(error).error, "sdd_followup_role_mismatch");
        return true;
      });
    }
  }
});

test("double-calling a followup leaves the ledger untouched", async () => {
  const recorder = CreateOrderRecorder();
  const store = CreateFakeAgentStore(recorder, {
    agent_id: x_AgentId, plan_path: x_PlanPath, task: 3, role: "reviewer",
    brief_path: x_BriefPath, brief_text: x_BriefText, cwd: x_CanonicalCwd,
    dispatched_at: "2026-07-28T10:00:00.000Z",
  });
  const manager = CreateSddManager({
    ...CreateDeps(), store, runManager: CreateFakeRunManager(recorder),
  });
  const input = {
    kind: "re-review" as const, agent_id: x_AgentId, round: 1,
    findings: "/tmp/f.md", report: "/tmp/r.md", base: "main", head: "HEAD",
  };
  await manager.Followup(input);
  await manager.Followup(input);
  assert.equal(store.inserted.length, 0);
});
```

Add `CreateFakeAgentStore(recorder, record: SddAgentRecord | undefined)` to the file's helper section: it returns an `SddAgentStore` whose `Get` returns `record` for `x_AgentId`, `IsSddAgent` returns `record !== undefined`, `ListAll` returns `record === undefined ? [] : [record]`, and whose `Insert` pushes to a public `inserted` array while recording `"store.Insert"` on the recorder. Give `CreateFakeRunManager` a `{ live?: boolean }` option controlling `has()` and `inspect()`.

- [ ] **Step 2: Run to verify failure**

```bash
cd projects/xagent && npm run build && node --test dist/tests/sdd_manager.test.js
```

Expected: FAIL — `Followup` still returns `turn_number`, still calls `PrepareFollowup`, and still throws `sdd_session_terminal`.

- [ ] **Step 3: Rewrite `Followup`**

In `src/service/sdd_manager.ts`:

Change the result type:

```ts
export type XagentSddFollowupResult = {
  readonly agent_id: string;
  readonly sequence: number;
};
```

Replace `RoleAllowsFollowup`:

```ts
function RoleAllowsFollowup(role: SddStartRole, kind: "fix" | "re-review"): boolean
{
  if (kind === "fix")
  {
    return role === "implementer" || role === "fixer";
  }
  return role === "reviewer" || role === "re-reviewer";
}

function RecoveryRoleFor(role: SddStartRole): "fixer" | "re-reviewer"
{
  return role === "implementer" || role === "fixer" ? "fixer" : "re-reviewer";
}
```

Replace the whole `Followup` body:

```ts
  async function Followup(input: XagentSddFollowupInput): Promise<XagentSddFollowupResult>
  {
    const agent = store.Get(input.agent_id);
    if (agent === undefined)
    {
      throw StructuredFailure({
        error: "unknown_sdd_agent",
        message: `Unknown SDD agent: ${input.agent_id}`,
        details: { agent_id: input.agent_id },
      });
    }
    if (!RoleAllowsFollowup(agent.role, input.kind))
    {
      throw StructuredFailure({
        error: "sdd_followup_role_mismatch",
        message: `Follow-up kind ${input.kind} is not valid for role ${agent.role}.`,
        details: { agent_id: input.agent_id, role: agent.role, kind: input.kind },
      });
    }
    // Liveness is a run-manager fact, never a ledger fact: v1's
    // sdd_session_terminal asked the ledger whether the agent was usable and
    // got a stale answer. The dead end is now a signpost at the recovery path.
    //
    const inspection = runManager.has(input.agent_id)
      ? runManager.inspect(input.agent_id)
      : undefined;
    if (inspection === undefined)
    {
      throw StructuredFailure({
        error: "sdd_agent_not_live",
        message:
          `SDD agent ${input.agent_id} is not live; dispatch a fresh `
          + `${RecoveryRoleFor(agent.role)} for the same plan and task.`,
        details: {
          agent_id: input.agent_id,
          role: agent.role,
          plan_path: agent.plan_path,
          task: agent.task,
          recovery: { tool: "xagent_sdd_start", role: RecoveryRoleFor(agent.role) },
        },
      });
    }

    let promptText = "";
    if (input.kind === "fix")
    {
      await ReadRequiredText(read, input.findings, "SDD findings");
      promptText = formatFix({
        round: input.round,
        briefPath: agent.brief_path,
        findingsPath: input.findings,
        findingsText: input.findings_text,
        tests: input.tests,
        reportPath: input.report,
      });
    }
    else
    {
      if (agent.task === null)
      {
        throw StructuredFailure({
          error: "sdd_followup_role_mismatch",
          message: "Re-review requires a task-scoped reviewer agent.",
          details: { agent_id: input.agent_id, role: agent.role },
        });
      }
      await ReadRequiredText(read, input.findings, "SDD findings");
      const rendered = await renderPrompt({
        role: "re-review",
        repoRoot: deps.repoRoot,
        cwd: agent.cwd,
        plan: agent.plan_path,
        task: agent.task,
        round: input.round,
        brief: agent.brief_path,
        findings: input.findings,
        report: input.report,
        base: input.base,
        head: input.head,
        ...(input.diff === undefined ? {} : { diff: input.diff }),
      });
      promptText = rendered.prompt.text;
    }

    const sequence = inspection.sequence;
    await runManager.submit(
      input.agent_id,
      AppendControllerNote(promptText, input.note),
    );
    return { agent_id: input.agent_id, sequence };
  }
```

Delete the `SessionArtifacts` type, the `artifactsByAgent` map, and the `PrepareFollowupInput` / `SddStoreError` imports if nothing else uses them.

- [ ] **Step 4: Widen the store dep**

In `SddManagerDeps`, change:

```ts
  readonly store: SddAgentStore & Pick<SddStore, "MarkRunning" | "ReserveInitial" | "GetSession">;
```

with the comment:

```ts
  // TRANSITIONAL: Start still writes v1 turn rows until the Start rewrite lands.
  // This narrows to plain SddAgentStore in that task.
```

- [ ] **Step 5: Run the tests**

```bash
cd projects/xagent && npm run build && node --test dist/tests/sdd_manager.test.js
```

Expected: PASS.

- [ ] **Step 6: Run the full suite**

```bash
cd projects/xagent && npm test
```

Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add projects/xagent/src/service/sdd_manager.ts projects/xagent/tests/sdd_manager.test.ts
git commit -m "refactor(xagent): demote xagent_sdd_followup to render-and-submit (xsvc-12)"
```

---

### Task 6: `xagent_sdd_start` four-way role union and the v2 `Start`

**Satisfies:** xsvc-6, xsvc-8, xsvc-10, xsvc-11

**Files:**
- Modify: `projects/xagent/src/service/tool_schemas.ts`
- Modify: `projects/xagent/src/service/sdd_manager.ts`
- Test: `projects/xagent/tests/sdd_manager.test.ts`
- Test: `projects/xagent/tests/mcp.test.ts`
- Test: `projects/xagent/tests/sdd_prompt.test.ts`

**Interfaces:**
- Consumes: `SddAgentStore.Insert` (Task 2), the v2 role schemas and `FormatFixDispatch` (Task 3), the reduced `SddManager` (Task 4), the `SddAgentStore`-typed dep (Task 5).
- Produces: `XagentSddStartResult` reduced to `{ readonly agent_id: string; readonly sequence: number; readonly prompt_path: string; readonly renderer_path: string }`. Tasks 8 and 9 assert on it.

**Restart boundary:** the union swap and the manager rewrite are in this one task on purpose. Do not split them, and do not restart the live service in the middle of this task.

**Hard no-restart window, Task 6 → Task 8a.** Once `Start` calls
`store.Insert`, but before Task 8a swaps `service_main.ts` to
`CreateSddAgentStore`, the live service would route every dispatch through
the *v1* transitional adapter. That adapter writes a `sdd_turns` row with
`status = "prepared"` and the `SddAgentStore` port has no method that can
resolve it — so every dispatch in that window permanently leaks an
unresolved turn, and the next `xagent_sdd_followup` against it fails with
`sdd_turn_unresolved`. The controller hit that error by hand twice while
executing this plan; here it would be unrecoverable without a restart.
Found in the Task 2 review. Do not restart the service between Task 6 and
Task 8a for any reason.

- [ ] **Step 1: Write the failing tests**

Add to `projects/xagent/tests/sdd_manager.test.ts`:

```ts
test("start canonicalizes cwd, inserts the row before creating the run, then renders and submits", async () => {
  const recorder = CreateOrderRecorder();
  const store = CreateFakeAgentStore(recorder, undefined);
  const runManager = CreateFakeRunManager(recorder);
  const manager = CreateSddManager({ ...CreateDeps(), store, runManager });

  const result = await manager.Start({
    role: "implementer", cwd: x_Cwd, plan: x_PlanPath,
    agent: "grok-4.5", harness: "cursor", effort: "high",
    task: 3, name: "Ledger v2 store", brief: x_BriefPath, report: x_ReportPath,
  });

  assert.deepEqual(recorder.Names().slice(0, 5), [
    "canonicalizeCwd", "readFile", "renderPrompt", "store.Insert", "runManager.create",
  ]);
  assert.deepEqual(recorder.Names().slice(5, 7), ["runManager.start", "runManager.submit"]);
  assert.deepEqual(store.inserted[0], {
    agentId: result.agent_id,
    planPath: x_PlanPath,
    task: 3,
    role: "implementer",
    briefPath: x_BriefPath,
    briefText: x_BriefText,
    cwd: x_CanonicalCwd,
  });
  assert.deepEqual(Object.keys(result).sort(), [
    "agent_id", "prompt_path", "renderer_path", "sequence",
  ]);
});

test("an invalid cwd creates no ledger row and no run", async () => {
  const recorder = CreateOrderRecorder();
  const store = CreateFakeAgentStore(recorder, undefined);
  const runManager = CreateFakeRunManager(recorder);
  const manager = CreateSddManager({
    ...CreateDeps(), store, runManager,
    canonicalizeCwd: async () => {
      throw new ToolValidationError({
        error: "invalid_working_directory", message: "not a directory",
      });
    },
  });
  await assert.rejects(() => manager.Start({
    role: "implementer", cwd: "relative/path", plan: x_PlanPath,
    agent: "grok-4.5", harness: "cursor", effort: "high",
    task: 3, name: "x", brief: x_BriefPath, report: x_ReportPath,
  }));
  assert.equal(store.inserted.length, 0);
  assert.equal(runManager.created.length, 0);
});

test("a failure after the insert leaves the row untouched as a tombstone", async () => {
  const recorder = CreateOrderRecorder();
  const store = CreateFakeAgentStore(recorder, undefined);
  const runManager = CreateFakeRunManager(recorder, { failStart: true });
  const manager = CreateSddManager({ ...CreateDeps(), store, runManager });
  await assert.rejects(() => manager.Start({
    role: "implementer", cwd: x_Cwd, plan: x_PlanPath,
    agent: "grok-4.5", harness: "cursor", effort: "high",
    task: 3, name: "x", brief: x_BriefPath, report: x_ReportPath,
  }));
  assert.equal(store.inserted.length, 1);
  assert.ok(recorder.Names().every((name) => name !== "store.MarkFailed"));
});

test("reviewer template selection follows task presence", async () => {
  const rendered: RenderSddPromptInput[] = [];
  const recorder = CreateOrderRecorder();
  const manager = CreateSddManager({
    ...CreateDeps(),
    store: CreateFakeAgentStore(recorder, undefined),
    runManager: CreateFakeRunManager(recorder),
    renderPrompt: async (input) => { rendered.push(input); return FakeRendered(); },
  });

  await manager.Start({
    role: "reviewer", cwd: x_Cwd, plan: x_PlanPath,
    agent: "opus", harness: "claude_code", effort: "high",
    task: 3, brief: x_BriefPath, report: x_ReportPath, base: "main", head: "HEAD",
  });
  assert.equal(rendered[0]!.role, "task-reviewer");

  await manager.Start({
    role: "reviewer", cwd: x_Cwd, plan: x_PlanPath,
    agent: "opus", harness: "claude_code", effort: "high",
    brief: x_BriefPath, base: "main", head: "HEAD",
    description: "Branch adds the v2 ledger.",
  });
  assert.equal(rendered[1]!.role, "code-reviewer");
});

test("a fixer renders the fix template and never an assignment name", async () => {
  const recorder = CreateOrderRecorder();
  const store = CreateFakeAgentStore(recorder, undefined);
  const runManager = CreateFakeRunManager(recorder);
  const manager = CreateSddManager({ ...CreateDeps(), store, runManager });
  await manager.Start({
    role: "fixer", cwd: x_Cwd, plan: x_PlanPath,
    agent: "grok-4.5", harness: "cursor", effort: "high",
    task: 3, brief: x_BriefPath, findings: "/tmp/f.md",
    findings_text: "one finding", tests: ["npm test"], report: x_ReportPath, round: 2,
  });
  const submitted = runManager.submitted[0]!.text;
  assert.match(submitted, /^You are a fixer for task 3 of plan /);
  assert.match(submitted, /Fix round 2\./);
  assert.ok(!submitted.includes("Fix Round 2\""));
  assert.equal(store.inserted[0]!.role, "fixer");
});

test("a re-reviewer reuses the re-review renderer role", async () => {
  const rendered: RenderSddPromptInput[] = [];
  const recorder = CreateOrderRecorder();
  const manager = CreateSddManager({
    ...CreateDeps(),
    store: CreateFakeAgentStore(recorder, undefined),
    runManager: CreateFakeRunManager(recorder),
    renderPrompt: async (input) => { rendered.push(input); return FakeRendered(); },
  });
  await manager.Start({
    role: "re-reviewer", cwd: x_Cwd, plan: x_PlanPath,
    agent: "opus", harness: "claude_code", effort: "high",
    task: 3, brief: x_BriefPath, findings: "/tmp/f.md", report: x_ReportPath,
    base: "main", head: "HEAD", round: 2,
  });
  assert.equal(rendered[0]!.role, "re-review");
  assert.equal((rendered[0] as { round: number }).round, 2);
});
```

Give `CreateFakeRunManager` a `{ failStart?: boolean }` option and public `created` / `submitted` arrays. `FakeRendered()` returns a `RenderedSddPrompt` with `prompt.text = x_PromptText` and `metadata.promptPath = x_PromptPath`.

Add to `projects/xagent/tests/mcp.test.ts`:

```ts
test("xagent_sdd_start advertises the four-way role union", async () => {
  const service = await startMcpService();
  try {
    const listed = await service.client.listTools();
    const tool = listed.tools.find((entry) => entry.name === "xagent_sdd_start");
    assert.ok(tool);
    // Guard the negatives against passing vacuously: before Task 0 the
    // advertised schema was `{}`, where "does not mention task-reviewer" is
    // true for the wrong reason.
    assert.ok(Object.keys(tool.inputSchema.properties ?? {}).length > 0);
    assert.equal(JSON.stringify(tool.inputSchema).includes("task-reviewer"), false);
    assert.equal(JSON.stringify(tool.inputSchema).includes("code-reviewer"), false);
    assert.ok(JSON.stringify(tool.inputSchema).includes("re-reviewer"));
  } finally {
    await service.close();
  }
});
```

- [ ] **Step 2: Run to verify failure**

```bash
cd projects/xagent && npm run build && node --test dist/tests/sdd_manager.test.js dist/tests/mcp.test.js
```

Expected: FAIL — `manager.Start` still returns `brief_path`, still calls `ReserveInitial`/`MarkFailed`, and rejects role `fixer`.

- [ ] **Step 3: Swap the start union**

In `src/service/tool_schemas.ts`:

- Delete `TaskReviewerStartSchema` and `CodeReviewerStartSchema`.
- Delete the old `XagentSddStartInputSchema` definition.
- Rename `XagentSddStartInputSchemaV2` to `XagentSddStartInputSchema`.
- `XagentSddStartInput` now infers from the v2 union with no further change.

- [ ] **Step 4: Rewrite `Start`**

In `src/service/sdd_manager.ts`:

```ts
export type XagentSddStartResult = {
  readonly agent_id: string;
  readonly sequence: number;
  readonly prompt_path: string;
  readonly renderer_path: string;
};
```

Replace `BriefPathForStart`, `ReportPathForStart`, and `BuildRenderInput` with:

```ts
function TaskForStart(input: XagentSddStartInput): number | undefined
{
  if (input.role === "reviewer")
  {
    return input.task;
  }
  return input.task;
}

function BuildRenderInput(
  input: XagentSddStartInput,
  repoRoot: string,
  cwd: string,
): RenderSddPromptInput | undefined
{
  if (input.role === "implementer")
  {
    return {
      role: "implementer", repoRoot, cwd,
      plan: input.plan, task: input.task, name: input.name, brief: input.brief,
      report: input.report,
      ...(input.context === undefined ? {} : { context: input.context }),
    };
  }
  if (input.role === "reviewer")
  {
    // Task presence selects the template: v1's task-reviewer / code-reviewer
    // split collapses into one role here and re-expands at the renderer.
    //
    if (input.task === undefined)
    {
      return {
        role: "code-reviewer", repoRoot, cwd,
        plan: input.plan, reviewBrief: input.brief,
        description: input.description!, base: input.base, head: input.head,
      };
    }
    return {
      role: "task-reviewer", repoRoot, cwd,
      plan: input.plan, task: input.task, brief: input.brief,
      report: input.report!, base: input.base, head: input.head,
      ...(input.constraints === undefined ? {} : { constraints: input.constraints }),
      ...(input.diff === undefined ? {} : { diff: input.diff }),
    };
  }
  if (input.role === "re-reviewer")
  {
    return {
      role: "re-review", repoRoot, cwd,
      plan: input.plan, task: input.task, round: input.round,
      brief: input.brief, findings: input.findings, report: input.report,
      base: input.base, head: input.head,
      ...(input.diff === undefined ? {} : { diff: input.diff }),
    };
  }
  // `fixer` has no dispatch-prompt renderer role; its text is formatted in
  // TypeScript so it stays byte-identical to the same-agent continuation.
  //
  return undefined;
}
```

Replace `Start`:

```ts
  async function Start(input: XagentSddStartInput): Promise<XagentSddStartResult>
  {
    // xsvc-6: canonicalize and validate before anything is written anywhere.
    //
    const cwd = await canonicalizeCwd(input.cwd);
    const briefText = await ReadRequiredText(read, input.brief, "SDD brief");

    let promptText = "";
    let promptPath = "";
    let rendererPath = "";
    const renderInput = BuildRenderInput(input, deps.repoRoot, cwd);
    if (renderInput === undefined)
    {
      const fixer = input as Extract<XagentSddStartInput, { role: "fixer" }>;
      await ReadRequiredText(read, fixer.findings, "SDD findings");
      promptText = formatFixDispatch({
        planPath: fixer.plan,
        task: fixer.task,
        round: fixer.round,
        briefPath: fixer.brief,
        findingsPath: fixer.findings,
        findingsText: fixer.findings_text,
        tests: fixer.tests,
        reportPath: fixer.report,
      });
    }
    else
    {
      const rendered = await renderPrompt(renderInput);
      promptText = rendered.prompt.text;
      promptPath = rendered.metadata.promptPath;
      rendererPath = rendered.metadata.rendererPath;
    }

    const agentId = runManager.allocateRunId();

    // The row is written before the run exists. If anything after this throws,
    // the row stands as an immutable dispatch-failure tombstone: v1's
    // MarkFailed has no v2 analogue, because there is no status to write.
    //
    try
    {
      store.Insert({
        agentId,
        planPath: input.plan,
        ...(TaskForStart(input) === undefined ? {} : { task: TaskForStart(input)! }),
        role: input.role,
        briefPath: input.brief,
        briefText,
        cwd,
      });
    }
    catch (error)
    {
      if (error instanceof ToolValidationError)
      {
        throw error;
      }
      throw PersistenceFailed("Unable to record the SDD dispatch.", {
        cause: error instanceof Error ? error.message : String(error),
      });
    }

    await runManager.create({
      runId: agentId,
      harness: input.harness,
      mode: "subagent",
      cwd,
      model: input.agent,
      thinkingLevel: input.effort,
      ...(input.policy === undefined ? {} : { policy: input.policy }),
    });
    await runManager.start(agentId);
    const inspection = runManager.inspect(agentId);
    if (inspection === undefined)
    {
      throw new Error(`SDD run disappeared after start: ${agentId}`);
    }
    await runManager.submit(agentId, AppendControllerNote(promptText, input.note));
    return {
      agent_id: agentId,
      sequence: inspection.sequence,
      prompt_path: promptPath,
      renderer_path: rendererPath,
    };
  }
```

Add `formatFixDispatch` to `SddManagerDeps` (`readonly formatFixDispatch?: (input: FormatFixDispatchInput) => string;`) and default it in `CreateSddManager` to `FormatFixDispatch`. Import `FormatFixDispatch` and `FormatFixDispatchInput` from `./sdd_prompt.js`.

Narrow the store dep back to plain `SddAgentStore` and delete the transitional `Pick<SddStore, …>` intersection and its comment. Delete the `ReserveInitialInput`, `SddRole`, and `SddStore` imports if unused.

**Note on the `catch` that used to close the run:** v1 closed the provider run on a start failure. Keep that behavior — wrap the `create`/`start`/`submit` block in `try { … } catch (error) { if (created) { await runManager.close(agentId).catch(() => {}); } throw error; }` with a `let created = false;` set after `create` resolves. Do **not** add any ledger write to that catch.

- [ ] **Step 5: Run the tests**

```bash
cd projects/xagent && npm run build && node --test dist/tests/sdd_manager.test.js dist/tests/mcp.test.js dist/tests/sdd_prompt.test.js
```

Expected: PASS.

- [ ] **Step 6: Run the full suite**

```bash
cd projects/xagent && npm test
```

Expected: PASS. Update any test still dispatching `task-reviewer` or `code-reviewer` to the v2 `reviewer` role.

- [ ] **Step 7: Commit**

```bash
git add projects/xagent/src/service/tool_schemas.ts projects/xagent/src/service/sdd_manager.ts projects/xagent/tests/
git commit -m "feat(xagent): four-way sdd_start role union and insert-only Start (xsvc-6, xsvc-8, xsvc-10, xsvc-11)"
```

---

### Task 7: Operator gate — reprovision the live ledger  
**CONTROLLER CHECKPOINT — do not dispatch. The lead runs this and records the evidence.**

**Satisfies:** xsvc-8 (operational precondition)

**Files:** none. This task changes no code and produces no commit.

**Interfaces:**
- Consumes: nothing.
- Produces: a `<log_root>/sdd.sqlite` that no longer exists, so that the first Task 8 build to reach the live service provisions schema v2 instead of tripping the gate.

**Why now:** every build up to and including Task 6 wires the **v1** store, so the live service has been safe to leave running. Task 8 is the first build that wires `CreateSddAgentStore`, whose gate refuses `user_version != 2`. Starting a Task 8 build against the existing v1 file fails the SDD manager loudly and takes SDD tooling down. Deleting the file first turns that into a clean provision. **Do not perform this step before Task 6 is committed, and do not defer it past Task 8.**

- [ ] **Step 1: Find the log root**

```bash
cd projects/xagent && node -e "import('./dist/src/service/config.js').then(async (m) => console.log((await m.loadXagentServiceConfig()).logRoot))"
```

Expected: an absolute path, e.g. `/Users/joyo/Sheaf/data/xagent`.

- [ ] **Step 2: Stop the live service through Conductor**

Stop the xagent service the same way it was started (Conductor's stop control, or `POST /exit` to the service port). Do not `kill -9`: the orderly shutdown closes owned provider process groups.

- [ ] **Step 3: Confirm it is down**

```bash
curl -sS --max-time 3 http://127.0.0.1:9005/health || echo "service is down"
```

Expected: `service is down` (or a connection error).

- [ ] **Step 4: Record what is being discarded**

```bash
LOG_ROOT=<path from Step 1>
sqlite3 "$LOG_ROOT/sdd.sqlite" "SELECT COUNT(*) FROM sdd_sessions; SELECT COUNT(*) FROM sdd_turns;"
```

Expected: two counts. These rows are being deleted deliberately; their forensic content survives in the run directories they point at. Note the numbers in the task's completion report.

- [ ] **Step 5: Delete the v1 ledger**

```bash
LOG_ROOT=<path from Step 1>
rm -f "$LOG_ROOT/sdd.sqlite" "$LOG_ROOT/sdd.sqlite-wal" "$LOG_ROOT/sdd.sqlite-shm"
ls -la "$LOG_ROOT" | grep sdd || echo "ledger removed"
```

Expected: `ledger removed`.

**Do not delete anything else in the log root.** The `<log_root>/<agent_id>/` directories are the system of record and must survive.

- [ ] **Step 6: Leave the service down**

Do not restart yet. Task 8 wires the v2 store; restart after Task 8 is committed and its suite is green. Record in the completion report that the ledger was reprovisioned and the service is intentionally down.

---

### Task 8: Wire the v2 store, delete v1, and land `xagent_list` v2  
**SPLIT INTO TWO DISPATCHES — 8a is steps 1–4 and 6–9 (the cutover); 8b is step 5 (`xagent_list` v2). Review gate between them. See Execution guidance.**

**Satisfies:** xsvc-8, xsvc-13

**Files:**
- Modify: `projects/xagent/src/service/sdd_store.ts`
- Modify: `projects/xagent/src/service_main.ts:11-15, 41-46, 60-66, 148-155`
- Modify: `projects/xagent/src/service/run_manager.ts:78-103`
- Modify: `projects/xagent/src/service/sdd_manager.ts` (`ListGeneric`)
- Test: `projects/xagent/tests/sdd_store.test.ts`
- Test: `projects/xagent/tests/mcp.test.ts`
- Test: `projects/xagent/tests/sdd_manager.test.ts`

**Interfaces:**
- Consumes: `CreateSddAgentStore` and `SddAgentStore.ListAll` (Task 2), the reduced `SddManager` (Task 4), `XagentSddStartResult` (Task 6).
- Produces:

```ts
export type XagentSddListFields = {
  readonly role: string;
  readonly plan: string;            // basename(plan_path) without extension
  readonly task?: number;
  readonly cwd: string;
  readonly brief_path: string;
  readonly dispatched_at: string;
};

export type XagentSddTombstoneRow = {
  readonly run_id: string;
  readonly run_missing: true;
  readonly sdd: XagentSddListFields;
};

export type XagentListEntry = XagentListRow | XagentSddTombstoneRow;

export type ListRunsResult = {
  readonly runs: readonly XagentListEntry[];
};
```

**This is the first build that wires the v2 store. Task 7 must already be done.**

- [ ] **Step 1: Write the failing tests**

Add to `projects/xagent/tests/mcp.test.ts`:

```ts
test("xagent_list carries the v2 sdd identity block", async () => {
  const service = await startMcpService();
  try {
    const started = await service.startSddImplementer();
    const body = structuredToolBody(asToolCallResult(
      await service.client.callTool({ name: "xagent_list", arguments: {} }),
    ));
    const runs = body.runs as Array<Record<string, unknown>>;
    const row = runs.find((entry) => entry.run_id === started.agent_id)!;
    assert.deepEqual(Object.keys(row.sdd as object).sort(), [
      "brief_path", "cwd", "dispatched_at", "plan", "role", "task",
    ]);
    assert.equal((row.sdd as { plan: string }).plan, "2026-07-28-redesign-sdd-ledger");
    assert.equal(row.run_missing, undefined);
  } finally {
    await service.close();
  }
});

test("a ledger row with no run record is a tombstone entry", async () => {
  const service = await startMcpService();
  try {
    service.ledger().Insert({
      agentId: "xrun_20260728000000000_0000dead",
      planPath: "/tmp/plans/2026-07-28-redesign-sdd-ledger.md",
      task: 4,
      role: "fixer",
      briefPath: "/tmp/sdd/task-4-brief.md",
      briefText: "brief\n",
      cwd: "/private/tmp/worktree",
    });
    const body = structuredToolBody(asToolCallResult(
      await service.client.callTool({ name: "xagent_list", arguments: {} }),
    ));
    const runs = body.runs as Array<Record<string, unknown>>;
    const tombstone = runs.find((entry) => entry.run_id === "xrun_20260728000000000_0000dead")!;
    assert.deepEqual(Object.keys(tombstone).sort(), ["run_id", "run_missing", "sdd"]);
    assert.equal(tombstone.run_missing, true);
    assert.equal((tombstone.sdd as { role: string }).role, "fixer");
  } finally {
    await service.close();
  }
});

test("a generic run carries no sdd block and no run_missing flag", async () => {
  const service = await startMcpService();
  try {
    const started = await service.startRun("generic");
    const body = structuredToolBody(asToolCallResult(
      await service.client.callTool({ name: "xagent_list", arguments: {} }),
    ));
    const runs = body.runs as Array<Record<string, unknown>>;
    const row = runs.find((entry) => entry.run_id === started.run_id)!;
    assert.equal(row.sdd, undefined);
    assert.equal(row.run_missing, undefined);
  } finally {
    await service.close();
  }
});
```

Add `service.ledger()` to `tests/support/mcp_service.ts` returning the `SddAgentStore` the harness constructed.

Add to `projects/xagent/tests/sdd_store.test.ts`:

```ts
test("the v1 store and its schema are gone", async () => {
  const source = await readFile(
    new URL("../../src/service/sdd_store.ts", import.meta.url),
    "utf8",
  );
  for (const symbol of [
    "CreateSddStore", "ReconcileTerminalRuns", "abandonOpenTurns", "MarkRunning",
    "MarkCompleted", "MarkFailed", "MarkAbandoned", "MarkClosed", "GetOpenTurn",
    "GetLatestTurn", "GetTurnByCompletedSequence", "probeClosedSessionTurns",
    "repairClosedSessionTurns", "sdd_dispatch_log", "sdd_sessions", "sdd_turns",
  ]) {
    assert.equal(source.includes(symbol), false, `${symbol} must be deleted`);
  }
  assert.equal(/UPDATE\s+sdd/i.test(source), false);
});
```

- [ ] **Step 2: Run to verify failure**

```bash
cd projects/xagent && npm run build && node --test dist/tests/mcp.test.js dist/tests/sdd_store.test.js
```

Expected: FAIL — the `sdd` block still has `agent`/`closed`, there is no tombstone path, and the v1 symbols still exist.

- [ ] **Step 3: Wire the v2 store**

In `src/service_main.ts`:

- Change the import from `CreateSddStore` to `CreateSddAgentStore`.
- `const sddStore = CreateSddAgentStore(config.logRoot);`
- Delete the whole trailing block that builds `persistedPhases` and calls `sddStore.ReconcileTerminalRuns(persistedPhases)` (lines 148-155), and the `listRuns` import if it becomes unused. Replace with a comment:

```ts
  // No ledger reconciliation exists in v2: sdd_agents has no mutable state to
  // repair. Run-phase reconciliation above is the whole startup contract.
```

- Update the `closeRuns` comment: the ledger is closed after provider sessions purely to release the file handle, not to let a close-time write commit.

- [ ] **Step 4: Delete the v1 store**

In `src/service/sdd_store.ts` delete: `SddRole`, `SddTurnKind`, `SddTurnStatus`, `SddSessionRecord`, `SddTurnRecord`, `ReserveInitialInput`, `PrepareFollowupInput`, the `SddStore` type, `x_CurrentSchemaVersion`, `x_TerminalPhases`, `x_SchemaSql`, `MigrateSchema`, `MapSessionRow`, `MapTurnRow`, `CreateSddStore` in its entirety (including the transitional `Insert`/`Get`/`ListAll` adapter added in Task 2). Keep `SddStoreError`, `EnsureOwnerOnly*`, `OpenSddLedgerDatabase`, `GetSddDatabasePath`, the v2 types, and `CreateSddAgentStore`.

- [ ] **Step 5: Land `xagent_list` v2**

**Carry-forward from Task 4 — the second orphaned `closed_at` reader.** Since
Task 4 deleted `CloseAfterProvider`, nothing writes `sdd_sessions.closed_at`,
so `ListGeneric`'s surviving `closed: session.closed_at !== null` is hard-false
for every session — including genuinely closed ones. `xagent_list` is the
recovery tool; telling a recovering controller that a closed session is live is
a wrong answer on exactly the path this branch exists to make trustworthy. The
`XagentSddListFields` shape below already drops `closed`, which fixes it. Do
not carry the field forward "for compatibility". Found in the Task 4 review.

In `src/service/run_manager.ts` replace `XagentSddListFields` and `ListRunsResult` with the shapes in the **Interfaces** block, and add `XagentSddTombstoneRow` and `XagentListEntry`. `XagentListRow` itself is unchanged apart from the `sdd` field's new type.

In `src/service/sdd_manager.ts` replace `ListGeneric`:

```ts
    async ListGeneric(input: XagentListInput): Promise<ListRunsResult>
    {
      const listed = await runManager.listOwnedRuns(input);
      const seen = new Set<string>();
      const rows: XagentListEntry[] = listed.runs.map((run) =>
      {
        seen.add(run.run_id);
        const agent = store.Get(run.run_id);
        if (agent === undefined)
        {
          return run;
        }
        return { ...run, sdd: SddListFields(agent) };
      });
      // A ledger row with no run record is a dispatch that never became a run.
      // It is a parallel shape, not an XagentListRow with fabricated phase,
      // sequence, or liveness fields — there is no run record to read them from.
      //
      for (const agent of store.ListAll())
      {
        if (seen.has(agent.agent_id))
        {
          continue;
        }
        rows.push({
          run_id: agent.agent_id,
          run_missing: true,
          sdd: SddListFields(agent),
        });
      }
      rows.sort((left, right) => EntryOrderKey(right).localeCompare(EntryOrderKey(left)));
      return { runs: rows.slice(0, input.limit) };
    },
```

with the two helpers at module scope:

```ts
function SddListFields(agent: SddAgentRecord): XagentSddListFields
{
  return {
    role: agent.role,
    plan: DerivePlanName(agent.plan_path),
    ...(agent.task === null ? {} : { task: agent.task }),
    cwd: agent.cwd,
    brief_path: agent.brief_path,
    dispatched_at: agent.dispatched_at,
  };
}

function EntryOrderKey(entry: XagentListEntry): string
{
  return "run_missing" in entry ? entry.sdd.dispatched_at : entry.created_at;
}
```

- [ ] **Step 6: Run the tests**

```bash
cd projects/xagent && npm run build && node --test dist/tests/sdd_store.test.js dist/tests/mcp.test.js dist/tests/sdd_manager.test.js
```

Expected: PASS.

- [ ] **Step 7: Prove no ledger update statement survives**

```bash
cd projects/xagent && grep -c 'UPDATE sdd' src/service/sdd_store.ts
```

Expected: `0`.

- [ ] **Step 8: Run the full suite**

```bash
cd projects/xagent && npm test
```

Expected: PASS.

- [ ] **Step 9: Commit and restart the service**

```bash
git add projects/xagent/src/service/sdd_store.ts projects/xagent/src/service_main.ts projects/xagent/src/service/run_manager.ts projects/xagent/src/service/sdd_manager.ts projects/xagent/tests/
git commit -m "feat(xagent): wire the v2 ledger, delete the v1 store, and land xagent_list v2 (xsvc-8, xsvc-13)"
```

Restart the xagent service through Conductor now that Task 7 has cleared the ledger. Verify:

```bash
curl -sS http://127.0.0.1:9005/health
sqlite3 "$LOG_ROOT/sdd.sqlite" "PRAGMA user_version; .tables"
```

Expected: `healthy: true`; `user_version` `2`; exactly one table, `sdd_agents`.

---

### Task 9: Lifecycle and failure-injection verification

**Satisfies:** xsvc-8, xsvc-9, xsvc-12

**Files:**
- Test: `projects/xagent/tests/e2e.test.ts`
- Test: `projects/xagent/tests/supervision_e2e.test.ts`
- Test: `projects/xagent/tests/sdd_store.test.ts`

**Interfaces:**
- Consumes: everything from Tasks 1-8. Adds no production code.
- Produces: no new interfaces.

- [ ] **Step 1: Write the end-to-end lifecycle test**

Append to `projects/xagent/tests/e2e.test.ts`:

```ts
test("two agents, four submissions, two immutable rows, reports only in the log", async () => {
  const service = await startMcpService();
  try {
    const implementer = await service.startSddImplementer({ task: 4 });
    await service.awaitTurn(implementer.agent_id, implementer.sequence);

    const fix = await service.sddFollowup({
      kind: "fix",
      agent_id: implementer.agent_id,
      round: 1,
      findings: service.artifact("task-4-findings.md"),
      findings_text: "Finding 1: the gate is missing.",
      tests: ["npm test"],
      report: service.artifact("task-4-report.md"),
    });
    await service.awaitTurn(implementer.agent_id, fix.sequence);
    await service.close(implementer.agent_id);

    const fixer = await service.startSddFixer({ task: 4 });
    await service.awaitTurn(fixer.agent_id, fixer.sequence);

    const rows = service.ledger().ListAll();
    assert.equal(rows.length, 2);
    assert.deepEqual(rows.map((row) => row.role), ["implementer", "fixer"]);
    assert.deepEqual(rows.map((row) => row.task), [4, 4]);
    assert.equal(rows[0]!.plan_path, rows[1]!.plan_path);

    const implementerEvents = await service.normalizedEvents(implementer.agent_id);
    const fixerEvents = await service.normalizedEvents(fixer.agent_id);
    assert.equal(
      implementerEvents.filter((event) => event.type === "turn.submitted").length, 2,
    );
    assert.equal(
      fixerEvents.filter((event) => event.type === "turn.submitted").length, 1,
    );
    assert.equal(
      implementerEvents.filter((event) => event.type === "turn.completed").length, 2,
    );
    for (const event of implementerEvents.filter((e) => e.type === "turn.completed")) {
      assert.equal(typeof (event.payload as { report: { text: string } }).report.text, "string");
    }
  } finally {
    await service.close();
  }
});
```

Add `startSddFixer`, `sddFollowup`, `awaitTurn`, `artifact`, and `normalizedEvents` to `tests/support/mcp_service.ts` if they are absent. `normalizedEvents(runId)` reads `<log_root>/<runId>/normalized.jsonl` and JSON-parses each line.

- [ ] **Step 2: Write the failure-injection tests**

Append to `projects/xagent/tests/supervision_e2e.test.ts`:

```ts
test("a provider start failure after the insert surfaces as a tombstone in xagent_list", async () => {
  const service = await startMcpService({ failProviderStart: true });
  try {
    await assert.rejects(() => service.startSddImplementer({ task: 4 }));
    const body = structuredToolBody(asToolCallResult(
      await service.client.callTool({ name: "xagent_list", arguments: {} }),
    ));
    const runs = body.runs as Array<Record<string, unknown>>;
    const tombstone = runs.find((entry) => entry.run_missing === true);
    assert.ok(tombstone, "the failed dispatch must be visible as a tombstone");
    assert.equal((tombstone.sdd as { role: string }).role, "implementer");
    assert.equal(service.ledger().ListAll().length, 1);
  } finally {
    await service.close();
  }
});

test("a service restart leaves the ledger byte-identical and steers the controller to a fresh fixer", async () => {
  const logRoot = await mkdtemp(path.join(tmpdir(), "sdd-e2e-"));
  try {
    const first = await startMcpService({ logRoot });
    const implementer = await first.startSddImplementer({ task: 4 });
    const digestBefore = createHash("sha256")
      .update(readFileSync(path.join(logRoot, "sdd.sqlite")))
      .digest("hex");
    await first.killAbruptly();

    const second = await startMcpService({ logRoot });
    try {
      const digestAfter = createHash("sha256")
        .update(readFileSync(path.join(logRoot, "sdd.sqlite")))
        .digest("hex");
      assert.equal(digestAfter, digestBefore);

      const result = asToolCallResult(await second.client.callTool({
        name: "xagent_sdd_followup",
        arguments: {
          kind: "fix", agent_id: implementer.agent_id, round: 1,
          findings: second.artifact("task-4-findings.md"),
          findings_text: "x", tests: ["npm test"],
          report: second.artifact("task-4-report.md"),
        },
      }));
      assert.equal(result.isError, true);
      const body = structuredToolBody(result);
      assert.equal(body.error, "sdd_agent_not_live");
      assert.deepEqual(
        (body.details as { recovery: unknown }).recovery,
        { tool: "xagent_sdd_start", role: "fixer" },
      );
    } finally {
      await second.close();
    }
  } finally {
    await rm(logRoot, { recursive: true, force: true });
  }
});
```

Append to `projects/xagent/tests/sdd_store.test.ts`:

```ts
test("a stale v1 ledger refuses at startup with the documented reprovision wording", async () => {
  const logRoot = await mkdtemp(path.join(tmpdir(), "sdd-v1-"));
  try {
    const database = OpenSddLedgerDatabase(GetSddDatabasePath(logRoot));
    database.pragma("user_version = 1");
    database.close();
    assert.throws(() => CreateSddAgentStore(logRoot), (error: unknown) => {
      assert.ok(error instanceof SddStoreError);
      assert.equal(error.code, "sdd_ledger_schema_mismatch");
      assert.match(error.message, /stop the service, delete/);
      assert.match(error.message, /sdd\.sqlite-wal/);
      assert.match(error.message, /sdd\.sqlite-shm/);
      assert.match(error.message, /v1 data is not migrated/);
      return true;
    });
  } finally {
    await rm(logRoot, { recursive: true, force: true });
  }
});
```

Add `failProviderStart`, `logRoot`, and `killAbruptly` options/methods to `tests/support/mcp_service.ts`.

- [ ] **Step 3: Run to verify failure**

```bash
cd projects/xagent && npm run build && node --test dist/tests/e2e.test.js dist/tests/supervision_e2e.test.js dist/tests/sdd_store.test.js
```

Expected: FAIL — the support helpers do not exist yet.

- [ ] **Step 4: Add the missing support helpers**

Implement each helper named in Steps 1-2 in `projects/xagent/tests/support/mcp_service.ts`, following the file's existing construction pattern (`XagentRunManager` + `CreateSddAgentStore` + `CreateSddManager` + `createXagentServer`). No production source file changes in this task.

- [ ] **Step 5: Run to verify the tests pass**

```bash
cd projects/xagent && npm run build && node --test dist/tests/e2e.test.js dist/tests/supervision_e2e.test.js dist/tests/sdd_store.test.js
```

Expected: PASS.

**If any of these tests fails against real production behavior rather than a missing helper, fix the production code in this task** — that is the point of the verification pass. Note the fix in the commit message.

- [ ] **Step 6: Run the full suite**

```bash
cd projects/xagent && npm test
```

Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add projects/xagent/tests/
git commit -m "test(xagent): e2e lifecycle and failure-injection coverage for the v2 ledger (xsvc-8, xsvc-9, xsvc-12)"
```

---

### Task 10: Documentation, skills, and spec sync

**Satisfies:** xsvc-4, xsvc-14

**Files:**
- Modify: `plugins/xagent/skills/xagent-subagents/SKILL.md`
- Modify: `plugins/xagent/README.md`
- Modify: `plugins/xagent/scripts/install_global_test.py`
- Modify: `projects/agents/global/skills/openspec-superpowers-workflow/SKILL.md`
- Modify: `openspec/specs/xagent-service/spec.md`
- Modify: `openspec/specs/xagent-sdd-workflow/spec.md`

**Interfaces:**
- Consumes: the final tool surface from Tasks 4, 6, and 8.
- Produces: no code interfaces.

**Note:** xsvc-14 is satisfied documentation-only. The service has no pruning, truncation, or rotation code today, so there is nothing to gate in code; the requirement constrains future cleanup tooling.

- [ ] **Step 1: Rewrite `plugins/xagent/skills/xagent-subagents/SKILL.md`**

Make these changes and no others:

1. Remove every mention of `xagent_sdd_await` and `xagent_sdd_close`. Replace each usage with `xagent_await` / `xagent_close`, noting the field name is `run_id`, not `agent_id`.
2. Replace the v1 role list with the four start roles: `implementer`, `reviewer` (with `task` for a task review, without for a whole-branch review), `fixer`, `re-reviewer`. State that the role is the role the agent *starts* as and never changes.
3. State that `xagent_sdd_followup` is a same-agent convenience: it renders and submits, writes nothing, and returns `{ agent_id, sequence }`. Its `report` path is now a required input.
4. Add a recovery section: when a followup returns `sdd_agent_not_live`, dispatch a fresh `fixer` (for `implementer`/`fixer`) or `re-reviewer` (for `reviewer`/`re-reviewer`) with `xagent_sdd_start` for the same plan and task, passing the original brief.
5. State that `xagent_message` is legal on SDD runs and is recorded like any other submission.
6. Add a one-paragraph retention warning: `<log_root>/<agent_id>/` is the only copy of that agent's reports and submitted prompts; deleting a run directory referenced by the ledger destroys evidence.

- [ ] **Step 2: Add the reprovision section to `plugins/xagent/README.md`**

Append a section whose wording matches the error string in `sdd_store.ts` exactly:

```markdown
## One-time SDD ledger reprovision (schema v2)

The SDD ledger was redesigned as an insert-only per-agent dispatch index at
schema version 2. There is no migration: v1 rows were already inconsistent and
their forensic content survives in the run directories they point at.

Once, before starting a service build that includes the v2 ledger:

1. Stop the xagent service.
2. Delete `<log_root>/sdd.sqlite`, `<log_root>/sdd.sqlite-wal`, and
   `<log_root>/sdd.sqlite-shm`.
3. Start the service. It provisions schema v2 on first open.

A service that finds a ledger whose `user_version` is not 2 refuses to start the
SDD manager and names the files to delete, stating that v1 data is not migrated.

**Run directories are the system of record.** Reports and submitted prompts for
SDD agents live only in `<log_root>/<agent_id>/normalized.jsonl`. Any cleanup,
retention, or garbage-collection tooling must treat a run directory whose
`agent_id` appears in `sdd_agents` as evidence, not cache.
```

- [ ] **Step 3: Update the plugin packaging test**

In `plugins/xagent/scripts/install_global_test.py`, update any assertion naming the SDD tool surface. Add assertions that the packaged `SKILL.md` contains `xagent_sdd_start` and `xagent_sdd_followup` and contains neither `xagent_sdd_await` nor `xagent_sdd_close`, and that it names all four roles.

- [ ] **Step 4: Run the plugin tests**

```bash
cd /Users/joyo/Sheaf/.claude/worktrees/sdd-ledger-v2-redesign-6203c5 && python3 -m unittest plugins/xagent/scripts/install_global_test.py
```

Expected: `OK`.

- [ ] **Step 5: Update the canonical workflow skill**

In `projects/agents/global/skills/openspec-superpowers-workflow/SKILL.md`, update the SDD dispatch guidance to the two-tool surface (`xagent_sdd_start`, `xagent_sdd_followup`) plus generic await/message/close, and add fresh-agent fix/re-review recovery.

```bash
cd /Users/joyo/Sheaf/.claude/worktrees/sdd-ledger-v2-redesign-6203c5/projects/agents && make test
```

Expected: `OK` from both unittest discoveries and the repo-scope install check.

- [ ] **Step 6: Sync the OpenSpec specs**

Apply the change's delta to `openspec/specs/xagent-service/spec.md`: replace requirements xsvc-4, xsvc-5, and xsvc-6 with the MODIFIED text from `openspec/changes/redesign-sdd-ledger/specs/xagent-service/spec.md`, and add xsvc-8 through xsvc-14 verbatim from its ADDED section.

In `openspec/specs/xagent-sdd-workflow/spec.md`, remove or rewrite every requirement this change supersedes: turn-ledger rows, report-before-return, same-session-mandatory follow-ups, and closed-session semantics. Each rewritten requirement must match the v2 contract: one immutable row per agent, reports in `turn.completed`, followups optional and stateless, liveness a run-manager fact.

- [ ] **Step 7: Validate the specs**

```bash
cd /Users/joyo/Sheaf/.claude/worktrees/sdd-ledger-v2-redesign-6203c5 && openspec validate --strict
```

Expected: validation passes for both specs. If `openspec` is not on `PATH`, use the vendored entry point under `projects/agents/vendor/`.

- [ ] **Step 8: Commit**

```bash
git add plugins/xagent/skills plugins/xagent/README.md plugins/xagent/scripts/install_global_test.py projects/agents/global/skills/openspec-superpowers-workflow/SKILL.md openspec/specs
git commit -m "docs(xagent): sync skill, README, and specs to the v2 SDD surface (xsvc-4, xsvc-14)"
```

---

### Task 11: Full verification and asset repackage  
**CONTROLLER CHECKPOINT — do not dispatch. The lead runs this and records the evidence.**

**Satisfies:** none directly — this is the change's acceptance gate.

**Files:**
- Modify: `plugins/xagent/assets/` (regenerated, not hand-edited)

**Interfaces:**
- Consumes: everything.
- Produces: regenerated plugin runtime assets.

- [ ] **Step 1: Run the xagent suite**

```bash
cd /Users/joyo/Sheaf/.claude/worktrees/sdd-ledger-v2-redesign-6203c5 && make xagent-test
```

Expected: all `node --test` files pass, 0 failures.

- [ ] **Step 2: Run the dispatch-prompt suite**

```bash
cd /Users/joyo/Sheaf/.claude/worktrees/sdd-ledger-v2-redesign-6203c5/projects/agents && python3 -m unittest utils.dispatch_prompt_test
```

Expected: `OK`.

- [ ] **Step 3: Run the agents installer suite**

```bash
cd /Users/joyo/Sheaf/.claude/worktrees/sdd-ledger-v2-redesign-6203c5 && make agents-test
```

Expected: `OK`.

- [ ] **Step 4: Repackage the plugin runtime assets**

```bash
cd /Users/joyo/Sheaf/.claude/worktrees/sdd-ledger-v2-redesign-6203c5 && make xagent-plugin-build
```

Expected: regenerated files under `plugins/xagent/assets/`.

- [ ] **Step 5: Run the plugin test suite**

```bash
cd /Users/joyo/Sheaf/.claude/worktrees/sdd-ledger-v2-redesign-6203c5 && make xagent-plugin-test
```

Expected: unittest `OK`, `package_xagent.py --check` clean, plugin validator clean.

- [ ] **Step 6: Prove the deleted symbols are gone**

```bash
cd /Users/joyo/Sheaf/.claude/worktrees/sdd-ledger-v2-redesign-6203c5/projects/xagent
for symbol in conversationalAgents artifactsByAgent PersistReportBeforeReturn \
  ReconcileTerminalRuns abandonOpenTurns sdd_report_unbound sdd_turn_unresolved \
  sdd_session_closed sdd_followup_missing_paths sdd_report_path_required \
  sdd_turn_in_flight sdd_followup_required sdd_session_terminal \
  XagentSddAwaitInputSchema XagentSddCloseInputSchema sdd_dispatch_log; do
  count=$(grep -rc "$symbol" src/ | grep -v ':0$' | wc -l | tr -d ' ')
  echo "$symbol: $count"
done
```

Expected: every line reads `: 0`.

- [ ] **Step 7: Confirm the live service is healthy on a v2 ledger**

```bash
curl -sS http://127.0.0.1:9005/health
sqlite3 "$LOG_ROOT/sdd.sqlite" "PRAGMA user_version; SELECT COUNT(*) FROM sdd_agents;"
```

Expected: `healthy: true`; `user_version` `2`; a row count reflecting dispatches since the reprovision.

- [ ] **Step 8: Commit**

```bash
git add plugins/xagent/assets
git commit -m "chore(xagent): repackage plugin runtime assets for the v2 SDD surface"
```

---

## Self-review notes

**Spec coverage.** Every requirement in `openspec/changes/redesign-sdd-ledger/specs/xagent-service/spec.md` maps to at least one task; see the traceability table. xsvc-14 is intentionally documentation-only (Task 10) — the design records that there is no pruning code to gate.

**Deleted-by-name checklist.** Design D7 names each symbol this change removes. `conversationalAgents`, `artifactsByAgent`, `PersistReportBeforeReturn`, `CloseAfterProvider`'s ledger write, `FollowupRequired`/`sdd_followup_required`, `sdd_turn_in_flight`, `sdd_report_unbound` → Task 4. `sdd_session_closed`, `sdd_turn_unresolved`, `sdd_followup_missing_paths`, `sdd_report_path_required`, `sdd_session_terminal` → Task 5. `ReconcileTerminalRuns`, `abandonOpenTurns`, the one-shot startup repair, the v1 factory/schema, and the `sdd_dispatch_log` view → Task 8. Task 11 Step 6 proves all of them absent.

**Kept-by-name checklist.** `unknown_sdd_agent` and `sdd_followup_role_mismatch` survive unchanged (Task 5). `sdd_persistence_failed` and the renderer errors (`sdd_renderer_missing`, `sdd_renderer_failed`, `sdd_templates_missing`, `sdd_renderer_output_invalid`) are untouched throughout.

**Naming consistency.** `SddAgentStore`, `SddAgentRecord`, `InsertSddAgentInput`, `SddStartRole`, `CreateSddAgentStore`, `FormatFixDispatch`, `FormatFixDispatchInput`, `XagentSddListFields`, `XagentSddTombstoneRow`, `XagentListEntry`, and `sdd_agent_not_live` are each defined in exactly one task and used under the same spelling everywhere after it.
