import assert from "node:assert/strict";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";

import { FakeHarnessAdapter } from "../src/adapters/fake.js";
import type { AdapterEvent } from "../src/adapters/types.js";
import {
  isPersistedAwaitWake,
  XagentRunManager,
} from "../src/service/run_manager.js";
import {
  AsSddRunManagerPort,
  CreateSddManager,
} from "../src/service/sdd_manager.js";
import {
  CreateSddStore,
  GetSddDatabasePath,
} from "../src/service/sdd_store.js";
import {
  x_DefaultAwaitDeadlineSeconds,
  x_MaxAwaitDeadlineSeconds,
  FixFollowupSchema,
  ImplementerStartSchema,
  XagentAwaitInputSchema,
  XagentMessageInputSchema,
  XagentStartInputSchema,
  XagentSddAwaitInputSchema,
} from "../src/service/tool_schemas.js";
import type { SupervisionPolicy, SupervisionScheduler } from "../src/supervision/types.js";
import Database from "better-sqlite3";
import { writeFile } from "node:fs/promises";

const testPolicy: SupervisionPolicy = {
  silenceTimeoutMs: 600_000,
  watchdog: {},
};

const x_DefaultSupervisionPolicy: SupervisionPolicy = {
  silenceTimeoutMs: 300_000,
  watchdog: {},
};

const x_RunDurationMs = 90 * 60_000;
const x_ProgressIntervalMs = 60_000;

test("await deadline defaults to 7000 seconds and rejects larger values", async () => {
  const defaultParsed = XagentAwaitInputSchema.parse({
    run_id: "xrun_schema",
    after_sequence: 0,
  });
  assert.equal(defaultParsed.deadline_seconds, x_DefaultAwaitDeadlineSeconds);
  assert.equal(x_MaxAwaitDeadlineSeconds, 7000);
  assert.equal(x_DefaultAwaitDeadlineSeconds, 7000);

  const rejected = XagentAwaitInputSchema.safeParse({
    run_id: "xrun_schema",
    after_sequence: 0,
    deadline_seconds: 7001,
  });
  assert.equal(rejected.success, false);
});

test("SDD await deadline defaults to 7000 seconds and rejects larger values", () => {
  const defaultParsed = XagentSddAwaitInputSchema.parse({
    agent_id: "xrun_20260726000000000_00000001",
    after_sequence: 0,
  });
  assert.equal(defaultParsed.deadline_seconds, x_DefaultAwaitDeadlineSeconds);
  assert.equal(x_MaxAwaitDeadlineSeconds, 7000);
  assert.equal(x_DefaultAwaitDeadlineSeconds, 7000);

  const rejected = XagentSddAwaitInputSchema.safeParse({
    agent_id: "xrun_20260726000000000_00000001",
    after_sequence: 0,
    deadline_seconds: 7001,
  });
  assert.equal(rejected.success, false);
});

test("SDD await requires after_sequence and a generated agent_id", () => {
  assert.equal(
    XagentSddAwaitInputSchema.safeParse({
      agent_id: "xrun_20260726000000000_00000001",
    }).success,
    false,
  );
  assert.equal(
    XagentSddAwaitInputSchema.safeParse({
      agent_id: "not-valid",
      after_sequence: 0,
    }).success,
    false,
  );
});

test("SDD await and generic await persist sanitized report before returning", async () => {
  const repoRoot = await mkdtemp(path.join(tmpdir(), "xagent-sdd-await-"));
  const logRoot = path.join(repoRoot, "xagent");
  const briefPath = path.join(repoRoot, "brief.md");
  const reportPath = path.join(repoRoot, "report.md");
  const planPath = path.join(repoRoot, "plan.md");
  await writeFile(briefPath, "Implement await persistence.\n", "utf8");
  await writeFile(reportPath, "", "utf8");
  await writeFile(planPath, "# plan\n", "utf8");

  const adapter = new FakeHarnessAdapter();
  async function* scriptedTurn(): AsyncIterable<AdapterEvent> {
    yield {
      type: "message.completed",
      message_id: "message_1",
      role: "assistant",
      text: "sanitized report",
    };
    yield {
      type: "turn.completed",
      final_text: "sanitized report",
      provider_thread_id: "fake-thread-sdd",
    };
  }
  adapter.options.scriptedEvents = [scriptedTurn()];

  const runManager = new XagentRunManager({
    repoRoot,
    logRoot,
    adapterFactory: () => adapter,
    policy: testPolicy,
  });
  const store = CreateSddStore(logRoot);
  const manager = CreateSddManager({
    store,
    runManager: AsSddRunManagerPort(runManager),
    repoRoot,
    async canonicalizeCwd(cwd: string): Promise<string>
    {
      return cwd;
    },
    async renderPrompt()
    {
      return {
        prompt: {
          path: path.join(repoRoot, "dispatch.md"),
          text: "Rendered SDD prompt.\n",
        },
        metadata: {
          promptPath: path.join(repoRoot, "dispatch.md"),
          rendererPath: "/service/checkout/projects/agents/utils/dispatch-prompt",
          briefPath,
          reportPath,
        },
      };
    },
  });

  try
  {
    const started = await manager.Start({
      role: "implementer",
      cwd: repoRoot,
      plan: planPath,
      agent: "fake-model",
      harness: "codex",
      effort: "high",
      task: 4,
      name: "await-persist",
      brief: briefPath,
      report: reportPath,
    });

    const awaited = await manager.Await({
      agent_id: started.agent_id,
      after_sequence: started.sequence,
      deadline_seconds: 5,
    });
    assert.equal(awaited.event, "turn.completed");
    assert.equal(awaited.report?.text, "sanitized report");
    assert.equal(store.GetOpenTurn(started.agent_id), undefined);

    const database = new Database(GetSddDatabasePath(logRoot), { readonly: true });
    const row = database
      .prepare(
        "SELECT status, report_text, completed_sequence, resume_sequence FROM sdd_turns WHERE agent_id = ? AND turn_number = 1",
      )
      .get(started.agent_id) as {
        status: string;
        report_text: string;
        completed_sequence: number;
        resume_sequence: number;
      };
    database.close();
    assert.equal(row.status, "completed");
    assert.equal(row.report_text, "sanitized report");
    assert.equal(row.completed_sequence, awaited.sequence);
    assert.equal(row.resume_sequence, started.sequence);
  }
  finally
  {
    store.Close();
    await runManager.closeAll();
  }
});

test("routine deltas and tool events do not settle an await; completion does", async () => {
  const harness = new TestHarness();
  await harness.run(async ({ runManager, runId, adapter }) => {
    await runManager.start(runId);
    const cursor = runManager.inspect(runId)!.sequence;

    const afterTools = deferred<void>();
    const releaseTurn = deferred<void>();
    async function* scriptedTurn(): AsyncIterable<AdapterEvent> {
      yield {
        type: "message.delta",
        message_id: "message_delta_1",
        role: "assistant",
        delta: "partial text",
      };
      yield {
        type: "tool.started",
        tool_call_id: "tool_1",
        name: "fake_tool",
        input: {},
      };
      yield {
        type: "tool.completed",
        tool_call_id: "tool_1",
        name: "fake_tool",
        status: "completed",
        output: {},
      };
      afterTools.resolve(undefined);
      await releaseTurn.promise;
      yield {
        type: "message.completed",
        message_id: "message_1",
        role: "assistant",
        text: "complete final assistant message",
      };
      yield {
        type: "turn.completed",
        final_text: "complete final assistant message",
        provider_thread_id: "fake-thread-1",
      };
    }
    adapter.options.scriptedEvents = [scriptedTurn()];

    const awaiting = runManager.awaitRun({
      run_id: runId,
      after_sequence: cursor,
      deadline_seconds: 5,
    });
    const turn = runManager.submit(runId, "do work");
    await afterTools.promise;

    let settled = false;
    await Promise.race([
      awaiting.then(() => {
        settled = true;
      }),
      Promise.resolve(),
    ]);
    assert.equal(settled, false);

    releaseTurn.resolve(undefined);
    const result = await awaiting;
    assert.equal(result.event, "turn.completed");
    assert.equal(
      (result as unknown as { report: { text: string } }).report.text,
      "complete final assistant message",
    );
    await turn;
  });
});

test("attention event settles an await", async () => {
  const harness = new TestHarness();
  await harness.run(async ({ runManager, runId, adapter }) => {
    await runManager.start(runId);
    const cursor = runManager.inspect(runId)!.sequence;

    const releaseTurn = deferred<void>();
    async function* scriptedTurn(): AsyncIterable<AdapterEvent> {
      yield {
        type: "status",
        level: "info",
        code: "input_required",
        message: "approve?",
      };
      await releaseTurn.promise;
      yield {
        type: "message.completed",
        message_id: "message_1",
        role: "assistant",
        text: "done",
      };
      yield {
        type: "turn.completed",
        final_text: "done",
        provider_thread_id: "fake-thread-1",
      };
    }
    adapter.options.scriptedEvents = [scriptedTurn()];

    const awaiting = runManager.awaitRun({
      run_id: runId,
      after_sequence: cursor,
      deadline_seconds: 5,
    });
    const turn = runManager.submit(runId, "work");
    const result = await awaiting;
    assert.equal(result.event, "supervision.attention");
    assert.equal(result.reason, "input_required");
    releaseTurn.resolve(undefined);
    await turn;
  });
});

test("after_sequence suppresses duplicate delivery of an already-seen completion", async () => {
  const harness = new TestHarness();
  await harness.run(async ({ runManager, runId, adapter }) => {
    await runManager.start(runId);
    const cursor = runManager.inspect(runId)!.sequence;
    async function* scriptedTurn(): AsyncIterable<AdapterEvent> {
      yield {
        type: "message.completed",
        message_id: "message_1",
        role: "assistant",
        text: "done once",
      };
      yield {
        type: "turn.completed",
        final_text: "done once",
        provider_thread_id: "fake-thread-1",
      };
    }
    adapter.options.scriptedEvents = [scriptedTurn()];

    const turn = runManager.submit(runId, "done once");
    const first = await runManager.awaitRun({
      run_id: runId,
      after_sequence: cursor,
      deadline_seconds: 5,
    });
    await turn;
    assert.equal(first.event, "turn.completed");
    const completionSequence = first.sequence;

    const second = await runManager.awaitRun({
      run_id: runId,
      after_sequence: completionSequence,
      deadline_seconds: 1,
    });
    assert.equal(second.event, "supervision.deadline");
    assert.equal(second.reason, "await_deadline");
  });
});

test("sequence zero lets a replacement boss recover a durable deliverable event", async () => {
  const harness = new TestHarness();
  await harness.run(async ({ runManager, runId, adapter }) => {
    await runManager.start(runId);
    async function* scriptedTurn(): AsyncIterable<AdapterEvent> {
      yield {
        type: "message.completed",
        message_id: "message_1",
        role: "assistant",
        text: "recovered report",
      };
      yield {
        type: "turn.completed",
        final_text: "recovered report",
        provider_thread_id: "fake-thread-1",
      };
    }
    adapter.options.scriptedEvents = [scriptedTurn()];
    await runManager.submit(runId, "first boss started this");

    const first = await runManager.awaitRun({
      run_id: runId,
      after_sequence: 0,
      deadline_seconds: 5,
    });
    assert.equal(first.event, "supervision.state");

    const recovered = await runManager.awaitRun({
      run_id: runId,
      after_sequence: first.sequence,
      deadline_seconds: 5,
    });
    assert.equal(recovered.event, "turn.completed");
    assert.equal(
      (recovered as unknown as { report: { text: string } }).report.text,
      "recovered report",
    );
  });
});

test("completion envelope carries the versioned shape with report, elapsed_ms, and provider usage", async () => {
  const clock = new FakeClock(0);
  const scheduler = new FakeScheduler(clock);
  const harness = new TestHarness({ clock, scheduler });
  await harness.run(async ({ runManager, runId, adapter }) => {
    await runManager.start(runId);
    const cursor = runManager.inspect(runId)!.sequence;

    async function* scriptedTurn(): AsyncIterable<AdapterEvent> {
      yield {
        type: "message.completed",
        message_id: "message_1",
        role: "assistant",
        text: "complete final assistant message",
      };
      yield {
        type: "turn.completed",
        final_text: "complete final assistant message",
        provider_thread_id: "fake-thread-1",
        usage: { input_tokens: 10, output_tokens: 20 },
      };
    }
    adapter.options.scriptedEvents = [scriptedTurn()];

    const awaiting = runManager.awaitRun({
      run_id: runId,
      after_sequence: cursor,
      deadline_seconds: 5,
    });
    clock.advance(123_456);
    const turn = runManager.submit(runId, "work");
    const result = await awaiting;
    await turn;

    assert.deepEqual(result, {
      schema_version: 1,
      event: "turn.completed",
      run_id: runId,
      sequence: cursor + 3,
      phase: "ready",
      report: { text: "complete final assistant message" },
      elapsed_ms: 123_456,
      usage: { input_tokens: 10, output_tokens: 20 },
    });
    assert.equal("deltas" in result, false);
    assert.equal("tools" in result, false);
    assert.equal("raw_provider" in result, false);
    assert.equal("watchdog" in result, false);
    assert.equal("turn_id" in result, false);
    assert.equal("provider_thread_id" in result, false);
    assert.equal("payload" in result, false);
    assert.equal("reason" in result, false);
  });
});

test("completion envelope omits usage when the provider does not report it", async () => {
  const harness = new TestHarness();
  await harness.run(async ({ runManager, runId, adapter }) => {
    await runManager.start(runId);
    const cursor = runManager.inspect(runId)!.sequence;

    async function* scriptedTurn(): AsyncIterable<AdapterEvent> {
      yield {
        type: "message.completed",
        message_id: "message_1",
        role: "assistant",
        text: "no usage reported",
      };
      yield {
        type: "turn.completed",
        final_text: "no usage reported",
        provider_thread_id: "fake-thread-1",
      };
    }
    adapter.options.scriptedEvents = [scriptedTurn()];

    const turn = runManager.submit(runId, "work");
    const result = await runManager.awaitRun({
      run_id: runId,
      after_sequence: cursor,
      deadline_seconds: 5,
    });
    await turn;

    assert.equal(result.event, "turn.completed");
    assert.equal("usage" in result, false);
  });
});


test("successful completion with empty final text returns missing_final_report", async () => {
  const harness = new TestHarness();
  await harness.run(async ({ runManager, runId, adapter }) => {
    await runManager.start(runId);
    const cursor = runManager.inspect(runId)!.sequence;

    async function* scriptedTurn(): AsyncIterable<AdapterEvent> {
      yield {
        type: "turn.completed",
        final_text: "",
        provider_thread_id: "fake-thread-1",
      };
    }
    adapter.options.scriptedEvents = [scriptedTurn()];

    const awaiting = runManager.awaitRun({
      run_id: runId,
      after_sequence: cursor,
      deadline_seconds: 5,
    });
    const turn = runManager.submit(runId, "work");
    const result = await awaiting;
    await turn;

    assert.equal(result.event, "supervision.state");
    assert.equal(result.phase, "failed");
    assert.equal(result.reason, "missing_final_report");
  });
});

test("ninety-minute healthy run completes without an intermediate deadline wake", async () => {
  const clock = new FakeClock(0);
  const scheduler = new FakeScheduler(clock);
  const harness = new TestHarness({
    clock,
    scheduler,
    policy: x_DefaultSupervisionPolicy,
  });
  await harness.run(async ({ runManager, runId, adapter }) => {
    await runManager.start(runId);
    const cursor = runManager.inspect(runId)!.sequence;

    const afterSustainedProgress = deferred<void>();
    const releaseTurn = deferred<void>();
    async function* scriptedTurn(): AsyncIterable<AdapterEvent> {
      for (let minute = 1; minute <= x_RunDurationMs / x_ProgressIntervalMs; minute += 1) {
        clock.advance(x_ProgressIntervalMs);
        yield {
          type: "message.delta",
          message_id: "message_delta_1",
          role: "assistant",
          delta: `healthy progress minute ${minute}`,
        };
        await new Promise<void>((resolve) => {
          setImmediate(resolve);
        });
        if (minute === x_RunDurationMs / x_ProgressIntervalMs) {
          afterSustainedProgress.resolve(undefined);
        }
      }
      await releaseTurn.promise;
      yield {
        type: "message.completed",
        message_id: "message_1",
        role: "assistant",
        text: "long run done",
      };
      yield {
        type: "turn.completed",
        final_text: "long run done",
        provider_thread_id: "fake-thread-1",
      };
    }
    adapter.options.scriptedEvents = [scriptedTurn()];

    const awaiting = runManager.awaitRun({
      run_id: runId,
      after_sequence: cursor,
      deadline_seconds: x_DefaultAwaitDeadlineSeconds,
    });
    const turn = runManager.submit(runId, "long work");
    await afterSustainedProgress.promise;

    let settledDuringRun = false;
    void awaiting.then(() => {
      settledDuringRun = true;
    });
    await Promise.resolve();
    assert.equal(
      settledDuringRun,
      false,
      "healthy 90-minute run must not settle the await before turn completion",
    );

    releaseTurn.resolve(undefined);
    const result = await awaiting;
    await turn;

    assert.equal(result.event, "turn.completed");
    assert.notEqual(result.event, "supervision.deadline");
    assert.equal((result as unknown as { elapsed_ms: number }).elapsed_ms, x_RunDurationMs);
  });
});

test("aborting an await removes only the waiter and leaves the run owned", async () => {
  const harness = new TestHarness();
  await harness.run(async ({ runManager, runId }) => {
    await runManager.start(runId);
    const cursor = runManager.inspect(runId)!.sequence;

    const abort = new AbortController();
    const awaiting = runManager.awaitRun(
      {
        run_id: runId,
        after_sequence: cursor,
        deadline_seconds: 5,
      },
      abort.signal,
    );
    abort.abort();
    await assert.rejects(awaiting, { name: "AbortError" });
    assert.equal(runManager.has(runId), true);
    assert.equal(runManager.inspect(runId)?.phase, "ready");
  });
});

type ManagerContext = {
  readonly runManager: XagentRunManager;
  readonly runId: string;
  readonly adapter: FakeHarnessAdapter;
};

class TestHarness {
  private readonly clock?: FakeClock;
  private readonly scheduler?: FakeScheduler;
  private readonly policy: SupervisionPolicy;

  constructor(options?: {
    clock?: FakeClock;
    scheduler?: FakeScheduler;
    policy?: SupervisionPolicy;
  }) {
    this.clock = options?.clock;
    this.scheduler = options?.scheduler;
    this.policy = options?.policy ?? testPolicy;
  }

  async run(
    body: (context: ManagerContext) => Promise<void>,
  ): Promise<void> {
    const logRoot = await mkdtemp(path.join(tmpdir(), "xagent-await-"));
    const adapter = new FakeHarnessAdapter();
    const runManager = new XagentRunManager({
      repoRoot: process.cwd(),
      logRoot,
      adapterFactory: () => adapter,
      policy: this.policy,
      ...(this.clock === undefined ? {} : { clock: () => this.clock!.toDate() }),
      ...(this.scheduler === undefined
        ? {}
        : { scheduler: this.scheduler as SupervisionScheduler }),
    });
    const runId = "xrun_await_test";
    await runManager.create({
      runId,
      harness: "codex",
      mode: "subagent",
      cwd: process.cwd(),
    });
    try {
      await body({ runManager, runId, adapter });
    } finally {
      await runManager.closeAll();
    }
  }
}

class FakeClock {
  private ms: number;
  constructor(startMs: number) {
    this.ms = startMs;
  }
  advance(deltaMs: number): void {
    this.ms += deltaMs;
  }
  toMillis(): number {
    return this.ms;
  }
  toDate(): Date {
    return new Date(this.ms);
  }
}

class FakeScheduler implements SupervisionScheduler {
  private readonly timers = new Map<number, { callback: () => void; fireAt: number }>();
  private nextId = 0;
  private readonly clock: FakeClock;

  constructor(clock: FakeClock) {
    this.clock = clock;
  }

  setTimeout(callback: () => void, delayMs: number): number {
    this.nextId += 1;
    this.timers.set(this.nextId, {
      callback,
      fireAt: this.clock.toMillis() + Math.max(0, delayMs),
    });
    return this.nextId;
  }

  clearTimeout(handle: unknown): void {
    this.timers.delete(handle as number);
  }

  advance(deltaMs: number): void {
    this.clock.advance(deltaMs);
    const now = this.clock.toMillis();
    for (const [id, timer] of [...this.timers.entries()]) {
      if (timer.fireAt <= now) {
        this.timers.delete(id);
        timer.callback();
      }
    }
  }
}

function deferred<T = void>(): {
  promise: Promise<T>;
  resolve(value: T): void;
} {
  let resolvePromise: ((value: T) => void) | undefined;
  const promise = new Promise<T>((resolve) => {
    resolvePromise = resolve;
  });
  return {
    promise,
    resolve(value: T) {
      resolvePromise!(value);
    },
  };
}

test("worker-facing prompt text rejects embedded controller run ids", () => {
  const leaked = ImplementerStartSchema.safeParse({
    role: "implementer",
    cwd: "/tmp/worktree",
    plan: "/tmp/plan.md",
    agent: "grok-4.5",
    harness: "cursor",
    effort: "high",
    task: 4,
    name: "Superpowers managed plugins",
    brief: "/tmp/brief.md",
    report: "/tmp/report.md",
    context: "Keep the reviewer session xrun_20260727192847117_b30af348 open for re-review.",
  });
  assert.equal(leaked.success, false);
  assert.match(
    leaked.error?.issues.map((issue) => issue.message).join("; ") ?? "",
    /xrun_20260727192847117_b30af348/,
  );

  const clean = ImplementerStartSchema.safeParse({
    role: "implementer",
    cwd: "/tmp/worktree",
    plan: "/tmp/plan.md",
    agent: "grok-4.5",
    harness: "cursor",
    effort: "high",
    task: 4,
    name: "Superpowers managed plugins",
    brief: "/tmp/brief.md",
    report: "/tmp/report.md",
    context: "Task 3 is complete. Implement Task 4 only.",
  });
  assert.equal(clean.success, true);
});

test("fix follow-up findings text rejects embedded controller run ids", () => {
  const leaked = FixFollowupSchema.safeParse({
    kind: "fix",
    agent_id: "xrun_20260726000000000_00000001",
    round: 1,
    findings: "/tmp/findings.md",
    findings_text: "Resume against xrun_20260727192847117_b30af348 when done.",
    tests: ["npm test"],
  });
  assert.equal(leaked.success, false);

  const clean = FixFollowupSchema.safeParse({
    kind: "fix",
    agent_id: "xrun_20260726000000000_00000001",
    round: 1,
    findings: "/tmp/findings.md",
    findings_text: "Important #1: the marker must follow the frontmatter.",
    tests: ["npm test"],
  });
  assert.equal(clean.success, true);
});

test("the run-id guard exempts backtick-quoted ids and covers message and prompt", () => {
  // Quoting xagent's own run ids is legitimate when xagent is the subject.
  assert.equal(
    ImplementerStartSchema.safeParse({
      role: "implementer",
      cwd: "/tmp/worktree",
      plan: "/tmp/plan.md",
      agent: "grok-4.5",
      harness: "cursor",
      effort: "high",
      task: 4,
      name: "Superpowers managed plugins",
      brief: "/tmp/brief.md",
      report: "/tmp/report.md",
      note: "A cancelled sibling `xrun_20260727192847117_b30af348` left work in the tree.",
    }).success,
    true,
  );

  assert.equal(
    XagentMessageInputSchema.safeParse({
      run_id: "xrun_20260726000000000_00000001",
      text: "Keep xrun_20260727192847117_b30af348 open for re-review.",
    }).success,
    false,
  );
  assert.equal(
    XagentStartInputSchema.safeParse({
      cwd: "/tmp",
      prompt: "Resume against xrun_20260727192847117_b30af348.",
      harness: "cursor",
    }).success,
    false,
  );
});

test("turn.submitted never wakes a live await", async () => {
  const service = await startMcpService();
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
    schema_version: 1 as const,
    type: "turn.submitted" as const,
    run_id: "xrun_20260728000000000_0000abcd",
    sequence: 4,
    timestamp: "2026-07-28T00:00:00.000Z",
    phase: "running" as const,
    reason: "turn_submitted",
    payload: { text: "hello", turn_id: "turn_1" },
  };
  assert.equal(isPersistedAwaitWake(event), false);
});

async function startMcpService(): Promise<{
  startRun(prompt: string): Promise<{ run_id: string; sequence: number }>;
  await(
    runId: string,
    afterSequence: number,
    deadlineSeconds: number,
  ): Promise<{ event: string }>;
  submit(runId: string, text: string): Promise<void>;
  close(): Promise<void>;
}> {
  const logRoot = await mkdtemp(path.join(tmpdir(), "xagent-await-filter-"));
  const cwd = await mkdtemp(path.join(tmpdir(), "xagent-await-cwd-"));
  const runManager = new XagentRunManager({
    repoRoot: process.cwd(),
    logRoot,
    adapterFactory: () => new FakeHarnessAdapter(),
    policy: testPolicy,
  });
  return {
    startRun(prompt: string) {
      return runManager.startRun({
        cwd,
        prompt,
        harness: "codex",
        mode: "subagent",
      });
    },
    await(runId: string, afterSequence: number, deadlineSeconds: number) {
      return runManager.awaitRun({
        run_id: runId,
        after_sequence: afterSequence,
        deadline_seconds: deadlineSeconds,
      });
    },
    submit(runId: string, text: string) {
      return runManager.submit(runId, text);
    },
    async close() {
      await runManager.closeAll();
    },
  };
}