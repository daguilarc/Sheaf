import assert from "node:assert/strict";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";

import { FakeHarnessAdapter } from "../src/adapters/fake.js";
import type { AdapterEvent } from "../src/adapters/types.js";
import {
  StartAwaitLivenessPings,
  x_AwaitLivenessPingIntervalMs,
} from "../src/service/await_liveness.js";
import { XagentRunManager } from "../src/service/run_manager.js";
import { Supervisor } from "../src/supervision/supervisor.js";
import type {
  SupervisionPolicy,
  SupervisionScheduler,
} from "../src/supervision/types.js";
import { ProgressNotificationSchema } from "@modelcontextprotocol/sdk/types.js";
import { startMcpService } from "./support/mcp_service.js";

const x_ShortPingIntervalMs = 40;
const x_ShortSilenceTimeoutMs = 250;

test("await liveness ping cadence is at most 30 seconds", () => {
  assert.ok(x_AwaitLivenessPingIntervalMs <= 30_000);
  assert.ok(x_AwaitLivenessPingIntervalMs > 0);
});

test("supervisor vouches only while phase is live and progress is within silence bound", async () => {
  const clock = new FakeClock(0);
  const supervisor = new Supervisor({
    runId: "xrun_vouch",
    adapter: new FakeHarnessAdapter(),
    startOptions: { cwd: process.cwd() },
    policy: { silenceTimeoutMs: 1_000, watchdog: {} },
    clock: () => clock.toDate(),
    eventSink: async () => {},
    metadataSink: async () => {},
  });

  assert.equal(supervisor.isVouching(), true);

  clock.advance(999);
  assert.equal(supervisor.isVouching(), true);

  clock.advance(1);
  assert.equal(
    supervisor.isVouching(),
    false,
    "silence-bound breach must stop vouching",
  );

  await supervisor.start();
  await supervisor.close();
  assert.equal(
    supervisor.isVouching(),
    false,
    "terminal phase must stop vouching",
  );
});

test("run manager exposes vouching without leaking supervisor internals", async () => {
  const logRoot = await mkdtemp(path.join(tmpdir(), "xagent-vouch-"));
  const clock = new FakeClock(0);
  const runManager = new XagentRunManager({
    repoRoot: process.cwd(),
    logRoot,
    adapterFactory: () => new FakeHarnessAdapter(),
    clock: () => clock.toDate(),
    policy: { silenceTimeoutMs: 500, watchdog: {} },
  });
  const { runId } = await runManager.create({
    runId: "xrun_manager_vouch",
    harness: "codex",
    mode: "subagent",
    cwd: process.cwd(),
  });
  try {
    assert.equal(runManager.isRunVouching(runId), true);
    assert.equal(runManager.isRunVouching("xrun_missing"), false);
    clock.advance(500);
    assert.equal(runManager.isRunVouching(runId), false);
  } finally {
    await runManager.closeAll();
  }
});

test("liveness pings emit while vouching and stop without a goodbye when vouching ends", async () => {
  const sent: number[] = [];
  let vouching = true;
  const clock = new FakeClock(0);
  const scheduler = new FakeScheduler(clock);
  const stop = StartAwaitLivenessPings({
    progressToken: "tok-1",
    intervalMs: 1_000,
    isVouching: () => vouching,
    sendNotification: async (notification) => {
      assert.equal(notification.method, "notifications/progress");
      assert.equal(notification.params.progressToken, "tok-1");
      sent.push(notification.params.progress);
    },
    signal: new AbortController().signal,
    scheduler,
  });

  scheduler.advance(1_000);
  await flushMicrotasks();
  assert.equal(sent.length, 1);

  scheduler.advance(1_000);
  await flushMicrotasks();
  assert.equal(sent.length, 2);

  vouching = false;
  scheduler.advance(1_000);
  await flushMicrotasks();
  assert.equal(
    sent.length,
    2,
    "stopping vouching must not emit a goodbye ping",
  );

  stop();
  scheduler.advance(1_000);
  await flushMicrotasks();
  assert.equal(sent.length, 2);
});

test("liveness pings do not fire after the await signal aborts", async () => {
  const sent: number[] = [];
  const clock = new FakeClock(0);
  const scheduler = new FakeScheduler(clock);
  const abort = new AbortController();
  StartAwaitLivenessPings({
    progressToken: 7,
    intervalMs: 1_000,
    isVouching: () => true,
    sendNotification: async (notification) => {
      sent.push(notification.params.progress);
    },
    signal: abort.signal,
    scheduler,
  });

  scheduler.advance(1_000);
  await flushMicrotasks();
  assert.equal(sent.length, 1);

  abort.abort();
  scheduler.advance(1_000);
  await flushMicrotasks();
  assert.equal(sent.length, 1);
});

test("xagent_await with progressToken emits pings that do not settle the await", async () => {
  const releaseTurn = deferred<void>();
  async function* scriptedTurn(): AsyncIterable<AdapterEvent> {
    yield {
      type: "message.delta",
      message_id: "m1",
      role: "assistant",
      delta: "still working",
    };
    await releaseTurn.promise;
    yield {
      type: "message.completed",
      message_id: "m1",
      role: "assistant",
      text: "done after pings",
    };
    yield {
      type: "turn.completed",
      final_text: "done after pings",
      provider_thread_id: "fake-thread-pings",
    };
  }

  const service = await startMcpService({
    adapterFactory: () => new FakeHarnessAdapter({ scriptedEvents: [scriptedTurn()] }),
    policy: {
      silenceTimeoutMs: 600_000,
      watchdog: {},
    },
    awaitLivenessPingIntervalMs: x_ShortPingIntervalMs,
  });

  try {
    const started = await service.startRun("hold for pings");
    const client = await service.ensureClient();
    const progressEvents: number[] = [];
    let settled = false;

    const awaiting = client.callTool(
      {
        name: "xagent_await",
        arguments: {
          run_id: started.run_id,
          after_sequence: started.sequence,
          deadline_seconds: 30,
        },
      },
      undefined,
      {
        timeout: 30_000,
        resetTimeoutOnProgress: true,
        onprogress: (progress) => {
          progressEvents.push(progress.progress);
        },
      },
    ).then((result) => {
      settled = true;
      return result;
    });

    await sleep(x_ShortPingIntervalMs * 3);
    assert.equal(settled, false, "pings must not resolve the await");
    assert.ok(
      progressEvents.length >= 2,
      `expected at least 2 pings before completion, got ${progressEvents.length}`,
    );

    releaseTurn.resolve(undefined);
    const result = await awaiting;
    assert.equal(settled, true);
    const body = result.structuredContent as { event?: string; report?: { text: string } };
    assert.equal(body.event, "turn.completed");
    assert.equal(body.report?.text, "done after pings");
  } finally {
    await service.close();
  }
});

test("xagent_await without progressToken emits no progress notifications", async () => {
  const releaseTurn = deferred<void>();
  async function* scriptedTurn(): AsyncIterable<AdapterEvent> {
    yield {
      type: "message.delta",
      message_id: "m1",
      role: "assistant",
      delta: "quiet hold",
    };
    await releaseTurn.promise;
    yield {
      type: "message.completed",
      message_id: "m1",
      role: "assistant",
      text: "done quiet",
    };
    yield {
      type: "turn.completed",
      final_text: "done quiet",
      provider_thread_id: "fake-thread-quiet",
    };
  }

  const service = await startMcpService({
    adapterFactory: () => new FakeHarnessAdapter({ scriptedEvents: [scriptedTurn()] }),
    awaitLivenessPingIntervalMs: x_ShortPingIntervalMs,
  });

  try {
    const started = await service.startRun("no token");
    const client = await service.ensureClient();
    const progressNotifications: unknown[] = [];
    client.setNotificationHandler(ProgressNotificationSchema, (notification) => {
      progressNotifications.push(notification);
    });

    const awaiting = client.callTool(
      {
        name: "xagent_await",
        arguments: {
          run_id: started.run_id,
          after_sequence: started.sequence,
          deadline_seconds: 30,
        },
      },
      undefined,
      { timeout: 30_000 },
    );

    await sleep(x_ShortPingIntervalMs * 3);
    assert.equal(
      progressNotifications.length,
      0,
      "no progressToken means no liveness pings",
    );

    releaseTurn.resolve(undefined);
    const result = await awaiting;
    const body = result.structuredContent as { event?: string };
    assert.equal(body.event, "turn.completed");
    assert.equal(progressNotifications.length, 0);
  } finally {
    await service.close();
  }
});

test("liveness pings stop once the supervisor stops vouching for silence", async () => {
  const releaseTurn = deferred<void>();
  async function* scriptedTurn(): AsyncIterable<AdapterEvent> {
    yield {
      type: "message.delta",
      message_id: "m1",
      role: "assistant",
      delta: "one burst then silence",
    };
    await releaseTurn.promise;
    yield {
      type: "message.completed",
      message_id: "m1",
      role: "assistant",
      text: "unreachable if await already woke",
    };
    yield {
      type: "turn.completed",
      final_text: "unreachable if await already woke",
      provider_thread_id: "fake-thread-silence",
    };
  }

  const service = await startMcpService({
    adapterFactory: () => new FakeHarnessAdapter({ scriptedEvents: [scriptedTurn()] }),
    policy: {
      silenceTimeoutMs: x_ShortSilenceTimeoutMs,
      watchdog: {},
    },
    awaitLivenessPingIntervalMs: x_ShortPingIntervalMs,
  });

  try {
    const started = await service.startRun("silence ends vouching");
    const client = await service.ensureClient();
    const progressEvents: number[] = [];

    // This await may settle on silence attention; either way pings must stop
    // once vouching ends. Capture the post-silence window explicitly.
    //
    const awaiting = client.callTool(
      {
        name: "xagent_await",
        arguments: {
          run_id: started.run_id,
          after_sequence: started.sequence,
          deadline_seconds: 30,
        },
      },
      undefined,
      {
        timeout: 30_000,
        resetTimeoutOnProgress: true,
        onprogress: (progress) => {
          progressEvents.push(progress.progress);
        },
      },
    );

    await sleep(x_ShortPingIntervalMs * 2);
    const pingsWhileVouching = progressEvents.length;
    assert.ok(
      pingsWhileVouching >= 1,
      "need at least one ping while still vouching",
    );

    await sleep(x_ShortSilenceTimeoutMs + x_ShortPingIntervalMs * 3);
    const pingsAfterSilenceWindow = progressEvents.length;
    await sleep(x_ShortPingIntervalMs * 3);
    assert.equal(
      progressEvents.length,
      pingsAfterSilenceWindow,
      "pings must stop after the silence bound breaches vouching",
    );

    await awaiting.catch(() => {});
    releaseTurn.resolve(undefined);
  } finally {
    await service.close();
  }
});

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

async function flushMicrotasks(): Promise<void> {
  for (let i = 0; i < 5; i += 1) {
    await Promise.resolve();
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
