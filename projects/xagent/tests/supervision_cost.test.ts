import assert from "node:assert/strict";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { Readable, Writable } from "node:stream";
import test from "node:test";

import { FakeHarnessAdapter } from "../src/adapters/fake.js";
import type { AdapterEvent } from "../src/adapters/types.js";
import { main } from "../src/cli.js";
import {
  createShutdownController,
  createXagentServer,
  type XagentServer,
} from "../src/service/server.js";
import { x_DefaultAwaitDeadlineSeconds } from "../src/service/tool_schemas.js";
import { XagentRunManager } from "../src/service/run_manager.js";
import type {
  SupervisionPolicy,
  SupervisionScheduler,
  WatchdogClassifier,
  WatchdogRequest,
  WatchdogVerdict,
} from "../src/supervision/types.js";

const x_RunDurationMs = 90 * 60_000;
const x_ProgressIntervalMs = 60_000;
const x_PollIntervalMs = 30_000;
const x_ExpectedWatchdogCalls = 3;
const x_DefaultSupervisionPolicy: SupervisionPolicy = {
  silenceTimeoutMs: 300_000,
  watchdog: {},
};

test("90-minute healthy run: MCP await wakes once; quiet client measured; polling analytic", async () => {
  const clock = new FakeClock(0);
  const scheduler = new FakeScheduler(clock);
  const classifier = new NoCallClassifier();
  const logRoot = await mkdtemp(path.join(tmpdir(), "xagent-cost-"));

  const afterSustainedProgress = deferred<void>();
  const releaseTurn = deferred<void>();
  async function* sustainedHealthyTurn(): AsyncIterable<AdapterEvent> {
    for (let minute = 1; minute <= x_RunDurationMs / x_ProgressIntervalMs; minute += 1) {
      clock.advance(x_ProgressIntervalMs);
      yield {
        type: "message.delta",
        message_id: "m1",
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
      message_id: "m_final",
      role: "assistant",
      text: "complete final assistant message",
    };
    yield {
      type: "turn.completed",
      final_text: "complete final assistant message",
      provider_thread_id: "fake-thread-1",
    };
  }

  const runManager = new XagentRunManager({
    repoRoot: process.cwd(),
    logRoot,
    adapterFactory: () => new FakeHarnessAdapter({ scriptedEvents: [sustainedHealthyTurn()] }),
    policy: x_DefaultSupervisionPolicy,
    clock: () => clock.toDate(),
    scheduler: scheduler as SupervisionScheduler,
    watchdogClassifier: classifier,
  });

  const cwd = await mkdtemp(path.join(tmpdir(), "xagent-cost-cwd-"));
  const { runId } = await runManager.create({ harness: "codex", mode: "subagent", cwd });
  await runManager.start(runId);
  const cursor = runManager.inspect(runId)!.sequence;

  const awaiting = runManager.awaitRun({
    run_id: runId,
    after_sequence: cursor,
    deadline_seconds: x_DefaultAwaitDeadlineSeconds,
  });
  const turn = runManager.submit(runId, "long healthy work");
  await afterSustainedProgress.promise;

  let settledDuringRun = false;
  void awaiting.then(() => {
    settledDuringRun = true;
  });
  await Promise.resolve();
  assert.equal(
    settledDuringRun,
    false,
    "healthy 90-minute run must not settle the MCP await before turn completion",
  );
  // The classifier is invoked asynchronously off the evidence thunk, so the
  // count trails the fake clock's cadence checkpoints by an unbounded number
  // of macrotasks. Under parallel-suite load that lag exceeds the single
  // `await Promise.resolve()` above and the count reads low — a real property
  // failing a scheduling assumption, not a real regression. Drain until the
  // cadence has caught up, then assert exactly.
  //
  for (
    let attempt = 0;
    attempt < 500 && classifier.calls.length < x_ExpectedWatchdogCalls;
    attempt += 1
  ) {
    await new Promise<void>((resolve) => {
      setImmediate(resolve);
    });
  }
  assert.equal(
    classifier.calls.length,
    x_ExpectedWatchdogCalls,
    "watchdog must run at default cadence checkpoints during sustained healthy progress",
  );

  releaseTurn.resolve(undefined);
  const result = await awaiting;
  await turn;

  assert.equal(result.event, "turn.completed");
  assert.equal((result as unknown as { elapsed_ms: number }).elapsed_ms, x_RunDurationMs);

  const envelope = result as unknown as Record<string, unknown>;
  assert.equal("deltas" in envelope, false);
  assert.equal("tools" in envelope, false);
  assert.equal("progress" in envelope, false);
  assert.ok(envelope.report !== undefined);

  const pollingWakes = simulatePollingWakes(x_RunDurationMs, x_PollIntervalMs);
  assert.equal(pollingWakes, 180, "30-second polling is expected to wake 180 times over 90 minutes");

  const quietClientWakes = await measureQuietSuperviseStdoutLines();
  assert.equal(
    quietClientWakes,
    1,
    "quiet CLI fallback must emit exactly one stdout line for terminal completion",
  );

  await runManager.closeAll();
});

function simulatePollingWakes(runDurationMs: number, pollIntervalMs: number): number {
  let wakes = 0;
  for (let elapsedMs = pollIntervalMs; elapsedMs <= runDurationMs; elapsedMs += pollIntervalMs) {
    wakes += 1;
  }
  return wakes;
}

async function measureQuietSuperviseStdoutLines(): Promise<number> {
  const clock = new FakeClock(0);
  const scheduler = new FakeScheduler(clock);
  const classifier = new NoCallClassifier();
  const logRoot = await mkdtemp(path.join(tmpdir(), "xagent-cost-quiet-"));
  const afterSustainedProgress = deferred<void>();
  const releaseTurn = deferred<void>();
  async function* sustainedHealthyTurn(): AsyncIterable<AdapterEvent> {
    for (let minute = 1; minute <= x_RunDurationMs / x_ProgressIntervalMs; minute += 1) {
      clock.advance(x_ProgressIntervalMs);
      yield {
        type: "message.delta",
        message_id: "m1",
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
      message_id: "m_final",
      role: "assistant",
      text: "complete final assistant message",
    };
    yield {
      type: "turn.completed",
      final_text: "complete final assistant message",
      provider_thread_id: "fake-thread-1",
    };
  }

  const runManager = new XagentRunManager({
    repoRoot: process.cwd(),
    logRoot,
    adapterFactory: () => new FakeHarnessAdapter({ scriptedEvents: [sustainedHealthyTurn()] }),
    policy: x_DefaultSupervisionPolicy,
    clock: () => clock.toDate(),
    scheduler: scheduler as SupervisionScheduler,
    watchdogClassifier: classifier,
  });

  let server: XagentServer | undefined;
  const shutdownController = createShutdownController({
    closeRuns: async () => {
      await runManager.closeAll();
    },
    closeServer: async () => {
      await server?.close();
    },
  });
  server = createXagentServer({
    bindHost: "127.0.0.1",
    bindPort: 0,
    runManager,
    shutdownController,
  });
  const port = await server.listen();
  const baseUrl = `http://127.0.0.1:${port}`;
  const cwd = await mkdtemp(path.join(tmpdir(), "xagent-cost-quiet-cwd-"));

  try {
    const stdout = new MemoryWritable();
    const stderr = new MemoryWritable();
    const supervisePromise = main(
      [
        "supervise",
        "--harness",
        "codex",
        "--cwd",
        cwd,
        "--deadline-seconds",
        String(x_DefaultAwaitDeadlineSeconds),
        "long healthy work",
      ],
      Readable.from([]),
      stdout,
      stderr,
      cwd,
      { serviceBaseUrl: baseUrl },
    );

    await afterSustainedProgress.promise;
    assert.equal(stdout.text, "", "quiet supervise must not emit stdout during healthy progress");
    assert.equal(stderr.text, "");

    releaseTurn.resolve(undefined);
    const result = await supervisePromise;
    assert.deepEqual(result, { exitCode: 0 });
    assert.equal(stderr.text, "");

    const lines = stdout.text.trim().split("\n").filter(Boolean);
    assert.equal(lines.length, 1);
    const body = JSON.parse(lines[0]!) as Record<string, unknown>;
    assert.equal(body.event, "turn.completed");
    assert.equal(
      (body.report as { text: string }).text,
      "complete final assistant message",
    );
    return lines.length;
  } finally {
    if (!shutdownController.wasShutdownRequested()) {
      await server.close();
    }
    await runManager.closeAll();
  }
}

class NoCallClassifier implements WatchdogClassifier {
  readonly calls: WatchdogRequest[] = [];
  async classify(request: WatchdogRequest): Promise<WatchdogVerdict> {
    this.calls.push(request);
    return { verdict: "healthy", confidence: 0.95, reason_code: "steady_progress", evidence: [] };
  }
}

class MemoryWritable extends Writable {
  text = "";

  override _write(
    chunk: Buffer | string,
    _encoding: BufferEncoding,
    callback: (error?: Error | null) => void,
  ): void {
    this.text += chunk.toString();
    callback();
  }
}

class FakeClock {
  private ms: number;
  constructor(startMs: number) { this.ms = startMs; }
  advance(deltaMs: number): void { this.ms += deltaMs; }
  toMillis(): number { return this.ms; }
  toDate(): Date { return new Date(this.ms); }
}

class FakeScheduler implements SupervisionScheduler {
  private readonly timers = new Map<number, { callback: () => void; fireAt: number }>();
  private nextId = 0;
  private readonly clock: FakeClock;
  constructor(clock: FakeClock) { this.clock = clock; }
  setTimeout(callback: () => void, delayMs: number): number {
    this.nextId += 1;
    this.timers.set(this.nextId, { callback, fireAt: this.clock.toMillis() + Math.max(0, delayMs) });
    return this.nextId;
  }
  clearTimeout(handle: unknown): void { this.timers.delete(handle as number); }
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

function deferred<T>(): { promise: Promise<T>; resolve: (value: T) => void } {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((res) => { resolve = res; });
  return { promise, resolve };
}
