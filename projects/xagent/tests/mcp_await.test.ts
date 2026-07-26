import assert from "node:assert/strict";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";

import { FakeHarnessAdapter } from "../src/adapters/fake.js";
import type { AdapterEvent } from "../src/adapters/types.js";
import { XagentRunManager } from "../src/service/run_manager.js";
import {
  x_DefaultAwaitDeadlineSeconds,
  x_MaxAwaitDeadlineSeconds,
  XagentAwaitInputSchema,
} from "../src/service/tool_schemas.js";
import type { SupervisionPolicy, SupervisionScheduler } from "../src/supervision/types.js";

const testPolicy: SupervisionPolicy = {
  silenceTimeoutMs: 600_000,
  watchdog: {},
};

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

test("completion envelope carries the versioned shape with report and elapsed_ms only", async () => {
  const clock = new FakeClock(0);
  const scheduler = new FakeScheduler(clock);
  const harness = new TestHarness({ clock, scheduler });
  await harness.run(async ({ runManager, runId, adapter }) => {
    await runManager.start(runId);
    const cursor = runManager.inspect(runId)!.sequence;

    for (let i = 0; i < 38; i += 1) {
      await runManager.publishAttention(runId, `attention_${i}`, { index: i });
    }
    const runningSequence = runManager.inspect(runId)!.sequence;

    const releaseTurn = deferred<void>();
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
      after_sequence: runningSequence,
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
      sequence: runningSequence + 2,
      phase: "ready",
      report: { text: "complete final assistant message" },
      elapsed_ms: 123_456,
    });
    assert.equal("deltas" in result, false);
    assert.equal("tools" in result, false);
    assert.equal("raw_provider" in result, false);
    assert.equal("watchdog" in result, false);
    assert.equal("turn_id" in result, false);
    assert.equal("provider_thread_id" in result, false);
    assert.equal("usage" in result, false);
    assert.equal("payload" in result, false);
    assert.equal("reason" in result, false);
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
  const harness = new TestHarness({ clock, scheduler });
  await harness.run(async ({ runManager, runId, adapter }) => {
    await runManager.start(runId);
    const cursor = runManager.inspect(runId)!.sequence;

    const releaseTurn = deferred<void>();
    async function* scriptedTurn(): AsyncIterable<AdapterEvent> {
      yield {
        type: "message.delta",
        message_id: "message_delta_1",
        role: "assistant",
        delta: "working",
      };
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
    scheduler.advance(90 * 60 * 1000);
    releaseTurn.resolve(undefined);
    const result = await awaiting;
    await turn;

    assert.equal(result.event, "turn.completed");
    assert.equal((result as unknown as { elapsed_ms: number }).elapsed_ms, 90 * 60 * 1000);
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

  constructor(options?: { clock?: FakeClock; scheduler?: FakeScheduler }) {
    this.clock = options?.clock;
    this.scheduler = options?.scheduler;
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
      policy: testPolicy,
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
