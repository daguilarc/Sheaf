import assert from "node:assert/strict";
import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";

import { FakeHarnessAdapter } from "../src/adapters/fake.js";
import {
  appendWatchdogTelemetry,
  createRunRecord,
} from "../src/logs.js";
import { Supervisor } from "../src/supervision/supervisor.js";
import type {
  SupervisionScheduler,
  WatchdogClassifier,
  WatchdogRequest,
  WatchdogTelemetry,
  WatchdogVerdict,
} from "../src/supervision/types.js";
import {
  WatchdogScheduler,
  normalizeWatchdogVerdict,
} from "../src/supervision/watchdog.js";

test("normalizes only the three schema verdicts and the healthy confidence floor", () => {
  assert.deepEqual(normalizeWatchdogVerdict({
    verdict: "healthy",
    confidence: 0.8,
    reason_code: "steady_progress",
    evidence: ["Produced a bounded implementation diff."],
  }), {
    verdict: "healthy",
    confidence: 0.8,
    reason_code: "steady_progress",
    evidence: ["Produced a bounded implementation diff."],
  });
  assert.equal(normalizeWatchdogVerdict({
    verdict: "derailed",
    confidence: 0.91,
    reason_code: "repeated_failed_tool",
    evidence: ["The same failing tool fingerprint occurred three times."],
  }).verdict, "derailed");
  assert.equal(normalizeWatchdogVerdict({
    verdict: "uncertain",
    confidence: 0.55,
    reason_code: "insufficient_evidence",
    evidence: [],
  }).verdict, "uncertain");
  assert.deepEqual(normalizeWatchdogVerdict({
    verdict: "healthy",
    confidence: 0.79,
    reason_code: "steady_progress",
    evidence: ["Progress is visible but confidence is low."],
  }), {
    verdict: "uncertain",
    confidence: 0.79,
    reason_code: "healthy_below_confidence_floor",
    evidence: ["Progress is visible but confidence is low."],
  });
});

test("rejects malformed or action-bearing verdicts as uncertain", () => {
  for (const candidate of [
    { verdict: "lost", confidence: 0.9, reason_code: "bad", evidence: [] },
    { verdict: "healthy", confidence: 2, reason_code: "bad", evidence: [] },
    {
      verdict: "derailed",
      confidence: 0.9,
      reason_code: "loop",
      evidence: [],
      action: "interrupt the worker",
    },
  ]) {
    assert.equal(normalizeWatchdogVerdict(candidate).verdict, "uncertain");
    assert.equal(normalizeWatchdogVerdict(candidate).reason_code, "invalid_classifier_output");
  }
});

test("default active cadence is 10, 20, then repeated 40 minute intervals", async () => {
  const clock = new FakeClock();
  const classifier = new ClassifierSpy();
  const scheduler = new WatchdogScheduler({
    classifier,
    clock: clock.now,
  });
  scheduler.resetTurn();

  clock.advance(599_999);
  await scheduler.onActiveEvidence(request());
  assert.equal(classifier.calls.length, 0);
  clock.advance(1);
  await scheduler.onActiveEvidence(request());
  assert.equal(classifier.calls.length, 1);

  clock.advance(1_199_999);
  await scheduler.onActiveEvidence(request());
  assert.equal(classifier.calls.length, 1);
  clock.advance(1);
  await scheduler.onActiveEvidence(request());
  assert.equal(classifier.calls.length, 2);

  clock.advance(2_400_000);
  await scheduler.onActiveEvidence(request());
  assert.equal(classifier.calls.length, 3);
  clock.advance(2_400_000);
  await scheduler.onActiveEvidence(request());
  assert.equal(classifier.calls.length, 4);
});

test("suspicion is early-check eligible only after the five minute minimum", async () => {
  const clock = new FakeClock();
  const classifier = new ClassifierSpy();
  const scheduler = new WatchdogScheduler({
    classifier,
    clock: clock.now,
  });
  scheduler.resetTurn();
  const suspicious = request(["repeated_tool_fingerprint"]);

  clock.advance(299_999);
  await scheduler.onActiveEvidence(suspicious);
  assert.equal(classifier.calls.length, 0);
  clock.advance(1);
  await scheduler.onActiveEvidence(suspicious);
  assert.equal(classifier.calls.length, 1);

  clock.advance(299_999);
  await scheduler.onActiveEvidence(suspicious);
  assert.equal(classifier.calls.length, 1);
  clock.advance(1);
  await scheduler.onActiveEvidence(suspicious);
  assert.equal(classifier.calls.length, 2);
});

test("policy cannot relax the five-minute, 64 KiB, 2 KiB, or eight-call bounds", () => {
  const classifier = new ClassifierSpy();
  for (const watchdog of [
    { minimumIntervalMs: 299_999 },
    { inputLimitBytes: 64 * 1024 + 1 },
    { outputLimitBytes: 2 * 1024 + 1 },
    { maximumCalls: 9 },
  ]) {
    assert.throws(() => new WatchdogScheduler({
      classifier,
      policy: watchdog,
    }), /minimumIntervalMs|inputLimitBytes|outputLimitBytes|maximumCalls/);
  }
});

test("new turns reset periodic cadence while preserving the eight-call run cap", async () => {
  const clock = new FakeClock();
  const classifier = new ClassifierSpy();
  const scheduler = new WatchdogScheduler({
    classifier,
    clock: clock.now,
  });

  scheduler.resetTurn();
  clock.advance(600_000);
  await scheduler.onActiveEvidence(request());
  assert.equal(scheduler.callsUsed, 1);

  scheduler.resetTurn();
  clock.advance(599_999);
  await scheduler.onActiveEvidence(request());
  assert.equal(scheduler.callsUsed, 1);
  clock.advance(1);
  await scheduler.onActiveEvidence(request());
  assert.equal(scheduler.callsUsed, 2);

  for (let call = 2; call < 8; call += 1) {
    clock.advance(call === 2 ? 1_200_000 : 2_400_000);
    await scheduler.onActiveEvidence(request());
  }
  assert.equal(scheduler.callsUsed, 8);
  assert.equal(classifier.calls.length, 8);

  clock.advance(24 * 60 * 60_000);
  await scheduler.onActiveEvidence(request(["repeated_failure_fingerprint"]));
  assert.equal(scheduler.callsUsed, 8);
  assert.equal(classifier.calls.length, 8);
  assert.equal(scheduler.coverageExhausted, true);
});

test("supervisor classifier seam is bypassed by mechanical completion, input, crash, silence, cancellation, and deadline paths", async () => {
  const completionClassifier = new ClassifierSpy();
  const completion = new Supervisor({
    runId: "xrun_watchdog_completion",
    adapter: new FakeHarnessAdapter({
      scriptedEvents: [[{
        type: "turn.completed",
        final_text: "finished mechanically",
      }]],
    }),
    startOptions: { cwd: process.cwd() },
    policy: { silenceTimeoutMs: 300_000, watchdog: {} },
    watchdogClassifier: completionClassifier,
  });
  await completion.start();
  await completion.submit("complete");
  assert.equal(completionClassifier.calls.length, 0);

  const inputClassifier = new ClassifierSpy();
  const input = new Supervisor({
    runId: "xrun_watchdog_input",
    adapter: new FakeHarnessAdapter({
      scriptedEvents: [[
        {
          type: "status",
          level: "warning",
          code: "input_required",
          message: "Choose one.",
        },
        { type: "turn.completed", final_text: "finished after input" },
      ]],
    }),
    startOptions: { cwd: process.cwd() },
    policy: { silenceTimeoutMs: 300_000, watchdog: {} },
    watchdogClassifier: inputClassifier,
  });
  await input.start();
  await input.submit("wait for input");
  assert.equal(inputClassifier.calls.length, 0);

  const crashClassifier = new ClassifierSpy();
  const crash = new Supervisor({
    runId: "xrun_watchdog_crash",
    adapter: new FakeHarnessAdapter({
      scriptedEvents: [[{
        type: "error",
        code: "transport_lost",
        message: "child process exited with code 17",
        recoverable: false,
      }]],
    }),
    startOptions: { cwd: process.cwd() },
    policy: { silenceTimeoutMs: 300_000, watchdog: {} },
    watchdogClassifier: crashClassifier,
  });
  await crash.start();
  await crash.submit("crash");
  assert.equal(crashClassifier.calls.length, 0);

  const clock = new FakeClock();
  const deadlineClassifier = new ClassifierSpy();
  const release = deferred<void>();
  async function* blockedTurn() {
    await release.promise;
    yield { type: "turn.completed" as const, final_text: "finished later" };
  }
  const deadline = new Supervisor({
    runId: "xrun_watchdog_deadlines",
    adapter: new FakeHarnessAdapter({ scriptedEvents: [blockedTurn()] }),
    startOptions: { cwd: process.cwd() },
    policy: {
      silenceTimeoutMs: 300_000,
      hardDeadlineMs: 120_000,
      watchdog: {},
    },
    clock: clock.now,
    scheduler: clock,
    watchdogClassifier: deadlineClassifier,
  });
  await deadline.start();
  const turn = deadline.submit("wait");
  await new Promise<void>((resolve) => setImmediate(resolve));
  clock.advance(120_000);
  await new Promise<void>((resolve) => setImmediate(resolve));
  assert.equal(deadlineClassifier.calls.length, 0);
  release.resolve(undefined);
  await turn;

  const silenceClock = new FakeClock();
  const silenceClassifier = new ClassifierSpy();
  const releaseSilence = deferred<void>();
  async function* silentTurn() {
    await releaseSilence.promise;
    yield { type: "turn.completed" as const, final_text: "finished after silence" };
  }
  const silence = new Supervisor({
    runId: "xrun_watchdog_silence",
    adapter: new FakeHarnessAdapter({ scriptedEvents: [silentTurn()] }),
    startOptions: { cwd: process.cwd() },
    policy: { silenceTimeoutMs: 300_000, watchdog: {} },
    clock: silenceClock.now,
    scheduler: silenceClock,
    watchdogClassifier: silenceClassifier,
  });
  await silence.start();
  const silentSubmission = silence.submit("wait silently");
  await new Promise<void>((resolve) => setImmediate(resolve));
  silenceClock.advance(300_000);
  await new Promise<void>((resolve) => setImmediate(resolve));
  assert.equal(silenceClassifier.calls.length, 0);
  await silence.close();
  assert.equal(silenceClassifier.calls.length, 0);
  releaseSilence.resolve(undefined);
  await silentSubmission;
});

test("derailed semantic checks emit advisory attention without acting on the worker", async () => {
  const clock = new FakeClock();
  const telemetry: WatchdogTelemetry[] = [];
  const classifier = new ClassifierSpy({
    verdict: "derailed",
    confidence: 0.93,
    reason_code: "repeated_failed_tool",
    evidence: ["The same failed tool call repeated."],
  });
  async function* activeTurn() {
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
      payload: { bytes: 1 },
    };
    clock.advance(120_000);
    yield {
      type: "message.delta" as const,
      message_id: "message_1",
      role: "assistant" as const,
      delta: "still working",
    };
    yield {
      type: "turn.completed" as const,
      final_text: "finished without autonomous intervention",
    };
  }
  const supervisor = new Supervisor({
    runId: "xrun_semantic_attention",
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
  assert.deepEqual(attention.payload, {
    verdict: "derailed",
    confidence: 0.93,
    reason_code: "repeated_failed_tool",
    evidence: ["The same failed tool call repeated."],
  });
  assert.equal(supervisor.inspect().phase, "ready");
  assert.equal(telemetry.length, 1);
  assert.equal(telemetry[0]?.attention_sequence, attention.sequence);
  assert.match(telemetry[0]?.request_hash ?? "", /^[0-9a-f]{64}$/);
  assert.equal(JSON.stringify(telemetry).includes("original_prompt"), false);
  assert.equal(JSON.stringify(telemetry).includes("implement"), false);
});

test("high-confidence healthy semantic checks remain controller-silent", async () => {
  const clock = new FakeClock();
  const classifier = new ClassifierSpy();
  const reasons: string[] = [];
  async function* activeTurn() {
    for (const advanceMs of [240_000, 240_000]) {
      clock.advance(advanceMs);
      yield {
        type: "raw.provider" as const,
        harness: "codex" as const,
        payload: { bytes: 1 },
      };
    }
    clock.advance(120_000);
    yield {
      type: "message.delta" as const,
      message_id: "message_healthy",
      role: "assistant" as const,
      delta: "making bounded progress",
    };
    yield {
      type: "turn.completed" as const,
      final_text: "healthy completion",
    };
  }
  const supervisor = new Supervisor({
    runId: "xrun_semantic_healthy",
    adapter: new FakeHarnessAdapter({ scriptedEvents: [activeTurn()] }),
    startOptions: { cwd: process.cwd() },
    policy: { silenceTimeoutMs: 300_000, watchdog: {} },
    clock: clock.now,
    scheduler: clock,
    watchdogClassifier: classifier,
    eventSink: async (event) => {
      reasons.push(event.reason);
    },
  });
  await supervisor.start();
  await supervisor.submit("implement");

  assert.equal(classifier.calls.length, 1);
  assert.equal(reasons.some((reason) => reason.startsWith("watchdog_")), false);
  assert.equal(reasons.includes("turn_completed"), true);
});

test("later checks receive the prior watchdog verdict in the bounded evidence envelope", async () => {
  const clock = new FakeClock();
  const classifier = new ClassifierSpy();
  async function* longActiveTurn() {
    for (let minute = 4; minute <= 28; minute += 4) {
      clock.advance(4 * 60_000);
      yield {
        type: "raw.provider" as const,
        harness: "codex" as const,
        payload: { bytes: minute },
      };
      if (minute === 12) {
        yield {
          type: "message.delta" as const,
          message_id: "message_first_check",
          role: "assistant" as const,
          delta: "first checkpoint",
        };
      }
    }
    clock.advance(4 * 60_000);
    yield {
      type: "message.delta" as const,
      message_id: "message_second_check",
      role: "assistant" as const,
      delta: "second checkpoint",
    };
    yield {
      type: "turn.completed" as const,
      final_text: "finished",
    };
  }
  const supervisor = new Supervisor({
    runId: "xrun_watchdog_prior_verdict",
    adapter: new FakeHarnessAdapter({ scriptedEvents: [longActiveTurn()] }),
    startOptions: { cwd: process.cwd() },
    policy: { silenceTimeoutMs: 300_000, watchdog: {} },
    clock: clock.now,
    scheduler: clock,
    watchdogClassifier: classifier,
  });
  await supervisor.start();
  await supervisor.submit("implement");

  assert.equal(classifier.calls.length, 2);
  assert.deepEqual(classifier.calls[1]?.previous_verdict, {
    verdict: "healthy",
    confidence: 0.95,
    reason_code: "steady_progress",
  });
  assert.ok((classifier.calls[1]?.input_bytes ?? 0) <= 64 * 1024);
});

test("uncertain, low-confidence, and invalid semantic results each emit advisory uncertainty", async () => {
  const cases: Array<{ readonly name: string; readonly result: unknown }> = [
    {
      name: "uncertain",
      result: {
        verdict: "uncertain",
        confidence: 0.5,
        reason_code: "insufficient_evidence",
        evidence: [],
      },
    },
    {
      name: "low_confidence",
      result: {
        verdict: "healthy",
        confidence: 0.79,
        reason_code: "steady_progress",
        evidence: [],
      },
    },
    {
      name: "invalid",
      result: {
        verdict: "healthy",
        confidence: 0.95,
        reason_code: "steady_progress",
        evidence: [],
        action: "message the worker",
      },
    },
  ];

  for (const item of cases) {
    const clock = new FakeClock();
    const adapter = new FakeHarnessAdapter({
      scriptedEvents: [semanticCheckpointTurn(clock)],
    });
    const reasons: string[] = [];
    const classifier: WatchdogClassifier = {
      async classify() {
        return item.result as WatchdogVerdict;
      },
    };
    const supervisor = new Supervisor({
      runId: `xrun_watchdog_${item.name}`,
      adapter,
      startOptions: { cwd: process.cwd() },
      policy: { silenceTimeoutMs: 300_000, watchdog: {} },
      clock: clock.now,
      scheduler: clock,
      watchdogClassifier: classifier,
      eventSink: async (event) => {
        reasons.push(event.reason);
      },
    });
    await supervisor.start();
    await supervisor.submit("implement");

    assert.equal(reasons.includes("watchdog_uncertain"), true, item.name);
    assert.equal(adapter.interruptCount, 0, item.name);
    assert.deepEqual(adapter.submittedTexts, ["implement"], item.name);
  }
});

test("watchdog telemetry log stores aggregate facts without prompt text", async () => {
  const repoRoot = await mkdtemp(path.join(tmpdir(), "xagent-watchdog-log-"));
  const record = await createRunRecord({
    repoRoot,
    runId: "xrun_watchdog_log",
    harness: "claude_code",
    mode: "subagent",
  });
  await appendWatchdogTelemetry(record, {
    schema_version: 1,
    timestamp: "2026-07-25T12:10:00.000Z",
    request_hash: "a".repeat(64),
    input_bytes: 1024,
    output_bytes: 240,
    verdict: "uncertain",
    confidence: 0.77,
    reason_code: "healthy_below_confidence_floor",
    call_count: 2,
    truncated: true,
    attention_sequence: 7,
    usage: { input_tokens: 100, output_tokens: 20 },
    estimated_cost_usd: 0.0004,
  });

  const persisted = JSON.parse(await readFile(record.watchdogLogPath, "utf8"));
  assert.equal(persisted.request_hash, "a".repeat(64));
  assert.equal(persisted.attention_sequence, 7);
  assert.equal(JSON.stringify(persisted).includes("original_prompt"), false);
  assert.equal(JSON.stringify(persisted).includes("recent_events"), false);
});

async function* semanticCheckpointTurn(
  clock: FakeClock,
) {
  for (const minute of [4, 8]) {
    clock.advance(4 * 60_000);
    yield {
      type: "raw.provider" as const,
      harness: "codex" as const,
      payload: { bytes: minute },
    };
  }
  clock.advance(2 * 60_000);
  yield {
    type: "message.delta" as const,
    message_id: "message_checkpoint",
    role: "assistant" as const,
    delta: "semantic checkpoint",
  };
  yield {
    type: "turn.completed" as const,
    final_text: "finished",
  };
}

function request(
  suspicionSignals: WatchdogRequest["suspicion_signals"] = [],
): WatchdogRequest {
  const value = {
    original_prompt: "Implement the task.",
    recent_events: [],
    tool_fingerprints: [],
    failure_fingerprints: [],
    elapsed_ms: 0,
    suspicion_signals: suspicionSignals,
    truncated: false,
  };
  return {
    ...value,
    input_bytes: Buffer.byteLength(JSON.stringify(value), "utf8"),
  };
}

class ClassifierSpy implements WatchdogClassifier {
  readonly calls: WatchdogRequest[] = [];

  constructor(private readonly result: WatchdogVerdict = {
    verdict: "healthy",
    confidence: 0.95,
    reason_code: "steady_progress",
    evidence: ["Progress is continuing."],
  }) {}

  async classify(requestValue: WatchdogRequest, _signal: AbortSignal): Promise<WatchdogVerdict> {
    this.calls.push(requestValue);
    return this.result;
  }
}

class FakeClock implements SupervisionScheduler {
  #now = Date.parse("2026-07-25T12:00:00.000Z");
  readonly #scheduled: {
    callback: () => void;
    dueAt: number;
    cancelled: boolean;
  }[] = [];
  readonly now = (): Date => new Date(this.#now);

  advance(milliseconds: number): void {
    this.#now += milliseconds;
    let next;
    while ((next = this.#scheduled
      .filter(({ cancelled, dueAt }) => !cancelled && dueAt <= this.#now)
      .sort((left, right) => left.dueAt - right.dueAt)[0]) !== undefined) {
      next.cancelled = true;
      next.callback();
    }
  }

  setTimeout(callback: () => void, delayMs: number): unknown {
    const scheduled = {
      callback,
      dueAt: this.#now + delayMs,
      cancelled: false,
    };
    this.#scheduled.push(scheduled);
    return scheduled;
  }

  clearTimeout(handle: unknown): void {
    (handle as { cancelled: boolean }).cancelled = true;
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
