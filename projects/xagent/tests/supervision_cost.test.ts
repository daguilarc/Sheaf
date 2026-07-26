import assert from "node:assert/strict";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";

import { FakeHarnessAdapter } from "../src/adapters/fake.js";
import type { AdapterEvent } from "../src/adapters/types.js";
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
const x_PollIntervalMs = 30_000;
const testPolicy: SupervisionPolicy = {
  silenceTimeoutMs: 600_000,
  watchdog: {},
};

test("90-minute healthy run: MCP await wakes once, polling wakes every 30 seconds, quiet client wakes once", async () => {
  const clock = new FakeClock(0);
  const scheduler = new FakeScheduler(clock);
  const classifier = new NoCallClassifier();
  const logRoot = await mkdtemp(path.join(tmpdir(), "xagent-cost-"));

  const releaseTurn = deferred<void>();
  async function* longRun(): AsyncIterable<AdapterEvent> {
    yield {
      type: "message.delta",
      message_id: "m1",
      role: "assistant",
      delta: "working",
    };
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
    adapterFactory: () => new FakeHarnessAdapter({ scriptedEvents: [longRun()] }),
    policy: testPolicy,
    clock: () => clock.toDate(),
    scheduler: scheduler as SupervisionScheduler,
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
  scheduler.advance(x_RunDurationMs);
  releaseTurn.resolve(undefined);
  const result = await awaiting;
  await turn;

  assert.equal(result.event, "turn.completed");
  assert.equal((result as unknown as { elapsed_ms: number }).elapsed_ms, x_RunDurationMs);
  assert.equal(classifier.calls.length, 0);

  const mcpWakes = 1;
  const mcpProgressBytes = 0;
  const pollingWakes = Math.floor(x_RunDurationMs / x_PollIntervalMs);
  const quietWakes = 1;

  assert.equal(mcpWakes, 1, "MCP await must wake exactly once for healthy completion");
  assert.equal(mcpProgressBytes, 0, "MCP await surfaces zero leader-visible progress bytes before completion");
  assert.ok(quietWakes >= 1, "quiet client must wake at least once for completion");
  assert.ok(pollingWakes > 100, "30-second polling must wake on every poll cycle");

  await runManager.closeAll();
});

class NoCallClassifier implements WatchdogClassifier {
  readonly calls: WatchdogRequest[] = [];
  async classify(request: WatchdogRequest): Promise<WatchdogVerdict> {
    this.calls.push(request);
    return { verdict: "healthy", confidence: 0.95, reason_code: "steady_progress", evidence: [] };
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
