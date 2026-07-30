import assert from "node:assert/strict";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";

import { FakeHarnessAdapter } from "../src/adapters/fake.js";
import type { AdapterEvent } from "../src/adapters/types.js";
import { XagentRunManager } from "../src/service/run_manager.js";
import { SequencedEventQueue } from "../src/supervision/event_queue.js";
import { Supervisor } from "../src/supervision/supervisor.js";
import type {
  SupervisionEvent,
  SupervisionScheduler,
  SupervisionPolicy,
  WatchdogClassifier,
  WatchdogTelemetry,
  WatchdogVerdict,
} from "../src/supervision/types.js";

const testPolicy: SupervisionPolicy = {
  silenceTimeoutMs: 300_000,
  watchdog: {},
};

// Finding #1: deterministic attention failures must not be swallowed.
test("health callback failure surfaces a failed state and is visible via inspect", async () => {
  const clock = new FakeClock();
  const releaseTurn = deferred<void>();
  const turnStarted = deferred<void>();
  const attentionFailure = new Error("attention sink broken");
  async function* silentTurn(): AsyncIterable<AdapterEvent> {
    yield { type: "message.delta", message_id: "m1", role: "assistant", delta: "starting" };
    turnStarted.resolve(undefined);
    await releaseTurn.promise;
    yield {
      type: "turn.completed",
      final_text: "done after attention",
      provider_thread_id: "fake-thread-1",
    };
  }
  const supervisor = new Supervisor({
    runId: "xrun_health_callback_failure",
    adapter: new FakeHarnessAdapter({ scriptedEvents: [silentTurn()] }),
    startOptions: { cwd: "/private/tmp/sheaf-xagent-supervision" },
    policy: { silenceTimeoutMs: 300_000, watchdog: {} },
    clock: clock.now,
    scheduler: clock,
    eventSink: async (event) => {
      if (event.type === "supervision.attention") {
        throw attentionFailure;
      }
    },
  });
  await supervisor.start();
  const cursor = supervisor.inspect().sequence;
  const turn = supervisor.submit("go silent then complete");
  await turnStarted.promise;

  // Advance past the silence timeout to trigger a timer-driven attention
  // publish, which the event sink rejects.
  clock.advance(300_000);
  await waitForCondition(() => supervisor.inspect().phase === "failed", 1_000);

  const inspection = supervisor.inspect();
  assert.equal(inspection.phase, "failed");
  assert.equal(inspection.callback_failure?.source, "health_callback");
  assert.equal(inspection.callback_failure?.message, "attention sink broken");

  const failure = await supervisor.awaitEvent(cursor, 1_000);
  assert.equal(failure.phase, "failed");
  assert.equal(failure.reason, "health_callback_failed");

  releaseTurn.resolve(undefined);
  await turn.catch(() => {});
});

// Finding #2a: a mid-run sink failure does not wedge subsequent publishes.
test("event queue recovers from a mid-run sink failure so later publishes are not wedged", async () => {
  let sinkCalls = 0;
  const queue = new SequencedEventQueue(
    "xrun_mid_sink_failure",
    async () => {
      sinkCalls += 1;
      if (sinkCalls === 2) {
        throw new Error("transient sink failure");
      }
    },
    () => new Date("2026-07-25T12:00:00.000Z"),
  );

  // First publish succeeds (sinkCalls becomes 1).
  const first = await queue.publish({
    type: "supervision.state",
    phase: "ready",
    reason: "first",
  });
  assert.equal(first.sequence, 1);

  // Second publish fails (sinkCalls becomes 2).
  await assert.rejects(
    queue.publish({ type: "supervision.attention", phase: "running", reason: "second" }),
    /transient sink failure/,
  );

  // A subsequent publish must not be wedged by the prior rejection.
  const third = await queue.publish({
    type: "supervision.state",
    phase: "ready",
    reason: "recovered",
  });
  assert.equal(third.sequence, 3);
  assert.equal(sinkCalls, 3);
});

// Finding #2a (integration): mid-run sink failure transitions the run to failed.
test("mid-run event sink failure transitions the supervisor to a terminal failed state", async () => {
  const events: SupervisionEvent[] = [];
  let sinkCalls = 0;
  const releaseTurn = deferred<void>();
  async function* scriptedTurn(): AsyncIterable<AdapterEvent> {
    yield { type: "message.delta", message_id: "m1", role: "assistant", delta: "working" };
    await releaseTurn.promise;
    yield { type: "message.completed", message_id: "m1", role: "assistant", text: "done" };
    yield { type: "turn.completed", final_text: "done", provider_thread_id: "fake-thread-1" };
  }
  const supervisor = new Supervisor({
    runId: "xrun_mid_run_sink_failure",
    adapter: new FakeHarnessAdapter({ scriptedEvents: [scriptedTurn()] }),
    startOptions: { cwd: "/private/tmp/sheaf-xagent-supervision" },
    policy: testPolicy,
    eventSink: async (event) => {
      events.push(event);
      sinkCalls += 1;
      // Fail on the turn.completed publish (mid-run, after running is durable).
      if (event.reason === "turn_completed") {
        throw new Error("mid-run sink broken");
      }
    },
  });
  await supervisor.start();
  const cursor = supervisor.inspect().sequence;
  const turn = supervisor.submit("work");
  releaseTurn.resolve(undefined);
  await assert.rejects(turn, /mid-run sink broken/);

  assert.equal(supervisor.inspect().phase, "failed");
  const failure = await supervisor.awaitEvent(cursor, 1_000);
  assert.equal(failure.phase, "failed");
  assert.equal(failure.reason, "event_persistence_failed");
});

// Finding #3: startRun returns a cursor from which awaiting observes completion
// even when the turn finishes before the first poll.
test("startRun cursor observes completion when the turn finishes before the first poll", async () => {
  const logRoot = await mkdtemp(path.join(tmpdir(), "xagent-start-cursor-"));
  const runManager = new XagentRunManager({
    repoRoot: process.cwd(),
    logRoot,
    adapterFactory: () =>
      new FakeHarnessAdapter({
        scriptedEvents: [[
          { type: "message.completed", message_id: "m1", role: "assistant", text: "fast report" },
          { type: "turn.completed", final_text: "fast report", provider_thread_id: "fake-thread-1" },
        ]],
      }),
    policy: testPolicy,
  });
  try {
    const cwd = await mkdtemp(path.join(tmpdir(), "xagent-start-cwd-"));
    const start = await runManager.startRun({
      cwd,
      prompt: "finish immediately",
      harness: "codex",
      mode: "subagent",
    });
    // The returned cursor must be at or before the running event so awaiting
    // observes the completion rather than skipping past it.
    const result = await runManager.awaitRun({
      run_id: start.run_id,
      after_sequence: start.sequence,
      deadline_seconds: 5,
    });
    assert.equal(result.event, "turn.completed");
    assert.equal((result as unknown as { report: { text: string } }).report.text, "fast report");
  } finally {
    await runManager.closeAll();
  }
});

// Finding #4: xagent_inspect falls back to persisted metadata for runs not in memory.
test("xagent_inspect reports an abandoned run from a prior incarnation via persisted metadata", async () => {
  const sheafRoot = await mkdtemp(path.join(tmpdir(), "xagent-inspect-fallback-"));
  const logRoot = path.join(sheafRoot, "data", "xagent");
  const { createRunRecord, updateRunSupervision } = await import("../src/logs.js");

  const abandonedRunId = "xrun_abandoned_persisted";
  const record = await createRunRecord({
    repoRoot: sheafRoot,
    logRoot,
    runId: abandonedRunId,
    harness: "codex",
    mode: "subagent",
    clock: () => new Date("2026-07-25T12:00:00.000Z"),
  });
  await updateRunSupervision(record, {
    phase: "abandoned",
    sequence: 7,
    provider_thread_id: "provider-thread-abandoned",
    last_transport_progress_at: "2026-07-25T12:01:00.000Z",
    last_semantic_progress_at: "2026-07-25T12:00:30.000Z",
  });

  const runManager = new XagentRunManager({
    repoRoot: sheafRoot,
    logRoot,
    adapterFactory: () => new FakeHarnessAdapter(),
    policy: testPolicy,
  });
  try {
    // The run is not in memory; inspect must fall back to persisted metadata.
    const inspection = await runManager.inspectRun({ run_id: abandonedRunId });
    assert.equal(inspection.run_id, abandonedRunId);
    assert.equal(inspection.phase, "abandoned");
    assert.equal(inspection.sequence, 7);
    assert.equal(inspection.provider_thread_id, "provider-thread-abandoned");

    // A never-existed run remains unknown.
    await assert.rejects(
      runManager.inspectRun({ run_id: "xrun_never_existed" }),
      /Unknown xagent run/i,
    );
  } finally {
    await runManager.closeAll();
  }
});

test("xagent_await delivers a durable attention event for an abandoned run on disk", async () => {
  const sheafRoot = await mkdtemp(path.join(tmpdir(), "xagent-await-abandoned-"));
  const logRoot = path.join(sheafRoot, "data", "xagent");
  const {
    appendNormalizedEvent,
    createRunRecord,
    updateRunSupervision,
  } = await import("../src/logs.js");

  const abandonedRunId = "xrun_abandoned_await";
  const record = await createRunRecord({
    repoRoot: sheafRoot,
    logRoot,
    runId: abandonedRunId,
    harness: "codex",
    mode: "subagent",
    clock: () => new Date("2026-07-25T12:00:00.000Z"),
  });
  await appendNormalizedEvent(record, {
    schema_version: 1,
    type: "supervision.state",
    run_id: abandonedRunId,
    sequence: 4,
    timestamp: "2026-07-25T12:02:00.000Z",
    phase: "abandoned",
    reason: "stale_run_abandoned",
  });
  await appendNormalizedEvent(record, {
    schema_version: 1,
    type: "supervision.attention",
    run_id: abandonedRunId,
    sequence: 5,
    timestamp: "2026-07-25T12:02:00.001Z",
    phase: "abandoned",
    reason: "stale_run_abandoned",
    payload: {
      cleanup: "pending",
      owned_process_recorded: false,
    },
  });
  await appendNormalizedEvent(record, {
    schema_version: 1,
    type: "supervision.state",
    run_id: abandonedRunId,
    sequence: 6,
    timestamp: "2026-07-25T12:02:00.002Z",
    phase: "abandoned",
    reason: "stale_process_not_found",
  });
  await updateRunSupervision(record, {
    phase: "abandoned",
    sequence: 6,
    last_transport_progress_at: "2026-07-25T12:01:00.000Z",
    last_semantic_progress_at: "2026-07-25T12:00:30.000Z",
    watchdog: {
      invocation_count: 0,
      controller_wake_count: 1,
      deterministic_alert_count: 1,
      evidence_truncation_count: 0,
    },
  });

  const runManager = new XagentRunManager({
    repoRoot: sheafRoot,
    logRoot,
    adapterFactory: () => new FakeHarnessAdapter(),
    policy: testPolicy,
  });
  try {
    const first = await runManager.awaitRun({
      run_id: abandonedRunId,
      after_sequence: 0,
      deadline_seconds: 5,
    });
    assert.equal(first.event, "supervision.state");
    assert.equal(first.phase, "abandoned");
    assert.equal(first.reason, "stale_run_abandoned");
    assert.equal(first.sequence, 4);

    const attention = await runManager.awaitRun({
      run_id: abandonedRunId,
      after_sequence: first.sequence,
      deadline_seconds: 5,
    });
    assert.equal(attention.event, "supervision.attention");
    assert.equal(attention.phase, "abandoned");
    assert.equal(attention.reason, "stale_run_abandoned");
    assert.equal(attention.sequence, 5);
    assert.deepEqual(attention.payload, {
      cleanup: "pending",
      owned_process_recorded: false,
    });
  } finally {
    await runManager.closeAll();
  }
});

// Finding #4: xagent_inspect live run surfaces callback_failure from finding #1.
test("xagent_inspect surfaces a live supervisor callback_failure", async () => {
  const logRoot = await mkdtemp(path.join(tmpdir(), "xagent-inspect-live-"));
  const runManager = new XagentRunManager({
    repoRoot: process.cwd(),
    logRoot,
    adapterFactory: () => new FakeHarnessAdapter(),
    policy: testPolicy,
  });
  try {
    const { runId } = await runManager.create({
      runId: "xrun_inspect_live",
      harness: "codex",
      mode: "subagent",
      cwd: process.cwd(),
    });
    await runManager.start(runId);
    const inspection = await runManager.inspectRun({ run_id: runId });
    assert.equal(inspection.run_id, runId);
    assert.equal("callback_failure" in inspection, false);
  } finally {
    await runManager.closeAll();
  }
});

// Review I1 (r7): a live run in a terminal phase must not block `awaitEvent`
// for the full deadline. The persisted path was fixed in r6; this test pins
// the matching short-circuit for a run that is still in `#runs` after a
// `failed` transition (only `close()` removes it). The controller consumes
// the failure event, then re-awaits from that cursor; the supervisor must
// return a distinguishable `run_terminal` deadline promptly rather than
// arming a 60 s timer.
//
test("live terminal supervisor returns run_terminal promptly when re-awaited past its last event", async () => {
  const clock = new FakeClock();
  const adapter = new FakeHarnessAdapter({
    scriptedEvents: [[
      {
        type: "turn.failed",
        turn_id: "turn_1",
        code: "harness_unavailable",
        message: "provider exited",
      } as AdapterEvent,
    ]],
  });
  const supervisor = new Supervisor({
    runId: "xrun_live_terminal_short_circuit",
    adapter,
    startOptions: { cwd: "/private/tmp/sheaf-xagent-supervision" },
    policy: testPolicy,
    clock: clock.now,
    scheduler: clock,
  });
  await supervisor.start();
  const cursor = supervisor.inspect().sequence;
  const turn = supervisor.submit("fail fast");
  await turn.catch(() => {});

  assert.equal(supervisor.inspect().phase, "failed");

  // First await consumes the durable failed state event.
  const failure = await supervisor.awaitEvent(cursor, 1_000);
  assert.equal(failure.phase, "failed");
  assert.equal(failure.type, "supervision.state");

  // Re-awaiting from the failure cursor must short-circuit with `run_terminal`
  // rather than blocking for the 60s deadline.
  const start = Date.now();
  const result = await supervisor.awaitEvent(failure.sequence, 60_000);
  const elapsedMs = Date.now() - start;
  assert.equal(result.type, "supervision.deadline");
  assert.equal((result as { reason: string }).reason, "run_terminal");
  assert.equal((result as { phase: string }).phase, "failed");
  assert.ok(
    elapsedMs < 1_000,
    `expected prompt run_terminal, got ${elapsedMs}ms`,
  );
});

// Review I3 (r7): xas-10 requires telemetry sufficient to compute detection
// latency ("time since the triggering evidence"). `WatchdogTelemetry` must
// carry `elapsed_ms` so analysts can recover it from `watchdog.jsonl` without
// re-deriving the request. This test drives a real classifier verdict
// through the supervisor and asserts the telemetry record carries the
// field with a value matching the fake-clock elapsed time.
//
test("watchdog telemetry record carries elapsed_ms for detection latency (xas-10)", async () => {
  const clock = new FakeClock();
  const telemetry: WatchdogTelemetry[] = [];
  const classifier: WatchdogClassifier = {
    async classify() {
      return {
        verdict: "derailed",
        confidence: 0.93,
        reason_code: "repeated_failed_tool",
        evidence: ["The same failed tool call repeated."],
      } satisfies WatchdogVerdict;
    },
  };
  async function* activeTurn(): AsyncIterable<AdapterEvent> {
    clock.advance(240_000);
    yield {
      type: "raw.provider" as const,
      harness: "codex" as const,
      payload: { bytes: 1 },
    };
    clock.advance(240_000);
    yield {
      type: "raw.provider" as const,
      harness: "codex" as const,
      payload: { bytes: 2 },
    };
    clock.advance(120_000);
    yield {
      type: "raw.provider" as const,
      harness: "codex" as const,
      payload: { bytes: 10 },
    };
    yield {
      type: "message.delta" as const,
      message_id: "message_elapsed",
      role: "assistant" as const,
      delta: "still working",
    };
    yield { type: "turn.completed" as const, final_text: "finished" };
  }
  const supervisor = new Supervisor({
    runId: "xrun_watchdog_telemetry_elapsed",
    adapter: new FakeHarnessAdapter({ scriptedEvents: [activeTurn()] }),
    startOptions: { cwd: process.cwd() },
    policy: { silenceTimeoutMs: 300_000, watchdog: {} },
    clock: clock.now,
    scheduler: clock,
    watchdogClassifier: classifier,
    watchdogTelemetrySink: async (entry) => {
      telemetry.push(entry);
    },
  });
  await supervisor.start();
  const cursor = supervisor.inspect().sequence;
  await supervisor.submit("implement");

  const attention = await supervisor.awaitEvent(cursor, 1_000);
  assert.equal(attention.type, "supervision.attention");
  assert.equal(attention.reason, "watchdog_derailed");

  assert.equal(telemetry.length, 1);
  const entry = telemetry[0];
  assert.equal(entry.verdict, "derailed");
  assert.equal(entry.reason_code, "repeated_failed_tool");
  assert.equal(typeof entry.elapsed_ms, "number");
  // The watchdog fires at the raw provider checkpoint emitted after
  // 240_000 + 240_000 + 120_000 = 600_000 ms of fake-clock progress;
  // elapsed_ms is measured from turn start, so it must be 600_000.
  assert.equal(entry.elapsed_ms, 600_000);
  assert.equal(entry.attention_sequence, attention.sequence);
});

function deferred<T = void>(): { promise: Promise<T>; resolve(value: T): void } {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((res) => {
    resolve = res;
  });
  return { promise, resolve };
}

async function waitForCondition(predicate: () => boolean, timeoutMs = 5_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (!predicate()) {
    if (Date.now() >= deadline) {
      throw new Error(`Condition was not met within ${timeoutMs} ms.`);
    }
    await new Promise<void>((resolve) => setImmediate(resolve));
  }
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
