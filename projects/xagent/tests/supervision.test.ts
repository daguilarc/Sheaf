import assert from "node:assert/strict";
import test from "node:test";

import { FakeHarnessAdapter } from "../src/adapters/fake.js";
import type {
  HarnessAdapter,
  HarnessCapabilities,
  HarnessSession,
  HarnessStartOptions,
} from "../src/adapters/types.js";
import { SequencedEventQueue } from "../src/supervision/event_queue.js";
import { Supervisor } from "../src/supervision/supervisor.js";
import type {
  SupervisionEvent,
  SupervisionPersistenceState,
  SupervisionPolicy,
} from "../src/supervision/types.js";

const policy: SupervisionPolicy = {
  silenceTimeoutMs: 300_000,
  watchdog: {},
};

test("supervisor persists monotonic lifecycle state and delivers turn completion after its cursor", async () => {
  const events: SupervisionEvent[] = [];
  const metadata: SupervisionPersistenceState[] = [];
  const adapter = new FakeHarnessAdapter({
    scriptedEvents: [[
      {
        type: "message.completed",
        role: "assistant",
        message_id: "message_scripted",
        text: "scripted final report",
      },
      {
        type: "turn.completed",
        final_text: "",
        provider_thread_id: "fake-thread-1",
      },
    ]],
  });
  const supervisor = new Supervisor({
    runId: "xrun_supervision",
    adapter,
    startOptions: { cwd: "/tmp" },
    policy,
    clock: fixedClock,
    eventSink: async (event) => {
      events.push(event);
    },
    metadataSink: async (state) => {
      metadata.push(structuredClone(state));
    },
  });

  assert.deepEqual(supervisor.inspect(), {
    run_id: "xrun_supervision",
    phase: "starting",
    sequence: 1,
    provider_thread_id: undefined,
  });

  await supervisor.start();
  assert.equal(supervisor.inspect().phase, "ready");
  const first = await supervisor.awaitEvent(0, 1_000);
  assert.deepEqual(first, {
    schema_version: 1,
    type: "supervision.state",
    run_id: "xrun_supervision",
    sequence: 2,
    timestamp: "2026-07-25T12:00:00.000Z",
    phase: "ready",
    reason: "session_ready",
  });

  const second = supervisor.awaitEvent(first.sequence, 1_000);
  await supervisor.submit("do the task");
  assert.deepEqual(await second, {
    schema_version: 1,
    type: "turn.completed",
    run_id: "xrun_supervision",
    sequence: 4,
    timestamp: "2026-07-25T12:00:00.000Z",
    phase: "ready",
    reason: "turn_completed",
    payload: {
      report: { text: "scripted final report" },
      turn_id: "turn_1",
      provider_thread_id: "fake-thread-1",
    },
  });
  assert.deepEqual(events.map((event) => [event.sequence, event.phase, event.type]), [
    [1, "starting", "supervision.state"],
    [2, "ready", "supervision.state"],
    [3, "running", "supervision.state"],
    [4, "ready", "turn.completed"],
  ]);
  assert.deepEqual(metadata.map((state) => [state.sequence, state.phase]), [
    [1, "starting"],
    [2, "ready"],
    [3, "running"],
    [4, "ready"],
  ]);
  assert.deepEqual(adapter.submittedContexts, [
    { text: "do the task", turnId: "turn_1", inputSequence: 1 },
  ]);
});

test("attention is durable and does not replace the active lifecycle phase", async () => {
  const supervisor = new Supervisor({
    runId: "xrun_attention",
    adapter: new FakeHarnessAdapter(),
    startOptions: { cwd: "/tmp" },
    policy,
    clock: fixedClock,
  });
  await supervisor.start();

  const cursor = supervisor.inspect().sequence;
  await supervisor.publishAttention("controller_input_required", { prompt: "approve?" });
  const attention = await supervisor.awaitEvent(cursor, 1_000);

  assert.equal(supervisor.inspect().phase, "ready");
  assert.deepEqual(attention, {
    schema_version: 1,
    type: "supervision.attention",
    run_id: "xrun_attention",
    sequence: 3,
    timestamp: "2026-07-25T12:00:00.000Z",
    phase: "ready",
    reason: "controller_input_required",
    payload: { prompt: "approve?" },
  });
});

test("terminal state is durable and later lifecycle commands cannot revive it", async () => {
  const adapter = new FakeHarnessAdapter({ supportsInterrupt: true });
  const supervisor = new Supervisor({
    runId: "xrun_terminal",
    adapter,
    startOptions: { cwd: "/tmp" },
    policy,
    clock: fixedClock,
  });
  await supervisor.start();
  await supervisor.close();

  assert.equal(supervisor.inspect().phase, "completed");
  await assert.rejects(() => supervisor.start(), /completed/);
  await assert.rejects(() => supervisor.submit("too late"), /completed/);
  await assert.rejects(() => supervisor.interrupt(), /completed/);
  assert.equal(supervisor.inspect().phase, "completed");
  assert.equal(adapter.closeCount, 1);
});

test("cancelling an await removes only that waiter and leaves run state unchanged", async () => {
  const supervisor = new Supervisor({
    runId: "xrun_cancel_await",
    adapter: new FakeHarnessAdapter(),
    startOptions: { cwd: "/tmp" },
    policy,
    clock: fixedClock,
  });
  await supervisor.start();
  const before = supervisor.inspect();
  const abort = new AbortController();
  const awaiting = supervisor.awaitEvent(before.sequence, 1_000, abort.signal);

  abort.abort();

  await assert.rejects(awaiting, { name: "AbortError" });
  assert.deepEqual(supervisor.inspect(), before);
});

test("await deadline is non-durable and does not change lifecycle state or cursor", async () => {
  const scheduler = new FakeScheduler();
  const supervisor = new Supervisor({
    runId: "xrun_deadline",
    adapter: new FakeHarnessAdapter(),
    startOptions: { cwd: "/tmp" },
    policy,
    clock: fixedClock,
    scheduler,
  });
  await supervisor.start();
  const before = supervisor.inspect();

  const awaiting = supervisor.awaitEvent(before.sequence, 60_000);
  await scheduler.waitUntilScheduled();
  scheduler.runNext();
  const deadline = await awaiting;

  assert.deepEqual(deadline, {
    schema_version: 1,
    type: "supervision.deadline",
    run_id: "xrun_deadline",
    sequence: before.sequence,
    timestamp: "2026-07-25T12:00:00.000Z",
    phase: "ready",
    reason: "await_deadline",
  });
  assert.deepEqual(supervisor.inspect(), before);
});

test("supervisor rejects a concurrent turn and delegates interrupt to a supported session", async () => {
  const scriptStarted = deferred<void>();
  const releaseScript = deferred<void>();
  async function* blockedTurn() {
    scriptStarted.resolve(undefined);
    await releaseScript.promise;
    yield {
      type: "message.completed" as const,
      role: "assistant" as const,
      message_id: "message_interrupted",
      text: "stopped cleanly",
    };
    yield {
      type: "turn.completed" as const,
      final_text: "stopped cleanly",
    };
  }
  const adapter = new FakeHarnessAdapter({
    supportsInterrupt: true,
    scriptedEvents: [blockedTurn()],
  });
  const supervisor = new Supervisor({
    runId: "xrun_interrupt",
    adapter,
    startOptions: { cwd: "/tmp" },
    policy,
    clock: fixedClock,
  });
  await supervisor.start();
  const firstTurn = supervisor.submit("first");
  await scriptStarted.promise;

  await assert.rejects(() => supervisor.submit("second"), /running/);
  await supervisor.interrupt();
  assert.equal(adapter.interruptCount, 1);

  releaseScript.resolve(undefined);
  await firstTurn;
  assert.equal(supervisor.inspect().phase, "ready");
  assert.deepEqual(adapter.submittedTexts, ["first"]);

  const unsupportedSession = await new FakeHarnessAdapter().start({ cwd: "/tmp" });
  assert.equal(unsupportedSession.interrupt, undefined);
});

test("event queue wakes cursor-behind waiters only after the event sink is durable", async () => {
  const sinkStarted = deferred<void>();
  const releaseSink = deferred<void>();
  const queue = new SequencedEventQueue(
    "xrun_queue",
    async () => {
      sinkStarted.resolve(undefined);
      await releaseSink.promise;
    },
    fixedClock,
  );
  let delivered = false;
  const published = queue.publish({
    type: "supervision.attention",
    phase: "running",
    reason: "needs_attention",
  });
  const awaiting = queue.awaitEvent(0, 1_000).then((event) => {
    delivered = true;
    return event;
  });
  await sinkStarted.promise;
  assert.equal(delivered, false);

  releaseSink.resolve(undefined);

  const event = await published;
  assert.deepEqual(await awaiting, event);
});

test("concurrent start calls cannot create more than one harness session", async () => {
  const adapter = new FakeHarnessAdapter();
  const supervisor = new Supervisor({
    runId: "xrun_start_once",
    adapter,
    startOptions: { cwd: "/tmp" },
    policy,
    clock: fixedClock,
  });

  const first = supervisor.start();
  const second = supervisor.start();

  await assert.rejects(second, /already been requested/);
  await first;
  assert.equal(adapter.startCount, 1);
});

test("close keeps terminal state durable when an in-flight turn iterator settles later", async () => {
  const scriptStarted = deferred<void>();
  const releaseScript = deferred<void>();
  async function* blockedTurn() {
    scriptStarted.resolve(undefined);
    await releaseScript.promise;
    yield {
      type: "message.completed" as const,
      role: "assistant" as const,
      message_id: "message_after_close",
      text: "late report",
    };
    yield {
      type: "turn.completed" as const,
      final_text: "late report",
    };
  }
  const supervisor = new Supervisor({
    runId: "xrun_close_active",
    adapter: new FakeHarnessAdapter({ scriptedEvents: [blockedTurn()] }),
    startOptions: { cwd: "/tmp" },
    policy,
    clock: fixedClock,
  });
  await supervisor.start();
  const turn = supervisor.submit("work");
  await scriptStarted.promise;

  await supervisor.close();
  releaseScript.resolve(undefined);
  await turn;

  assert.equal(supervisor.inspect().phase, "completed");
});

test("close waits for pending start and concurrent closes close the opened session once", async () => {
  const adapter = new StartBlockedAdapter();
  const supervisor = new Supervisor({
    runId: "xrun_close_during_start",
    adapter,
    startOptions: { cwd: "/tmp" },
    policy,
    clock: fixedClock,
  });
  const starting = supervisor.start();
  await adapter.startCalled.promise;

  const firstClose = supervisor.close();
  const secondClose = supervisor.close();
  adapter.releaseStart.resolve(undefined);

  await Promise.all([starting, firstClose, secondClose]);
  assert.equal(adapter.startCount, 1);
  assert.equal(adapter.closeCount, 1);
  assert.deepEqual(supervisor.inspect(), {
    run_id: "xrun_close_during_start",
    phase: "completed",
    sequence: 3,
    provider_thread_id: "blocked-thread",
  });
});

test("inspect and await remain at prior state until event and metadata sinks both persist", async () => {
  const readyMetadataStarted = deferred<void>();
  const releaseReadyMetadata = deferred<void>();
  const supervisor = new Supervisor({
    runId: "xrun_metadata_delay",
    adapter: new FakeHarnessAdapter(),
    startOptions: { cwd: "/tmp" },
    policy,
    clock: fixedClock,
    metadataSink: async (state) => {
      if (state.phase === "ready") {
        readyMetadataStarted.resolve(undefined);
        await releaseReadyMetadata.promise;
      }
    },
  });
  const starting = supervisor.start();
  await readyMetadataStarted.promise;
  const awaiting = supervisor.awaitEvent(1, 1_000);
  let delivered = false;
  void awaiting.then(() => {
    delivered = true;
  });
  await Promise.resolve();

  assert.deepEqual(supervisor.inspect(), {
    run_id: "xrun_metadata_delay",
    phase: "starting",
    sequence: 1,
    provider_thread_id: undefined,
  });
  assert.equal(delivered, false);

  releaseReadyMetadata.resolve(undefined);
  await starting;
  assert.equal((await awaiting).phase, "ready");
  assert.deepEqual(supervisor.inspect(), {
    run_id: "xrun_metadata_delay",
    phase: "ready",
    sequence: 2,
    provider_thread_id: "fake-thread-1",
  });
});

test("metadata persistence failure rejects transition waiters and leaves inspection committed", async () => {
  const metadataFailure = new Error("metadata persistence failed");
  const adapter = new FakeHarnessAdapter();
  const supervisor = new Supervisor({
    runId: "xrun_metadata_failure",
    adapter,
    startOptions: { cwd: "/tmp" },
    policy,
    clock: fixedClock,
    metadataSink: async (state) => {
      if (state.phase === "ready") {
        throw metadataFailure;
      }
    },
  });
  const awaiting = supervisor.awaitEvent(1, 1_000);

  await assert.rejects(supervisor.start(), metadataFailure);
  await assert.rejects(awaiting, metadataFailure);
  assert.deepEqual(supervisor.inspect(), {
    run_id: "xrun_metadata_failure",
    phase: "starting",
    sequence: 1,
    provider_thread_id: undefined,
  });
  assert.equal(adapter.closeCount, 1);
});

test("concurrent close calls share a close failure without closing the session twice", async () => {
  const adapter = new CloseFailingAdapter();
  const supervisor = new Supervisor({
    runId: "xrun_close_failure_once",
    adapter,
    startOptions: { cwd: "/tmp" },
    policy,
    clock: fixedClock,
  });
  await supervisor.start();

  const firstClose = supervisor.close();
  const secondClose = supervisor.close();
  const results = await Promise.allSettled([firstClose, secondClose]);

  assert.deepEqual(results.map((result) => result.status), ["rejected", "rejected"]);
  assert.equal(adapter.closeCount, 1);
});

function fixedClock(): Date {
  return new Date("2026-07-25T12:00:00.000Z");
}

function deferred<T>(): {
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
      assert.ok(resolvePromise);
      resolvePromise(value);
    },
  };
}

class FakeScheduler {
  readonly #scheduled = deferred<void>();
  readonly #callbacks = new Map<number, () => void>();
  #nextId = 0;

  setTimeout(callback: () => void, _delayMs: number): number {
    this.#nextId += 1;
    this.#callbacks.set(this.#nextId, callback);
    this.#scheduled.resolve(undefined);
    return this.#nextId;
  }

  clearTimeout(handle: unknown): void {
    assert.equal(typeof handle, "number");
    this.#callbacks.delete(handle as number);
  }

  waitUntilScheduled(): Promise<void> {
    return this.#scheduled.promise;
  }

  runNext(): void {
    const next = this.#callbacks.entries().next().value as [number, () => void] | undefined;
    assert.ok(next);
    this.#callbacks.delete(next[0]);
    next[1]();
  }
}

class StartBlockedAdapter implements HarnessAdapter {
  readonly harness = "codex";
  readonly capabilities: HarnessCapabilities = {
    forwardsModel: true,
    forwardsThinkingLevel: true,
    streamsDeltas: true,
  };
  readonly startCalled = deferred<void>();
  readonly releaseStart = deferred<void>();
  startCount = 0;
  closeCount = 0;

  async start(_options: HarnessStartOptions): Promise<HarnessSession> {
    this.startCount += 1;
    this.startCalled.resolve(undefined);
    await this.releaseStart.promise;
    return {
      providerThreadId: "blocked-thread",
      submit: async function* () {},
      close: async () => {
        this.closeCount += 1;
      },
    };
  }
}

class CloseFailingAdapter implements HarnessAdapter {
  readonly harness = "codex";
  readonly capabilities: HarnessCapabilities = {
    forwardsModel: true,
    forwardsThinkingLevel: true,
    streamsDeltas: true,
  };
  closeCount = 0;

  async start(_options: HarnessStartOptions): Promise<HarnessSession> {
    return {
      providerThreadId: "close-failure-thread",
      submit: async function* () {},
      close: async () => {
        this.closeCount += 1;
        throw new Error("session close failed");
      },
    };
  }
}
