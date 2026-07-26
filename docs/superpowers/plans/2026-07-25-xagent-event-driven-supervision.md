# Xagent Event-Driven Supervision Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace leader-visible xagent progress streaming with a Conductor-managed, event-driven supervision service that returns the worker's complete final report directly and uses a bounded no-tools Haiku watchdog only for active semantic derailment.

**Architecture:** A transport-independent `Supervisor` owns one persistent harness session, durable sequenced events, deterministic health timers, semantic evidence, and watchdog policy. A loopback `XagentService` registered with Conductor owns supervisors and exposes them through Streamable HTTP MCP; the Codex plugin discovers that endpoint and the quiet CLI is only a service client. Existing `xagent run --subagent|--full` remains an embedded compatibility path.

**Tech Stack:** TypeScript 5.8, Node.js 20+, Node test runner, `@modelcontextprotocol/sdk` 1.29.x with Zod 3.25+, existing Sheaf Conductor service registry, Python plugin/agent distribution tests.

## Global Constraints

- The OpenSpec source of truth is `openspec/changes/add-event-driven-xagent-supervision/`; implementation must satisfy every requirement and scenario there.
- Existing `xagent run --subagent|--full` parsing, persistent stdin protocol, output filtering, and logs remain compatible.
- The registered service name is `xagent`, host is `127.0.0.1`, port is `9005`, command is `make xagent-service-run`, and MCP endpoint is `http://127.0.0.1:9005/mcp`.
- The plugin MCP declaration sets `tool_timeout_sec` to `7200`; `xagent_await` defaults to and rejects values above `7000` seconds.
- Healthy provider deltas, tools, raw events, status, and healthy watchdog verdicts never complete an await and never enter the leader context.
- Successful `xagent_await` returns the complete sanitized final assistant report inline, not a summary or log pointer; missing final text produces `missing_final_report`.
- Lifecycle phase is one of `starting`, `running`, `ready`, `completed`, `failed`, `cancelled`, or `abandoned`; attention is an orthogonal durable sequenced event.
- Mechanical states are deterministic and never invoke Haiku: process exit/spawn failure, turn completion/failure, transport failure, exposed input/permission wait, cancellation/close, hard deadline, and silence.
- Haiku is eligible only while a live worker is actively producing tokens/messages/tools. It runs fresh with `--safe-mode`, `--tools ""`, `--strict-mcp-config`, an empty MCP config, `--no-session-persistence`, structured JSON output, bounded input/output, and no repository working directory.
- Watchdog defaults are 10/20/40-minute active-work cadence, five-minute minimum interval, three identical tool fingerprints or two identical failure fingerprints in ten minutes, healthy confidence floor `0.8`, 64 KiB UTF-8 input, 2 KiB output, and eight calls per run.
- Watchdog results are advisory only. `derailed`, `uncertain`, invalid, failed, over-budget, and low-confidence output emit attention but never message, interrupt, kill, restart, edit for, or otherwise steer the worker.
- An MCP/client disconnect or cancelled await releases only request-local resources; the Conductor-managed service continues owning the worker.
- The shipped service binds only to loopback and validates/canonicalizes an absolute existing working directory before creating run state.
- An orderly service exit closes owned sessions/process groups. Restart reconciliation marks unattachable active runs `abandoned` and only kills a process when PID plus process-start identity matches persisted ownership.
- Use test-first red/green/refactor. Every task report must record the failing test, why it failed, the passing test, and the broader verification command.
- After each task's spec-and-quality review passes, the controller marks only that task's mapped OpenSpec checkboxes complete; implementation subagents do not mark future or unreviewed work complete.
- Do not work around broken xagent, plugin, installer, OpenSpec, Superpowers, or Conductor infrastructure; surface it.

---


## Resume Note (2026-07-26)

Tasks 1–5 are complete on `codex/add-event-driven-xagent-supervision` at `35a18559`. Codex stopped before Task 6 (thread context exhausted / pause). The original plan predated the current OpenSpec→Superpowers workflow (no task-analyzer decomposition; reviews via xagent). Remaining work is replanned below with judgment-based decomposition because the task-analyzer has no Cursor model data yet. This run is a Cursor native-subagent baseline:

- **Bucket A (more complex):** alternate `glm-5.2-high` and `cursor-grok-4.5-high` between implementer and reviewer.
- **Bucket B (less complex):** `composer-2.5-fast` implementer, `cursor-grok-4.5-high` reviewer.
- Transport: native Cursor subagents only (no xagent, no kimi).

Sibling assignments: `docs/superpowers/plans/2026-07-25-xagent-event-driven-supervision.assignments.yaml`.


### Task 1: Restore the Permission-Mode Baseline and Commit Planning Artifacts

**OpenSpec mapping:** prerequisite only; no OpenSpec checkbox closes.

**Files:**
- Modify: `projects/xagent/src/cli.ts`
- Modify: `projects/xagent/src/runtime.ts`
- Modify: `projects/xagent/tests/cli.test.ts`
- Modify: `projects/xagent/tests/runtime.test.ts`
- Add to commits unchanged: `openspec/changes/add-event-driven-xagent-supervision/**`
- Add to commits unchanged: `docs/superpowers/plans/2026-07-25-xagent-event-driven-supervision.md`

**Interfaces:**
- Preserves: `parseArgs(argv): CliCommand` omits optional keys when their flag is absent.
- Preserves: `HarnessAdapter.start(options)` receives `permissionMode` only when explicitly configured.
- Produces: clean xagent baseline for subsequent tasks.

- [ ] **Step 1: Add explicit permission-mode behavior coverage while retaining the four existing red exact-shape tests**

Add literal assertions:

```ts
test("parses and forwards an explicit permission mode", async () => {
  const parsed = parseArgs([
    "run", "--harness", "claude_code", "--permission-mode", "acceptEdits", "--subagent",
  ]);
  assert.equal(parsed.command === "run" ? parsed.permissionMode : undefined, "acceptEdits");
});
```

Extend the runtime test adapter to record `HarnessStartOptions`, then assert an explicit `acceptEdits` value reaches it. The production regression caught by the existing tests is accidental insertion of an absent optional key into exact public object shapes.

- [ ] **Step 2: Verify the baseline is red for the known reason**

Run:

```bash
cd projects/xagent
npm test
```

Expected: exactly the four existing deep-equality failures report an extra `permissionMode: undefined`; the new explicit-value assertions pass.

- [ ] **Step 3: Omit the optional property when it is absent**

Use conditional object construction in both boundaries:

```ts
return {
  command: "run",
  harness,
  mode,
  model,
  thinkingLevel,
  ...(permissionMode === undefined ? {} : { permissionMode }),
  initialMessage: initialMessageParts.length > 0 ? initialMessageParts.join(" ") : undefined,
};
```

and:

```ts
const startOptions: HarnessStartOptions = {
  cwd: options.cwd,
  model: options.adapter.capabilities.forwardsModel ? options.model : undefined,
  thinkingLevel: options.adapter.capabilities.forwardsThinkingLevel ? options.thinkingLevel : undefined,
  ...(options.permissionMode === undefined ? {} : { permissionMode: options.permissionMode }),
};
return options.adapter.start(startOptions);
```

- [ ] **Step 4: Verify the repaired baseline**

Run `npm test` from `projects/xagent`.

Expected: 77 or more tests pass, zero fail.

- [ ] **Step 5: Commit the approved planning artifacts and baseline repair separately**

```bash
git add openspec/changes/add-event-driven-xagent-supervision docs/superpowers/plans/2026-07-25-xagent-event-driven-supervision.md
git commit -m "docs: plan event-driven xagent supervision"
git add projects/xagent/src/cli.ts projects/xagent/src/runtime.ts projects/xagent/tests/cli.test.ts projects/xagent/tests/runtime.test.ts
git commit -m "fix(xagent): preserve optional permission mode shape"
```

### Task 2: Add the Durable Supervisor State Machine and Metadata

**OpenSpec mapping:** 1.1, 1.2, 1.3.

**Files:**
- Create: `projects/xagent/src/supervision/types.ts`
- Create: `projects/xagent/src/supervision/event_queue.ts`
- Create: `projects/xagent/src/supervision/supervisor.ts`
- Create: `projects/xagent/tests/supervision.test.ts`
- Modify: `projects/xagent/src/logs.ts`
- Modify: `projects/xagent/tests/logs.test.ts`
- Modify: `projects/xagent/src/adapters/types.ts`
- Modify: `projects/xagent/src/adapters/fake.ts`

**Interfaces:**
- Produces: `SupervisionPhase`, `SupervisionEvent`, `AwaitResult`, `SupervisionPolicy`, `Supervisor`.
- Produces: `Supervisor.start()`, `submit(text)`, `awaitEvent(afterSequence, deadlineMs, signal?)`, `inspect()`, `interrupt()`, and `close()`.
- Produces: `RunMetadata.supervision` with phase, cursor, progress timestamps, process identity, and aggregate watchdog telemetry.

- [ ] **Step 1: Write fake-clock state and cursor tests**

Cover literal sequences:

```ts
assert.deepEqual(supervisor.inspect(), {
  run_id: "xrun_supervision",
  phase: "starting",
  sequence: 1,
  provider_thread_id: undefined,
});
await supervisor.start();
assert.equal(supervisor.inspect().phase, "ready");
const first = await supervisor.awaitEvent(0, 1_000);
const second = supervisor.awaitEvent(first.sequence, 1_000);
```

Prove lifecycle transitions are monotonic, attention does not replace `running`/`ready`, terminal state is durable, and a correctly advanced cursor does not redeliver an event.

- [ ] **Step 2: Verify red**

Run:

```bash
cd projects/xagent
npm run build
node --test dist/tests/supervision.test.js dist/tests/logs.test.js
```

Expected: compile failure because supervision modules and metadata fields do not exist.

- [ ] **Step 3: Implement focused types and event queue**

Define:

```ts
export type SupervisionPhase =
  | "starting" | "running" | "ready" | "completed"
  | "failed" | "cancelled" | "abandoned";

export type SupervisionEvent = {
  schema_version: 1;
  type: "supervision.state" | "supervision.attention" | "turn.completed";
  run_id: string;
  sequence: number;
  timestamp: string;
  phase: SupervisionPhase;
  reason: string;
  payload?: unknown;
};

export type SupervisionPolicy = {
  silenceTimeoutMs: number;
  hardDeadlineMs?: number;
  watchdog: WatchdogPolicy;
};
```

`SequencedEventQueue.publish()` appends durably through an injected sink and resolves only waiters whose cursor is behind the new deliverable event. Cancellation removes a waiter without changing run state.

- [ ] **Step 4: Implement supervisor lifecycle over a harness session**

The supervisor owns one `HarnessSession`, serializes turns, records the last assistant message and `turn.completed`, publishes only lifecycle/completion/attention delivery events, and persists every transition through injected metadata/event sinks. Extend the fake adapter with deterministic scripted events and optional `interrupt`.

- [ ] **Step 5: Extend run metadata atomically**

Add `supervision`, `watchdog`, and `owned_process` metadata while retaining legacy `exit_status`. Write metadata through a temporary sibling plus rename so a service crash cannot leave partial JSON.

- [ ] **Step 6: Verify and commit**

Run:

```bash
cd projects/xagent
npm test
```

Expected: all xagent tests pass.

Commit:

```bash
git add projects/xagent/src/supervision projects/xagent/src/logs.ts projects/xagent/src/adapters projects/xagent/tests
git commit -m "feat(xagent): add durable supervision state"
```

### Task 3: Implement Deterministic Health and Bounded Semantic Evidence

**OpenSpec mapping:** 2.1, 2.2, 2.3, 2.4.

**Files:**
- Create: `projects/xagent/src/supervision/health.ts`
- Create: `projects/xagent/src/supervision/evidence.ts`
- Create: `projects/xagent/tests/supervision_health.test.ts`
- Create: `projects/xagent/tests/supervision_evidence.test.ts`
- Modify: `projects/xagent/src/supervision/supervisor.ts`
- Modify: `projects/xagent/src/supervision/types.ts`
- Modify: `projects/xagent/src/sanitize.ts`

**Interfaces:**
- Produces: `DeterministicHealthMonitor.recordProviderActivity`, `recordMechanicalEvent`, `nextDeadline`.
- Produces: `SemanticEvidenceWindow.record(event)`, `snapshot()`, tool/failure fingerprints, and suspicion signals.
- Consumes: supervisor clock/timer injection from Task 2.

- [ ] **Step 1: Write deterministic classification tests**

Use a fake clock and classifier spy. Cover spawn/exit, completion/failure, transport loss, exposed input/permission, cancellation, hard deadline, and five-minute silence. Every assertion includes:

```ts
assert.equal(classifier.calls.length, 0);
assert.equal(attention.reason, "silence_timeout");
```

- [ ] **Step 2: Write evidence boundary tests**

Hand-build provider events containing absolute repo paths, `api_key`, repeated tool inputs, and repeated failures. Assert canonical repo-relative paths, redacted values, UTF-8 byte truncation at 64 KiB, three identical tool fingerprints, and two identical failure fingerprints inside ten minutes.

- [ ] **Step 3: Verify red**

Run the two compiled test files. Expected: missing health/evidence modules.

- [ ] **Step 4: Implement deterministic monitor**

Mechanical events map directly to completion/failure/attention. Provider bytes update transport liveness; semantic normalized events update semantic liveness. Timers use the injected clock/scheduler and publish one attention per condition transition.

- [ ] **Step 5: Implement evidence window**

Use canonical JSON hashing with secret redaction before hashing. Store only the bounded original prompt, recent semantic events, compact counters/fingerprints, elapsed time, and prior verdict. Do not store unrestricted raw provider payloads in watchdog evidence.

- [ ] **Step 6: Verify and commit**

Run `npm test` in `projects/xagent`; expect zero failures.

Commit:

```bash
git add projects/xagent/src/supervision projects/xagent/src/sanitize.ts projects/xagent/tests
git commit -m "feat(xagent): classify deterministic worker health"
```

### Task 4: Add the Isolated Haiku Semantic Watchdog

**OpenSpec mapping:** 3.1, 3.2, 3.3, 3.4, 3.5.

**Files:**
- Create: `projects/xagent/src/supervision/watchdog.ts`
- Create: `projects/xagent/src/supervision/claude_watchdog.ts`
- Create: `projects/xagent/tests/watchdog.test.ts`
- Create: `projects/xagent/tests/claude_watchdog.test.ts`
- Modify: `projects/xagent/src/supervision/supervisor.ts`
- Modify: `projects/xagent/src/supervision/types.ts`
- Modify: `projects/xagent/src/logs.ts`

**Interfaces:**
- Produces: `WatchdogClassifier.classify(request, signal): Promise<WatchdogVerdict>`.
- Produces: `WatchdogScheduler.onActiveEvidence`, `resetTurn`, `callsUsed`.
- Consumes: evidence snapshots and suspicion signals from Task 3.

- [ ] **Step 1: Write verdict/schema/cadence tests**

Cover literal verdicts `healthy`, `derailed`, and `uncertain`; confidence floor `0.8`; invalid JSON; failed invocation; output over 2 KiB; eight-call cap; 10/20/40-minute schedule; five-minute minimum; and reset on a new user turn.

- [ ] **Step 2: Write no-tools launcher tests**

Inject a spawn recorder and assert the command contains:

```ts
[
  "--print", "--model", "haiku", "--safe-mode",
  "--tools", "", "--strict-mcp-config",
  "--no-session-persistence", "--output-format", "json",
  "--json-schema", WATCHDOG_SCHEMA_JSON,
]
```

Assert cwd is a fresh empty temporary directory, the empty MCP config is supplied, input is at most 64 KiB, `--max-budget-usd` is present, and no repository path or session resume flag appears.

- [ ] **Step 3: Verify red**

Run the compiled watchdog test files. Expected: modules absent.

- [ ] **Step 4: Implement structured classifier and scheduler**

Normalize invalid, failed, over-budget, output-too-large, and confidence-below-floor results to `uncertain`. Only `healthy` with confidence at least `0.8` remains silent. Publish factual evidence and reason code, never executable instructions.

- [ ] **Step 5: Integrate semantic eligibility**

Only active token/message/tool evidence advances cadence. Silence and all mechanical states bypass the classifier. Suspicion can request an early check but cannot violate the five-minute minimum or directly declare derailment.

- [ ] **Step 6: Persist sanitized aggregate telemetry**

Persist evidence hash/size, verdict, usage/cost if reported, call count, truncation, and attention sequence in a separate watchdog JSONL file; never duplicate prompt text there.

- [ ] **Step 7: Verify and commit**

Run `npm test` in `projects/xagent`; expect zero failures.

Commit:

```bash
git add projects/xagent/src/supervision projects/xagent/src/logs.ts projects/xagent/tests
git commit -m "feat(xagent): add bounded Haiku watchdog"
```

### Task 5: Add Process Ownership, Interruption, and Restart Reconciliation

**OpenSpec mapping:** 1.4, 4.5.

**Files:**
- Modify: `projects/xagent/src/adapters/types.ts`
- Modify: `projects/xagent/src/adapters/process_jsonl.ts`
- Modify: `projects/xagent/src/adapters/fake.ts`
- Create: `projects/xagent/src/supervision/process_identity.ts`
- Create: `projects/xagent/src/supervision/reconcile.ts`
- Create: `projects/xagent/tests/process_ownership.test.ts`
- Modify: `projects/xagent/src/supervision/supervisor.ts`
- Modify: `projects/xagent/src/logs.ts`

**Interfaces:**
- Produces: `OwnedProcessIdentity { pid, started_at }`.
- Extends: `HarnessSession.processIdentity`, `interrupt()`, and idempotent `close()`.
- Produces: `reconcileStaleRuns(logRoot, processInspector)`.

- [ ] **Step 1: Write process identity and interrupt tests**

Use a real long-lived Node child fixture. Assert process group ownership, interrupt terminates only the active turn, close is idempotent, and persisted PID/start identity is populated while active.

- [ ] **Step 2: Write reconciliation tests**

Test matching PID plus start identity is terminated and marked `abandoned`; mismatched start identity is not signalled but is still marked `abandoned`; terminal runs remain unchanged.

- [ ] **Step 3: Verify red**

Run `node --test dist/tests/process_ownership.test.js`; expect missing interfaces.

- [ ] **Step 4: Track the active child safely**

Spawn provider turns detached as an owned process group on POSIX. Store the active child only while the turn is running. `interrupt()` signals that group; `close()` interrupts if needed and prevents new turns.

- [ ] **Step 5: Implement proven-identity reconciliation**

Read process start identity using an injected inspector in tests and a platform implementation in production. Never signal by PID alone. Persist `abandoned` plus deterministic attention before cleanup result logging.

- [ ] **Step 6: Verify and commit**

Run xagent tests; expect zero failures and no leaked fixture process.

Commit:

```bash
git add projects/xagent/src/adapters projects/xagent/src/supervision projects/xagent/src/logs.ts projects/xagent/tests
git commit -m "feat(xagent): own and reconcile provider processes"
```

### Task 6: Add the Conductor-Managed Xagent HTTP Service

**Bucket:** A (complex)
**Models:** implementer `glm-5.2-high`, reviewer `cursor-grok-4.5-high`
**OpenSpec mapping:** 4.1, 4.2, 4.3, 4.4.

**Files:**
- Create: `projects/xagent/src/service/config.ts`
- Create: `projects/xagent/src/service/run_manager.ts`
- Create: `projects/xagent/src/service/server.ts`
- Create: `projects/xagent/src/service_main.ts`
- Create: `projects/xagent/tests/service.test.ts`
- Modify: `projects/xagent/package.json`
- Modify: `projects/xagent/Makefile`
- Modify: `Makefile`
- Modify: `config/services.json`
- Modify: `projects/conductor/tests/registry.test.ts` (and/or `scaffold.test.ts` as needed)

**Interfaces:**
- Consumes: `Supervisor` (`start`, `submit`, `awaitEvent`, `inspect`, `interrupt`, `close`) from Tasks 2–5.
- Produces: `XagentRunManager` owning `Map<runId, Supervisor>` independently of HTTP request objects.
- Produces: `createXagentServer({ bindHost, bindPort, runManager, shutdownController })`.
- Produces: Conductor-compatible `GET /health` → `{healthy:true, uptime}` (+ optional `warning`); `POST /exit` → `{exiting:true}` then orderly close of owned supervisors/process groups; JSON 404 for unknown routes.
- Produces: registry entry `xagent` / `127.0.0.1` / `9005` / `make xagent-service-run`.

- [ ] **Step 1: Write registry and HTTP lifecycle tests**

Assert tracked registry entry equals:

```json
{
  "name": "xagent",
  "host": "127.0.0.1",
  "port": 9005,
  "command": "make xagent-service-run"
}
```

HTTP tests assert health shape, warning only when degraded, bounded JSON 404, exit acknowledgement before cleanup, repeated exit idempotence, and request disconnect does not close a run owned by the manager.

Follow Conductor contract patterns in `projects/conductor/src/server.ts` and sheaf-chat `projects/sheaf-chat/src/server/server.ts` (`exiting: true`, not `status: exiting`).

- [ ] **Step 2: Verify red**

Run xagent service tests and the relevant Conductor registry test. Expected: service entry/modules absent.

- [ ] **Step 3: Implement service config and run manager**

Locate the Sheaf root by finding `config/services.json` plus `structure/`, load the `xagent` entry, require loopback in shipped configuration, and resolve the central xagent log root. The run manager owns supervisors independently of request objects and can create/start/submit/await/inspect/interrupt/close by `run_id`.

- [ ] **Step 4: Implement standard service endpoints and shutdown**

`GET /health` returns `{healthy:true, uptime}` plus an optional warning. `POST /exit` flushes `{exiting:true}`, stops accepting requests, closes every supervisor/process group, closes the HTTP server, then exits successfully through an injected callback.

- [ ] **Step 5: Add service commands**

Add package bin/script and Make targets:

```make
xagent-service-run:
	$(MAKE) -C projects/xagent service-run
```

The project target installs, builds, and runs `dist/src/service_main.js`. Bind host/port from the registry (sheaf-chat style).

- [ ] **Step 6: Verify and commit**

Run:

```bash
cd projects/xagent && npm test
cd ../conductor && npm test
```

Expected: both suites pass.

Commit:

```bash
git add config/services.json Makefile projects/xagent projects/conductor/tests
git commit -m "feat(xagent): add Conductor-managed service"
```

### Task 7: Expose Service-Owned Runs Through Streamable HTTP MCP

**Bucket:** A (complex)
**Models:** implementer `cursor-grok-4.5-high`, reviewer `glm-5.2-high`
**OpenSpec mapping:** 5.1, 5.2.

**Files:**
- Modify: `projects/xagent/package.json`
- Modify: `projects/xagent/package-lock.json`
- Create: `projects/xagent/src/service/mcp.ts`
- Create: `projects/xagent/src/service/tool_schemas.ts`
- Create: `projects/xagent/tests/mcp.test.ts`
- Modify: `projects/xagent/src/service/server.ts`
- Modify: `projects/xagent/src/service/run_manager.ts`

**Interfaces:**
- Consumes: Task 6 `XagentRunManager` and HTTP server.
- Produces MCP tools: `xagent_start`, `xagent_await`, `xagent_inspect`, `xagent_message`, `xagent_interrupt`, `xagent_close`.
- Produces service methods with typed inputs/outputs and no MCP objects below the transport boundary.
- `xagent_await` may return a provisional structured result in this task; Task 8 owns the final versioned completion envelope and blocking semantics hardening.

- [ ] **Step 1: Install the official SDK as tracked dependencies**

Run:

```bash
cd projects/xagent
NPM_CONFIG_CACHE=/private/tmp/xagent-npm-cache npm install @modelcontextprotocol/sdk@^1.29.0 zod@^3.25.0
```

- [ ] **Step 2: Write MCP discovery and validation tests**

Start the real HTTP server on an ephemeral loopback port with a fake adapter factory. Initialize an SDK Streamable HTTP client and assert exactly the six tool names. Assert relative/missing/non-directory cwd returns `invalid_working_directory` and creates no run.

- [ ] **Step 3: Verify red**

Run compiled `mcp.test.js`; expected: `/mcp` is 404 or MCP module absent.

- [ ] **Step 4: Implement transport-neutral tool schemas**

Define Zod schemas with absolute `cwd`, harness enum, optional model/thinking/permission/policy, `run_id`, `after_sequence`, and bounded `deadline_seconds`. Convert validation errors to stable structured tool errors.

- [ ] **Step 5: Implement Streamable HTTP MCP**

Use the SDK transport at `/mcp`. Tool handlers call only `XagentRunManager`. `xagent_start` canonicalizes cwd before allocating a run. `inspect`, `message`, `interrupt`, and `close` preserve lifecycle rules and return structured content.

- [ ] **Step 6: Verify and commit**

Run xagent tests; expect MCP initialization and all legacy tests pass.

Commit:

```bash
git add projects/xagent/package.json projects/xagent/package-lock.json projects/xagent/src/service projects/xagent/tests/mcp.test.ts
git commit -m "feat(xagent): expose supervision over HTTP MCP"
```

### Task 8: Implement Blocking Await and Direct Final-Report Delivery

**Bucket:** A (complex)
**Models:** implementer `glm-5.2-high`, reviewer `cursor-grok-4.5-high`
**OpenSpec mapping:** 5.3, 5.4, 5.5, 5.6.

**Files:**
- Modify: `projects/xagent/src/service/run_manager.ts`
- Modify: `projects/xagent/src/service/mcp.ts`
- Modify: `projects/xagent/src/supervision/event_queue.ts` (only if envelope shaping requires it)
- Modify: `projects/xagent/src/supervision/supervisor.ts` (only if final-report retention requires it)
- Create: `projects/xagent/tests/mcp_await.test.ts`

**Interfaces:**
- Consumes: Task 7 MCP tools and Task 6 run manager.
- Produces: versioned completion/attention/failure/deadline envelopes.
- Preserves: service-owned run on request abort/deadline.

- [ ] **Step 1: Write blocking and cursor tests**

With fake time, prove routine delta/tool events do not settle the promise; completion and attention do; advancing `after_sequence` suppresses duplicate delivery; sequence zero allows a replacement boss to recover a durable deliverable event.

- [ ] **Step 2: Write exact completion-envelope tests**

Assert:

```ts
assert.deepEqual(result, {
  schema_version: 1,
  event: "turn.completed",
  run_id: "xrun_report",
  sequence: 42,
  phase: "ready",
  report: { text: "complete final assistant message" },
  elapsed_ms: 123_456,
});
```

Also assert no `deltas`, `tools`, `raw_provider`, `watchdog`, or prior-turn field exists. A successful provider completion with empty final text returns `missing_final_report`.

- [ ] **Step 3: Verify red**

Run compiled `mcp_await.test.js`; expected: await envelope behavior missing.

- [ ] **Step 4: Implement durable delivery envelopes**

Sanitize the final assistant message once at the supervisor/service boundary and retain it in the durable completion event. Do not summarize or replace it with a path. Failure/attention/cancellation/abandonment/deadline share the versioned outer envelope with compact event-specific payloads.

- [ ] **Step 5: Implement request lifetime behavior**

Default and maximum are `7000` seconds. Configure Node's server response/request lifetime to support `7200` seconds. Abort removes the waiter only. Use fake clock advancement to simulate 90 minutes; do not sleep in tests.

- [ ] **Step 6: Verify and commit**

Run xagent tests; expect zero failures.

Commit:

```bash
git add projects/xagent/src/service projects/xagent/src/supervision projects/xagent/tests/mcp_await.test.ts
git commit -m "feat(xagent): deliver final reports through blocking await"
```

### Task 9: Package HTTP MCP Discovery Without a Local Supervisor

**Bucket:** B (less complex)
**Models:** implementer `composer-2.5-fast`, reviewer `cursor-grok-4.5-high`
**OpenSpec mapping:** 5.7.

**Files:**
- Create: `plugins/xagent/.mcp.json`
- Modify: `plugins/xagent/.codex-plugin/plugin.json`
- Modify: `plugins/xagent/scripts/package_xagent.py`
- Modify: `plugins/xagent/scripts/install_global_test.py` (extend `PackageXagentOutputTests`; there is no separate `package_xagent_test.py`)
- Modify: `plugins/xagent/assets/xagent/package.json` only if packaging regenerates it

**Interfaces:**
- Consumes: Task 7 `/mcp` endpoint contract.
- Produces: plugin MCP entry `xagent` of type `http`, URL `http://127.0.0.1:9005/mcp`, `tool_timeout_sec: 7200`.
- Preserves: packaged compatibility launcher for legacy `xagent run`.

- [ ] **Step 1: Write behavioral package validation**

Build into a temporary plugin staging root, load manifest plus `.mcp.json`, connect through the declared URL to a fake/ephemeral service when practical, and assert tool discovery or at least declared URL/timeout shape. Assert the package contains no stdio MCP command or second service entry point.

- [ ] **Step 2: Verify red**

Run:

```bash
python3 plugins/xagent/scripts/install_global_test.py
```

Expected: `.mcp.json` absent and/or manifest lacks `mcpServers`.

- [ ] **Step 3: Add HTTP MCP declaration**

Create:

```json
{
  "mcpServers": {
    "xagent": {
      "type": "http",
      "url": "http://127.0.0.1:9005/mcp",
      "tool_timeout_sec": 7200
    }
  }
}
```

Reference it as `"mcpServers": "./.mcp.json"` in the plugin manifest. Package only the legacy CLI runtime/assets needed by the launcher; supervised ownership remains in the service.

- [ ] **Step 4: Verify and commit**

Run:

```bash
python3 plugins/xagent/scripts/install_global_test.py
make xagent-plugin-test
```

Expected: package behavior and plugin validation pass.

Commit:

```bash
git add plugins/xagent
git commit -m "feat(xagent): package HTTP MCP discovery"
```

### Task 10: Add the Quiet Service-Client CLI

**Bucket:** A (complex)
**Models:** implementer `cursor-grok-4.5-high`, reviewer `glm-5.2-high`
**OpenSpec mapping:** 6.1, 6.2, 6.3, 6.4, 6.5.

**Files:**
- Create: `projects/xagent/src/service/client.ts`
- Create: `projects/xagent/tests/service_client.test.ts`
- Modify: `projects/xagent/src/cli.ts`
- Modify: `projects/xagent/tests/cli.test.ts`
- Modify: `projects/xagent/tests/e2e.test.ts` only if legacy coverage needs an explicit non-regression hook

**Interfaces:**
- Consumes: Task 6–8 service operations (HTTP/MCP or typed client over the same operations).
- Produces commands: `xagent supervise`, `xagent await`, `xagent inspect`, `xagent message`, `xagent interrupt`, `xagent close`.
- Consumes: service operations; never constructs a `Supervisor`.
- Preserves: all existing `run`, `list`, and `logs` behavior.

- [ ] **Step 1: Write parser/help tests**

Cover start options and existing-run operations with literal command objects. Help must explain service dependency, `run_id`, quiet output, and direct final report without changing legacy run help.

- [ ] **Step 2: Write fake-service integration tests**

Prove healthy progress produces no stdout; attention, completion, deadline, explicit inspect, and infrastructure failure each produce one compact JSON result; follow-up is accepted only in `ready`; interrupt only in `running`; reattachment uses the same run.

- [ ] **Step 3: Verify red**

Run CLI/service-client tests; expected: unsupported commands.

- [ ] **Step 4: Implement a thin client**

Resolve the service URL to loopback `9005`, call typed operations, and map connection failure to `xagent_service_unavailable`. Never import the supervisor, create an adapter, or launch a fallback service in the client path.

- [ ] **Step 5: Preserve legacy compatibility**

Run all existing CLI/e2e cases unchanged, including streamed `xagent run --subagent|--full`.

- [ ] **Step 6: Verify and commit**

Run xagent tests; expect zero failures.

Commit:

```bash
git add projects/xagent/src/service/client.ts projects/xagent/src/cli.ts projects/xagent/tests
git commit -m "feat(xagent): add quiet supervision client"
```

### Task 11: Update Xagent and Superpowers Workflow Skills

**Bucket:** B (less complex)
**Models:** implementer `composer-2.5-fast`, reviewer `cursor-grok-4.5-high`
**OpenSpec mapping:** 7.1, 7.2, 7.3.

**Files:**
- Modify: `projects/agents/global/skills/xagent-subagents/SKILL.md`
- Modify: `projects/agents/global/skills/openspec-superpowers-workflow/SKILL.md`
- Modify: `projects/agents/scripts/install_test.py`
- Modify generated copy via installer: `.codex/skills/xagent-subagents/SKILL.md`
- Modify generated copy via installer: `.codex/skills/openspec-superpowers-workflow/SKILL.md`
- Modify packaged copy: `plugins/xagent/skills/xagent-subagents/SKILL.md`

**Interfaces:**
- Produces agent guidance that verifies Conductor xagent health, uses MCP start/await, consumes `report.text`, and forbids routine polling/unmanaged fallback.
- Produces native-subagent guidance using long mailbox waits and sparse blocker/final messages.

- [ ] **Step 1: Write installer behavior tests**

Render outputs in a temporary home and assert the distributed skill semantics: service health preflight; MCP start/await/report flow; no short `write_stdin`, `xagent list`, logs, or `list_agents` polling; quiet service-client fallback only when service is healthy; broken infrastructure escalation; native child messages only for blocker/input/final.

- [ ] **Step 2: Verify red**

Run:

```bash
cd projects/agents
python3 -m unittest scripts.install_test
```

Expected: new semantic assertions fail against current skill text.

- [ ] **Step 3: Rewrite canonical skill guidance**

The xagent skill flow is:

```text
verify Conductor reports xagent healthy
→ xagent_start(cwd, prompt, harness/model/policy)
→ perform independent boss work
→ one xagent_await(run_id, cursor)
→ consume report.text, or handle compact attention
→ await again with returned cursor only when continuing
```

Explicitly state deterministic versus semantic watchdog responsibility and that watchdog attention never acts on the worker.

- [ ] **Step 4: Tighten OpenSpec/Superpowers coordinator waits**

Require one long native mailbox wait after independent work, sparse blocker/final child messages, and reason-gated inspection. For xagent, use service MCP rather than terminal polling. Prefer native harness subagents when the assigned model is available; do not prescribe xagent as the default transport for same-provider work.

- [ ] **Step 5: Regenerate distributed copies and verify**

Run:

```bash
make agents-install-repo
python3 plugins/xagent/scripts/package_xagent.py
make agents-test
```

Expected: repository and packaged skill copies match canonical generated content and tests pass.

- [ ] **Step 6: Commit**

```bash
git add projects/agents .codex/skills plugins/xagent
git commit -m "feat(agents): use event-driven xagent supervision"
```

### Task 12: Add End-to-End Supervision, Cost, and Packaging Validation

**Bucket:** A (complex)
**Models:** implementer `glm-5.2-high`, reviewer `cursor-grok-4.5-high`
**OpenSpec mapping:** 8.1, 8.2, 8.3, 8.4.

**Files:**
- Create: `projects/xagent/tests/fixtures/watchdog/*.json`
- Create: `projects/xagent/tests/supervision_e2e.test.ts`
- Create: `projects/xagent/tests/supervision_cost.test.ts`
- Modify: `projects/xagent/tests/e2e.test.ts` only if needed for shared helpers
- Modify: `plugins/xagent/scripts/install_global_test.py` and/or packaging validation as needed
- Create: `projects/xagent/docs/supervision.md`

**Interfaces:**
- Validates the complete service/plugin/client workflow from a temporary non-Sheaf repository.
- Documents measured wake counts, defaults, rollback, and known service-crash boundary.

- [ ] **Step 1: Add recorded watchdog fixtures**

Provide hand-authored sanitized fixtures for healthy exploration, repeated-tool loop, error thrashing, task contradiction, insufficient evidence, silence, and crash. Silence/crash fixtures assert zero classifier calls.

- [ ] **Step 2: Add complete fake-provider service test**

Start the real xagent service on an ephemeral loopback port, connect through the packaged MCP declaration, launch from a temporary repository, block through routine progress, cancel/reconnect one controller, recover by `run_id`, receive the complete final report once, then close and assert no owned process remains.

- [ ] **Step 3: Add wake/cost regression**

Use fake clock and a 90-minute event schedule. Report literal counters for 30-second terminal polling, quiet client fallback, and MCP await. Assert MCP healthy-completion wake count is `1` and that leader-visible progress bytes are `0` before the final report.

- [ ] **Step 4: Verify red then green**

First run the new compiled tests and record their expected missing-integration failures. Complete only test fixtures/helpers necessary to exercise production boundaries; do not add a second implementation.

- [ ] **Step 5: Document operations and rollback**

Document Conductor start/health/stop commands, endpoint, six tools, final envelope, deterministic/Haiku boundary, 10/20/40 cadence, five-minute minimum, eight-call cap, 7000/7200-second timeouts, recovery behavior, central logs, and rollback to legacy `xagent run --subagent`.

- [ ] **Step 6: Run full verification**

Run:

```bash
make xagent-test
make conductor-test
make agents-test
make xagent-plugin-test
openspec validate add-event-driven-xagent-supervision --strict
python3 -m unittest tests/openspec_requirement_ids_test.py
git diff --check
```

Expected: every command exits zero.

- [ ] **Step 7: Commit validation artifacts**

```bash
git add projects/xagent plugins/xagent
git commit -m "test(xagent): verify event-driven supervision"
```
