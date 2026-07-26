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

test("scheduler drops malformed usage, cost, and output telemetry from injected classifiers", async () => {
  const clock = new FakeClock();
  let observed: WatchdogVerdict | undefined;
  const classifier: WatchdogClassifier = {
    async classify() {
      return {
        verdict: "healthy",
        confidence: 0.9,
        reason_code: "steady_progress",
        evidence: [],
        usage: {
          input_tokens: "100",
          output_tokens: Number.NaN,
        },
        estimated_cost_usd: "0.01",
        output_bytes: -1,
      } as unknown as WatchdogVerdict;
    },
  };
  const scheduler = new WatchdogScheduler({
    classifier,
    clock: clock.now,
    onVerdict: (_request, verdict) => {
      observed = verdict;
    },
  });

  clock.advance(10 * 60_000);
  await scheduler.onActiveEvidence(request());

  assert.deepEqual(observed, {
    verdict: "healthy",
    confidence: 0.9,
    reason_code: "steady_progress",
    evidence: [],
  });
});

test("scheduler caps oversized output telemetry at the bounded overflow marker", async () => {
  const clock = new FakeClock();
  let observed: WatchdogVerdict | undefined;
  const classifier: WatchdogClassifier = {
    async classify() {
      return {
        verdict: "uncertain",
        confidence: 0,
        reason_code: "classifier_output_too_large",
        evidence: [],
        output_bytes: 999_999,
      };
    },
  };
  const scheduler = new WatchdogScheduler({
    classifier,
    clock: clock.now,
    onVerdict: (_request, verdict) => {
      observed = verdict;
    },
  });

  clock.advance(10 * 60_000);
  await scheduler.onActiveEvidence(request());

  assert.equal(observed?.output_bytes, 2 * 1024 + 1);
});

test("scheduler settle bounds a hung classifier and persists an uncertain verdict", async () => {
  const clock = new FakeClock();
  const classifierStarted = deferred<void>();
  let classifierSignal: AbortSignal | undefined;
  let observed: WatchdogVerdict | undefined;
  const classifier: WatchdogClassifier = {
    async classify(_request, signal) {
      classifierSignal = signal;
      classifierStarted.resolve(undefined);
      return new Promise<WatchdogVerdict>(() => {});
    },
  };
  const scheduler = new WatchdogScheduler({
    classifier,
    clock: clock.now,
    scheduler: clock,
    policy: { timeoutMs: 25 },
    onVerdict: (_request, verdict) => {
      observed = verdict;
    },
  });

  clock.advance(10 * 60_000);
  void scheduler.onActiveEvidence(request());
  await classifierStarted.promise;
  const settling = scheduler.settle();

  clock.advance(24);
  await new Promise<void>((resolve) => setImmediate(resolve));
  assert.equal(observed, undefined);
  clock.advance(1);
  await settling;

  assert.equal(classifierSignal?.aborted, true);
  assert.deepEqual(observed, {
    verdict: "uncertain",
    confidence: 0,
    reason_code: "classifier_timeout",
    evidence: [],
  });
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

test("periodic backoff advances only after healthy verdicts and resets after uncertainty", async () => {
  const clock = new FakeClock();
  const classifier = new SequenceClassifier([
    {
      verdict: "derailed",
      confidence: 0.9,
      reason_code: "looping",
      evidence: [],
    },
    {
      verdict: "healthy",
      confidence: 0.9,
      reason_code: "steady_progress",
      evidence: [],
    },
    {
      verdict: "uncertain",
      confidence: 0.5,
      reason_code: "insufficient_evidence",
      evidence: [],
    },
    {
      verdict: "healthy",
      confidence: 0.9,
      reason_code: "recovered",
      evidence: [],
    },
  ]);
  const scheduler = new WatchdogScheduler({
    classifier,
    clock: clock.now,
  });

  clock.advance(10 * 60_000);
  await scheduler.onActiveEvidence(request());
  clock.advance(10 * 60_000);
  await scheduler.onActiveEvidence(request());
  assert.equal(classifier.calls.length, 2);

  clock.advance(20 * 60_000);
  await scheduler.onActiveEvidence(request());
  assert.equal(classifier.calls.length, 3);

  clock.advance(10 * 60_000);
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

test("mechanical-only provider events beyond every cadence checkpoint never invoke the classifier", async () => {
  const clock = new FakeClock();
  const classifier = new ClassifierSpy();
  async function* mechanicalOnlyTurn() {
    for (let minute = 4; minute <= 32; minute += 4) {
      clock.advance(4 * 60_000);
      yield {
        type: "raw.provider" as const,
        harness: "codex" as const,
        payload: { bytes: minute },
      };
    }
    clock.advance(60_000);
    yield {
      type: "status" as const,
      level: "warning" as const,
      code: "input_required",
      message: "Choose a migration.",
    };
    yield {
      type: "turn.completed" as const,
      final_text: "mechanically complete",
    };
  }
  const supervisor = new Supervisor({
    runId: "xrun_watchdog_mechanical_past_cadence",
    adapter: new FakeHarnessAdapter({ scriptedEvents: [mechanicalOnlyTurn()] }),
    startOptions: { cwd: process.cwd() },
    policy: { silenceTimeoutMs: 300_000, watchdog: {} },
    clock: clock.now,
    scheduler: clock,
    watchdogClassifier: classifier,
  });
  await supervisor.start();
  await supervisor.submit("implement");

  assert.equal(classifier.calls.length, 0);
});

test("a classifier verdict completed after close still persists aggregate cost and coverage", async () => {
  const clock = new FakeClock();
  const classifierStarted = deferred<void>();
  const releaseClassifier = deferred<void>();
  const releaseTurn = deferred<void>();
  const telemetry: WatchdogTelemetry[] = [];
  const metadata: Array<{
    watchdog: {
      invocation_count: number;
      coverage_exhausted?: boolean;
      estimated_cost_usd?: number;
    };
  }> = [];
  const reasons: string[] = [];
  const classifier: WatchdogClassifier = {
    async classify() {
      classifierStarted.resolve(undefined);
      await releaseClassifier.promise;
      return {
        verdict: "derailed",
        confidence: 0.9,
        reason_code: "looping",
        evidence: ["Repeated the same approach."],
        usage: { input_tokens: 100, output_tokens: 20 },
        estimated_cost_usd: 0.002,
        output_bytes: 200,
      };
    },
  };
  async function* activeTurn() {
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
      message_id: "message_terminal_edge",
      role: "assistant" as const,
      delta: "classify this",
    };
    await releaseTurn.promise;
    yield { type: "turn.completed" as const, final_text: "late completion" };
  }
  const supervisor = new Supervisor({
    runId: "xrun_watchdog_terminal_telemetry",
    adapter: new FakeHarnessAdapter({ scriptedEvents: [activeTurn()] }),
    startOptions: { cwd: process.cwd() },
    policy: {
      silenceTimeoutMs: 300_000,
      watchdog: { maximumCalls: 1 },
    },
    clock: clock.now,
    scheduler: clock,
    watchdogClassifier: classifier,
    watchdogTelemetrySink: async (entry) => {
      telemetry.push(entry);
    },
    metadataSink: async (state) => {
      metadata.push(state);
    },
    eventSink: async (event) => {
      reasons.push(event.reason);
    },
  });
  await supervisor.start();
  const submission = supervisor.submit("implement");
  await classifierStarted.promise;

  const closing = supervisor.close();
  releaseClassifier.resolve(undefined);
  await closing;
  releaseTurn.resolve(undefined);
  await submission;

  assert.equal(supervisor.inspect().phase, "completed");
  assert.equal(reasons.includes("watchdog_derailed"), false);
  assert.equal(telemetry[0]?.estimated_cost_usd, 0.002);
  assert.equal(metadata.at(-1)?.watchdog.invocation_count, 1);
  assert.equal(metadata.at(-1)?.watchdog.coverage_exhausted, true);
  assert.equal(metadata.at(-1)?.watchdog.estimated_cost_usd, 0.002);
});

test("a current-turn advisory verdict landing at ready still wakes the controller", async () => {
  const clock = new FakeClock();
  const classifierStarted = deferred<void>();
  const releaseClassifier = deferred<void>();
  const turnCompleted = deferred<void>();
  const telemetry: WatchdogTelemetry[] = [];
  const reasons: string[] = [];
  const classifier: WatchdogClassifier = {
    async classify() {
      classifierStarted.resolve(undefined);
      await releaseClassifier.promise;
      return {
        verdict: "derailed",
        confidence: 0.91,
        reason_code: "late_turn_loop",
        evidence: ["The completed turn repeated the same failed approach."],
      };
    },
  };
  const supervisor = new Supervisor({
    runId: "xrun_watchdog_ready_attention",
    adapter: new FakeHarnessAdapter({
      scriptedEvents: [semanticCheckpointTurn(clock)],
    }),
    startOptions: { cwd: process.cwd() },
    policy: { silenceTimeoutMs: 300_000, watchdog: {} },
    clock: clock.now,
    scheduler: clock,
    watchdogClassifier: classifier,
    watchdogTelemetrySink: async (entry) => {
      telemetry.push(entry);
    },
    eventSink: async (event) => {
      reasons.push(event.reason);
      if (event.reason === "turn_completed") {
        turnCompleted.resolve(undefined);
      }
    },
  });
  await supervisor.start();
  let submissionResolved = false;
  const submission = supervisor.submit("implement").then(() => {
    submissionResolved = true;
  });
  await classifierStarted.promise;
  await turnCompleted.promise;
  await waitForCondition(() => supervisor.inspect().phase === "ready");
  assert.equal(supervisor.inspect().phase, "ready");
  await new Promise<void>((resolve) => setImmediate(resolve));
  assert.equal(submissionResolved, false);

  releaseClassifier.resolve(undefined);
  await waitForCondition(() => telemetry.length === 1);
  await submission;

  assert.equal(reasons.includes("watchdog_derailed"), true);
  assert.equal(telemetry[0]?.attention_sequence, 5);
  assert.equal(supervisor.inspect().phase, "ready");
});

test("close settles the eighth classifier before coverage persistence can be lost", async () => {
  const clock = new FakeClock();
  const eighthClassifierStarted = deferred<void>();
  const releaseEighthClassifier = deferred<void>();
  const releaseTurn = deferred<void>();
  const telemetry: WatchdogTelemetry[] = [];
  const metadata: Array<{
    watchdog: {
      invocation_count: number;
      coverage_exhausted?: boolean;
      estimated_cost_usd?: number;
    };
  }> = [];
  let classifierCalls = 0;
  const classifier: WatchdogClassifier = {
    async classify() {
      classifierCalls += 1;
      if (classifierCalls === 8) {
        eighthClassifierStarted.resolve(undefined);
        await releaseEighthClassifier.promise;
      }
      return {
        verdict: "healthy",
        confidence: 0.94,
        reason_code: "steady_progress",
        evidence: [],
        estimated_cost_usd: 0.001,
      };
    },
  };
  async function* eightCheckpoints() {
    for (let call = 1; call <= 8; call += 1) {
      clock.advance(40 * 60_000);
      yield {
        type: "message.delta" as const,
        message_id: `message_checkpoint_${call}`,
        role: "assistant" as const,
        delta: `semantic checkpoint ${call}`,
      };
      await new Promise<void>((resolve) => setImmediate(resolve));
    }
    await releaseTurn.promise;
    yield { type: "turn.completed" as const, final_text: "late completion" };
  }
  const supervisor = new Supervisor({
    runId: "xrun_watchdog_close_eighth_call",
    adapter: new FakeHarnessAdapter({ scriptedEvents: [eightCheckpoints()] }),
    startOptions: { cwd: process.cwd() },
    policy: {
      silenceTimeoutMs: 300_000,
      watchdog: { maximumCalls: 8 },
    },
    clock: clock.now,
    scheduler: clock,
    watchdogClassifier: classifier,
    watchdogTelemetrySink: async (entry) => {
      telemetry.push(entry);
    },
    metadataSink: async (state) => {
      metadata.push(state);
    },
  });
  await supervisor.start();
  const submission = supervisor.submit("implement");
  await eighthClassifierStarted.promise;
  assert.equal(telemetry.length, 7);

  const closing = supervisor.close();
  setImmediate(() => {
    releaseEighthClassifier.resolve(undefined);
  });
  await closing;

  assert.equal(telemetry.length, 8);
  assert.equal(telemetry.at(-1)?.call_count, 8);
  assert.equal(metadata.at(-1)?.watchdog.invocation_count, 8);
  assert.equal(metadata.at(-1)?.watchdog.coverage_exhausted, true);
  assert.equal(metadata.at(-1)?.watchdog.estimated_cost_usd, 0.008);

  releaseTurn.resolve(undefined);
  await submission;
});

test("watchdog telemetry failure cannot poison close or its idempotent result", async () => {
  const clock = new FakeClock();
  const classifierStarted = deferred<void>();
  const releaseClassifier = deferred<void>();
  const releaseTurn = deferred<void>();
  const adapter = new FakeHarnessAdapter({
    scriptedEvents: [activeCheckpointThenWait(clock, releaseTurn.promise)],
  });
  const classifier: WatchdogClassifier = {
    async classify() {
      classifierStarted.resolve(undefined);
      await releaseClassifier.promise;
      return {
        verdict: "healthy",
        confidence: 0.94,
        reason_code: "steady_progress",
        evidence: [],
      };
    },
  };
  const supervisor = new Supervisor({
    runId: "xrun_watchdog_close_telemetry_failure",
    adapter,
    startOptions: { cwd: process.cwd() },
    policy: { silenceTimeoutMs: 300_000, watchdog: {} },
    clock: clock.now,
    scheduler: clock,
    watchdogClassifier: classifier,
    watchdogTelemetrySink: async () => {
      throw new Error("secondary watchdog telemetry failure");
    },
  });
  await supervisor.start();
  const submissionOutcome = supervisor.submit("implement").then(
    () => ({ status: "resolved" as const }),
    (error: unknown) => ({ status: "rejected" as const, error }),
  );
  await classifierStarted.promise;

  const firstClose = supervisor.close();
  const concurrentClose = supervisor.close();
  releaseClassifier.resolve(undefined);
  await assert.doesNotReject(Promise.all([firstClose, concurrentClose]));
  await assert.doesNotReject(supervisor.close());

  releaseTurn.resolve(undefined);
  assert.deepEqual(await submissionOutcome, { status: "resolved" });
  assert.equal(adapter.closeCount, 1);
  assert.equal(supervisor.inspect().phase, "completed");
});

test("watchdog telemetry failure alone cannot reject a successful submit", async () => {
  const clock = new FakeClock();
  const releaseClassifier = deferred<void>();
  const classifier: WatchdogClassifier = {
    async classify() {
      await releaseClassifier.promise;
      return {
        verdict: "healthy",
        confidence: 0.94,
        reason_code: "steady_progress",
        evidence: [],
      };
    },
  };
  const supervisor = new Supervisor({
    runId: "xrun_watchdog_submit_telemetry_failure",
    adapter: new FakeHarnessAdapter({
      scriptedEvents: [semanticCheckpointTurn(clock)],
    }),
    startOptions: { cwd: process.cwd() },
    policy: { silenceTimeoutMs: 300_000, watchdog: {} },
    clock: clock.now,
    scheduler: clock,
    watchdogClassifier: classifier,
    watchdogTelemetrySink: async () => {
      throw new Error("secondary watchdog telemetry failure");
    },
    eventSink: async (event) => {
      if (event.reason === "turn_completed") {
        setImmediate(() => {
          releaseClassifier.resolve(undefined);
        });
      }
    },
  });
  await supervisor.start();

  await assert.doesNotReject(supervisor.submit("implement"));
  assert.equal(supervisor.inspect().phase, "ready");
});

test("submit reports primary event persistence failure over watchdog telemetry failure", async () => {
  const clock = new FakeClock();
  const classifierStarted = deferred<void>();
  const releaseClassifier = deferred<void>();
  const primaryFailure = new Error("primary turn event persistence failure");
  const secondaryFailure = new Error("secondary watchdog telemetry failure");
  const classifier: WatchdogClassifier = {
    async classify() {
      classifierStarted.resolve(undefined);
      await releaseClassifier.promise;
      return {
        verdict: "healthy",
        confidence: 0.94,
        reason_code: "steady_progress",
        evidence: [],
      };
    },
  };
  const supervisor = new Supervisor({
    runId: "xrun_watchdog_primary_error_precedence",
    adapter: new FakeHarnessAdapter({
      scriptedEvents: [semanticCheckpointTurn(clock)],
    }),
    startOptions: { cwd: process.cwd() },
    policy: { silenceTimeoutMs: 300_000, watchdog: {} },
    clock: clock.now,
    scheduler: clock,
    watchdogClassifier: classifier,
    watchdogTelemetrySink: async () => {
      throw secondaryFailure;
    },
    eventSink: async (event) => {
      if (event.reason === "turn_completed") {
        releaseClassifier.resolve(undefined);
        throw primaryFailure;
      }
    },
  });
  await supervisor.start();
  const submission = supervisor.submit("implement");
  await classifierStarted.promise;

  await assert.rejects(submission, (error: unknown) => error === primaryFailure);
});

test("an in-flight classifier does not delay deterministic transport failure", async () => {
  const clock = new FakeClock();
  const classifierStarted = deferred<void>();
  const releaseClassifier = deferred<void>();
  const classifier: WatchdogClassifier = {
    async classify() {
      classifierStarted.resolve(undefined);
      await releaseClassifier.promise;
      return {
        verdict: "healthy",
        confidence: 0.9,
        reason_code: "steady_progress",
        evidence: [],
      };
    },
  };
  async function* activeThenFailedTurn() {
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
      message_id: "message_before_failure",
      role: "assistant" as const,
      delta: "active progress",
    };
    yield {
      type: "error" as const,
      code: "transport_lost",
      message: "provider stdout closed",
      recoverable: false,
    };
  }
  const supervisor = new Supervisor({
    runId: "xrun_watchdog_out_of_band",
    adapter: new FakeHarnessAdapter({ scriptedEvents: [activeThenFailedTurn()] }),
    startOptions: { cwd: process.cwd() },
    policy: { silenceTimeoutMs: 300_000, watchdog: {} },
    clock: clock.now,
    scheduler: clock,
    watchdogClassifier: classifier,
  });
  await supervisor.start();
  const submission = supervisor.submit("implement");
  await classifierStarted.promise;

  await waitForCondition(() => supervisor.inspect().phase === "failed");
  assert.equal(supervisor.inspect().phase, "failed");

  releaseClassifier.resolve(undefined);
  await submission;
});

test("a prior-turn verdict cannot publish attention into a later running turn", async () => {
  const clock = new FakeClock();
  const classifierStarted = deferred<void>();
  const releaseClassifier = deferred<void>();
  const releaseSecondTurn = deferred<void>();
  const reasons: string[] = [];
  const telemetry: WatchdogTelemetry[] = [];
  const classifier: WatchdogClassifier = {
    async classify() {
      classifierStarted.resolve(undefined);
      await releaseClassifier.promise;
      return {
        verdict: "derailed",
        confidence: 0.9,
        reason_code: "stale_turn_loop",
        evidence: ["This verdict belongs to the prior turn."],
      };
    },
  };
  async function* firstTurn() {
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
      message_id: "message_prior_turn",
      role: "assistant" as const,
      delta: "trigger classifier",
    };
    yield { type: "turn.completed" as const, final_text: "first complete" };
  }
  async function* secondTurn() {
    await releaseSecondTurn.promise;
    yield { type: "turn.completed" as const, final_text: "second complete" };
  }
  const supervisor = new Supervisor({
    runId: "xrun_watchdog_stale_turn",
    adapter: new FakeHarnessAdapter({
      scriptedEvents: [firstTurn(), secondTurn()],
    }),
    startOptions: { cwd: process.cwd() },
    policy: { silenceTimeoutMs: 300_000, watchdog: {} },
    clock: clock.now,
    scheduler: clock,
    watchdogClassifier: classifier,
    watchdogTelemetrySink: async (entry) => {
      telemetry.push(entry);
    },
    eventSink: async (event) => {
      reasons.push(event.reason);
    },
  });
  await supervisor.start();
  const firstSubmission = supervisor.submit("first");
  await classifierStarted.promise;
  await waitForCondition(() => supervisor.inspect().phase === "ready");
  const secondSubmission = supervisor.submit("second");
  await waitForCondition(() => supervisor.inspect().phase === "running");

  releaseClassifier.resolve(undefined);
  await waitForCondition(() => telemetry.length === 1);

  assert.equal(reasons.includes("watchdog_derailed"), false);
  assert.equal(supervisor.inspect().phase, "running");

  await firstSubmission;
  releaseSecondTurn.resolve(undefined);
  await secondSubmission;
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

test("classifier-authored attention evidence is sanitized before durable delivery", async () => {
  const clock = new FakeClock();
  const releaseTurn = deferred<void>();
  const attentionSeen = deferred<{
    readonly payload?: unknown;
  }>();
  const repoRoot = process.cwd();
  const classifier = new ClassifierSpy({
    verdict: "derailed",
    confidence: 0.9,
    reason_code: "secret_path_echo",
    evidence: [`Read ${repoRoot}/.env api_key=classifier-secret`],
  });
  async function* activeTurn() {
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
      message_id: "message_sanitized_attention",
      role: "assistant" as const,
      delta: "active",
    };
    await releaseTurn.promise;
    yield { type: "turn.completed" as const, final_text: "finished" };
  }
  const supervisor = new Supervisor({
    runId: "xrun_watchdog_sanitized_attention",
    adapter: new FakeHarnessAdapter({ scriptedEvents: [activeTurn()] }),
    startOptions: { cwd: repoRoot },
    policy: { silenceTimeoutMs: 300_000, watchdog: {} },
    clock: clock.now,
    scheduler: clock,
    watchdogClassifier: classifier,
    eventSink: async (event) => {
      if (event.reason === "watchdog_derailed") {
        attentionSeen.resolve(event);
      }
    },
  });
  await supervisor.start();
  const submission = supervisor.submit("implement");
  const attention = await attentionSeen.promise;

  assert.deepEqual(attention.payload, {
    verdict: "derailed",
    confidence: 0.9,
    reason_code: "secret_path_echo",
    evidence: ["Read ./.env api_key=[REDACTED]"],
  });

  releaseTurn.resolve(undefined);
  await submission;
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
        await new Promise<void>((resolve) => setImmediate(resolve));
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

async function* activeCheckpointThenWait(
  clock: FakeClock,
  release: Promise<void>,
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
    message_id: "message_waiting_checkpoint",
    role: "assistant" as const,
    delta: "semantic checkpoint",
  };
  await release;
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

class SequenceClassifier implements WatchdogClassifier {
  readonly calls: WatchdogRequest[] = [];
  #index = 0;

  constructor(private readonly results: readonly WatchdogVerdict[]) {}

  async classify(requestValue: WatchdogRequest): Promise<WatchdogVerdict> {
    this.calls.push(requestValue);
    const result = this.results[this.#index];
    this.#index += 1;
    assert.ok(result);
    return result;
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

async function waitForCondition(predicate: () => boolean): Promise<void> {
  for (let attempt = 0; attempt < 20; attempt += 1) {
    if (predicate()) {
      return;
    }
    await new Promise<void>((resolve) => setImmediate(resolve));
  }
  assert.fail("condition was not observed");
}
