import assert from "node:assert/strict";
import test from "node:test";

import {
  DeterministicHealthMonitor,
  type DeterministicHealthClassification,
} from "../src/supervision/health.js";
import { FakeHarnessAdapter } from "../src/adapters/fake.js";
import { Supervisor } from "../src/supervision/supervisor.js";
import type { SupervisionScheduler } from "../src/supervision/types.js";

test("mechanical worker states classify without consulting a semantic classifier", () => {
  const classifier = new ClassifierSpy();
  const clock = new FakeClock();
  const classifications: DeterministicHealthClassification[] = [];
  const monitor = new DeterministicHealthMonitor({
    silenceTimeoutMs: 300_000,
    clock: clock.now,
    scheduler: clock,
    onClassification: (classification) => {
      classifications.push(classification);
    },
  });

  assert.equal(monitor.recordMechanicalEvent({ type: "process.spawned" }), undefined);
  assert.deepEqual(monitor.recordMechanicalEvent({
    type: "process.exited",
    exitCode: 17,
    signal: null,
  }), {
    kind: "failure",
    reason: "process_exit",
    payload: { exit_code: 17, signal: null },
  });
  assert.equal(classifier.calls.length, 0);

  assert.deepEqual(monitor.recordMechanicalEvent({ type: "provider.completed" }), {
    kind: "completion",
    reason: "provider_completed",
  });
  assert.equal(classifier.calls.length, 0);

  assert.deepEqual(monitor.recordMechanicalEvent({
    type: "provider.failed",
    code: "provider_refused",
    message: "provider refused the turn",
  }), {
    kind: "failure",
    reason: "provider_refused",
    payload: { message: "provider refused the turn" },
  });
  assert.equal(classifier.calls.length, 0);

  assert.deepEqual(monitor.recordMechanicalEvent({
    type: "transport.lost",
    message: "stdout closed",
  }), {
    kind: "failure",
    reason: "transport_loss",
    payload: { message: "stdout closed" },
  });
  assert.equal(classifier.calls.length, 0);

  assert.deepEqual(monitor.recordMechanicalEvent({
    type: "input.required",
    prompt: "Choose a migration.",
  }), {
    kind: "attention",
    reason: "input_required",
    payload: { prompt: "Choose a migration." },
  });
  assert.equal(classifier.calls.length, 0);

  assert.deepEqual(monitor.recordMechanicalEvent({
    type: "permission.required",
    permission: "write",
  }), {
    kind: "attention",
    reason: "permission_required",
    payload: { permission: "write" },
  });
  assert.equal(classifier.calls.length, 0);

  assert.deepEqual(monitor.recordMechanicalEvent({ type: "cancelled" }), {
    kind: "cancellation",
    reason: "cancelled",
  });
  assert.equal(classifier.calls.length, 0);
  assert.deepEqual(classifications, []);
});

test("five minutes without provider activity emits one deterministic silence attention", () => {
  const classifier = new ClassifierSpy();
  const clock = new FakeClock();
  const classifications: DeterministicHealthClassification[] = [];
  const monitor = new DeterministicHealthMonitor({
    silenceTimeoutMs: 300_000,
    clock: clock.now,
    scheduler: clock,
    onClassification: (classification) => {
      classifications.push(classification);
    },
  });
  monitor.recordMechanicalEvent({ type: "process.spawned" });

  assert.deepEqual(monitor.nextDeadline(), {
    reason: "silence_timeout",
    at: "2026-07-25T12:05:00.000Z",
  });
  clock.advance(299_999);
  assert.deepEqual(classifications, []);
  clock.advance(1);

  const attention = (classifications as DeterministicHealthClassification[])[0];
  assert.equal(classifier.calls.length, 0);
  assert.equal(attention?.reason, "silence_timeout");
  assert.equal(attention?.kind, "attention");

  clock.advance(300_000);
  assert.equal(classifications.length, 1);

  monitor.recordProviderActivity("transport");
  clock.advance(300_000);
  assert.equal(classifications.length, 2);
  assert.equal(
    (classifications as DeterministicHealthClassification[])[1]?.reason,
    "silence_timeout",
  );
  assert.equal(classifier.calls.length, 0);
});

test("provider activity updates transport and semantic liveness independently", () => {
  const clock = new FakeClock();
  const monitor = new DeterministicHealthMonitor({
    silenceTimeoutMs: 300_000,
    clock: clock.now,
    scheduler: clock,
    onClassification: () => {},
  });
  monitor.recordMechanicalEvent({ type: "process.spawned" });
  clock.advance(60_000);
  monitor.recordProviderActivity("transport");
  clock.advance(30_000);
  monitor.recordProviderActivity("semantic");

  assert.equal(monitor.lastTransportActivityAt, "2026-07-25T12:01:30.000Z");
  assert.equal(monitor.lastSemanticActivityAt, "2026-07-25T12:01:30.000Z");
  assert.deepEqual(monitor.nextDeadline(), {
    reason: "silence_timeout",
    at: "2026-07-25T12:06:30.000Z",
  });
});

test("hard deadline emits deterministic attention and wins an earlier deadline", () => {
  const classifier = new ClassifierSpy();
  const clock = new FakeClock();
  const classifications: DeterministicHealthClassification[] = [];
  const monitor = new DeterministicHealthMonitor({
    silenceTimeoutMs: 300_000,
    hardDeadlineMs: 120_000,
    clock: clock.now,
    scheduler: clock,
    onClassification: (classification) => {
      classifications.push(classification);
    },
  });
  monitor.recordMechanicalEvent({ type: "process.spawned" });

  assert.deepEqual(monitor.nextDeadline(), {
    reason: "hard_deadline",
    at: "2026-07-25T12:02:00.000Z",
  });
  clock.advance(120_000);

  const attention = classifications[0];
  assert.equal(classifier.calls.length, 0);
  assert.equal(attention?.reason, "hard_deadline");
  assert.equal(attention?.kind, "attention");
  clock.advance(300_000);
  assert.equal(classifications.filter(({ reason }) => reason === "hard_deadline").length, 1);
});

test("an exposed wait emits once until semantic activity clears the condition", () => {
  const monitor = new DeterministicHealthMonitor({
    silenceTimeoutMs: 300_000,
    onClassification: () => {},
  });
  const event = {
    type: "input.required" as const,
    prompt: "Choose a migration.",
  };

  assert.equal(monitor.recordMechanicalEvent(event)?.reason, "input_required");
  assert.equal(monitor.recordMechanicalEvent(event), undefined);

  monitor.recordProviderActivity("semantic");

  assert.equal(monitor.recordMechanicalEvent(event)?.reason, "input_required");
});

test("supervisor persists timer and exposed-permission attention without semantic classification", async () => {
  const classifier = new ClassifierSpy();
  const clock = new FakeClock();
  const releaseTurn = deferred<void>();
  const turnStarted = deferred<void>();
  async function* scriptedTurn() {
    turnStarted.resolve(undefined);
    yield {
      type: "status" as const,
      level: "warning" as const,
      code: "permission_required",
      message: "Allow repository write?",
      details: { permission: "write" },
    };
    await releaseTurn.promise;
    yield {
      type: "turn.completed" as const,
      final_text: "finished",
    };
  }
  const supervisor = new Supervisor({
    runId: "xrun_health_integration",
    adapter: new FakeHarnessAdapter({ scriptedEvents: [scriptedTurn()] }),
    startOptions: { cwd: "/private/tmp/sheaf-xagent-supervision" },
    policy: { silenceTimeoutMs: 300_000, watchdog: {} },
    clock: clock.now,
    scheduler: clock,
  });
  await supervisor.start();
  const cursor = supervisor.inspect().sequence;
  const turn = supervisor.submit("Implement the task.");
  await turnStarted.promise;

  const permission = await supervisor.awaitEvent(cursor, 600_000);
  assert.equal(permission.reason, "permission_required");
  assert.equal(classifier.calls.length, 0);

  const silenceAwait = supervisor.awaitEvent(permission.sequence, 600_000);
  clock.advance(300_000);
  const attention = await silenceAwait;
  assert.equal(classifier.calls.length, 0);
  assert.equal(attention.reason, "silence_timeout");
  assert.equal(supervisor.inspect().phase, "running");

  releaseTurn.resolve(undefined);
  await turn;
});

test("supervisor turns an exposed transport loss into durable deterministic failure", async () => {
  const classifier = new ClassifierSpy();
  const supervisor = new Supervisor({
    runId: "xrun_transport_loss",
    adapter: new FakeHarnessAdapter({
      scriptedEvents: [[{
        type: "error",
        code: "transport_lost",
        message: "provider stdout closed",
        recoverable: false,
      }]],
    }),
    startOptions: { cwd: "/private/tmp/sheaf-xagent-supervision" },
    policy: { silenceTimeoutMs: 300_000, watchdog: {} },
  });
  await supervisor.start();
  const cursor = supervisor.inspect().sequence;

  await supervisor.submit("Implement the task.");
  const failure = await supervisor.awaitEvent(cursor, 1_000);

  assert.equal(failure.phase, "failed");
  assert.equal(failure.reason, "transport_loss");
  assert.equal(classifier.calls.length, 0);
});

test("supervisor sanitizes provider strings before durable mechanical delivery", async () => {
  const repoRoot = "/private/tmp/sheaf-xagent-supervision";
  const supervisor = new Supervisor({
    runId: "xrun_sanitized_mechanical",
    adapter: new FakeHarnessAdapter({
      scriptedEvents: [[
        {
          type: "status",
          level: "warning",
          code: "input_required",
          message: `Approve ${repoRoot}/.env api_key=input-secret`,
        },
        {
          type: "status",
          level: "warning",
          code: "permission_required",
          message: "Permission required",
          details: {
            permission: `write ${repoRoot}/.env token=permission-secret`,
          },
        },
        {
          type: "error",
          code: "transport_lost",
          message: `stdout closed in ${repoRoot} api_key=transport-secret`,
          recoverable: false,
        },
      ]],
    }),
    startOptions: { cwd: repoRoot },
    policy: { silenceTimeoutMs: 300_000, watchdog: {} },
  });
  await supervisor.start();
  const cursor = supervisor.inspect().sequence;
  await supervisor.submit("Implement the task.");

  const input = await supervisor.awaitEvent(cursor, 1_000);
  const permission = await supervisor.awaitEvent(input.sequence, 1_000);
  const transport = await supervisor.awaitEvent(permission.sequence, 1_000);
  if (
    input.type === "supervision.deadline"
    || permission.type === "supervision.deadline"
    || transport.type === "supervision.deadline"
  ) {
    assert.fail("expected durable mechanical events");
  }

  assert.deepEqual(input.payload, {
    prompt: "Approve ./.env api_key=[REDACTED]",
  });
  assert.deepEqual(permission.payload, {
    permission: "write ./.env token=[REDACTED]",
  });
  assert.deepEqual(transport.payload, {
    message: "stdout closed in . api_key=[REDACTED]",
  });
  assert.equal(JSON.stringify([input, permission, transport]).includes(repoRoot), false);
  assert.equal(JSON.stringify([input, permission, transport]).includes("-secret"), false);
});

test("interrupt keeps deterministic monitoring active until the provider turn settles", async () => {
  const clock = new FakeClock();
  const turnStarted = deferred<void>();
  const releaseTurn = deferred<void>();
  const reasons: string[] = [];
  async function* blockedTurn() {
    turnStarted.resolve(undefined);
    await releaseTurn.promise;
    yield {
      type: "turn.completed" as const,
      final_text: "interrupted turn settled",
    };
  }
  const supervisor = new Supervisor({
    runId: "xrun_interrupt_monitoring",
    adapter: new FakeHarnessAdapter({
      supportsInterrupt: true,
      scriptedEvents: [blockedTurn()],
    }),
    startOptions: { cwd: "/private/tmp/sheaf-xagent-supervision" },
    policy: { silenceTimeoutMs: 300_000, watchdog: {} },
    clock: clock.now,
    scheduler: clock,
    eventSink: async (event) => {
      reasons.push(event.reason);
    },
  });
  await supervisor.start();
  const turn = supervisor.submit("Implement the task.");
  await turnStarted.promise;

  await supervisor.interrupt();
  clock.advance(300_000);
  await new Promise<void>((resolve) => setImmediate(resolve));

  assert.equal(reasons.includes("silence_timeout"), true);

  releaseTurn.resolve(undefined);
  await turn;
});

test("an interrupted iterator ending without completion clears health timers at terminal failure", async () => {
  const clock = new FakeClock();
  const turnStarted = deferred<void>();
  const endTurn = deferred<void>();
  const reasons: string[] = [];
  async function* interruptedTurn() {
    turnStarted.resolve(undefined);
    await endTurn.promise;
  }
  const supervisor = new Supervisor({
    runId: "xrun_interrupted_missing_report",
    adapter: new FakeHarnessAdapter({
      supportsInterrupt: true,
      scriptedEvents: [interruptedTurn()],
    }),
    startOptions: { cwd: "/private/tmp/sheaf-xagent-supervision" },
    policy: { silenceTimeoutMs: 300_000, watchdog: {} },
    clock: clock.now,
    scheduler: clock,
    eventSink: async (event) => {
      reasons.push(event.reason);
    },
  });
  await supervisor.start();
  const turn = supervisor.submit("Implement the task.");
  await turnStarted.promise;

  await supervisor.interrupt();
  endTurn.resolve(undefined);
  await turn;

  assert.equal(supervisor.inspect().phase, "failed");
  assert.equal(reasons.includes("missing_final_report"), true);
  assert.equal(clock.pendingCount(), 0);

  clock.advance(300_000);
  await new Promise<void>((resolve) => setImmediate(resolve));
  assert.equal(reasons.includes("silence_timeout"), false);
});

class ClassifierSpy {
  readonly calls: unknown[] = [];
}

type Scheduled = {
  readonly callback: () => void;
  readonly dueAt: number;
  cancelled: boolean;
};

class FakeClock implements SupervisionScheduler {
  #now = Date.parse("2026-07-25T12:00:00.000Z");
  readonly #scheduled: Scheduled[] = [];
  readonly now = (): Date => new Date(this.#now);

  setTimeout(callback: () => void, delayMs: number): Scheduled {
    const scheduled = {
      callback,
      dueAt: this.#now + Math.max(0, delayMs),
      cancelled: false,
    };
    this.#scheduled.push(scheduled);
    return scheduled;
  }

  clearTimeout(handle: unknown): void {
    (handle as Scheduled).cancelled = true;
  }

  pendingCount(): number {
    return this.#scheduled.filter(({ cancelled }) => !cancelled).length;
  }

  advance(durationMs: number): void {
    const target = this.#now + durationMs;
    while (true) {
      const next = this.#scheduled
        .filter(({ cancelled, dueAt }) => !cancelled && dueAt <= target)
        .sort((left, right) => left.dueAt - right.dueAt)[0];
      if (next === undefined) {
        break;
      }
      next.cancelled = true;
      this.#now = next.dueAt;
      next.callback();
    }
    this.#now = target;
  }
}

function deferred<T>(): {
  readonly promise: Promise<T>;
  readonly resolve: (value: T) => void;
} {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((resolver) => {
    resolve = resolver;
  });
  return { promise, resolve };
}
