import assert from "node:assert/strict";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { Readable, Writable } from "node:stream";
import test from "node:test";

import type { OutputEvent, OutputEventBody } from "../src/events.js";
import { FakeHarnessAdapter } from "../src/adapters/fake.js";
import type { AdapterEvent, HarnessAdapter, HarnessSession, HarnessStartOptions } from "../src/adapters/types.js";
import { createOutputFilter } from "../src/filter.js";
import { getDefaultLogRoot, listRuns } from "../src/logs.js";
import { runSession } from "../src/runtime.js";

test("runtime emits startup, preserves the fake adapter session across turns, and becomes ready after each turn", async () => {
  const repoRoot = await mkdtemp(path.join(tmpdir(), "xagent-runtime-"));
  const adapter = new FakeHarnessAdapter();
  const stdout = new MemoryWritable();

  await runSession({
    harness: "codex",
    mode: "subagent",
    repoRoot,
    cwd: repoRoot,
    stdin: Readable.from([
      JSON.stringify({ type: "user.message", text: "first" }),
      "\n",
      JSON.stringify({ type: "user.message", text: "second" }),
      "\n",
      JSON.stringify({ type: "control.exit" }),
      "\n",
    ]),
    stdout,
    adapter,
    runId: "xrun_runtime",
    clock: fixedClock(),
  });

  const events = parseJsonl(stdout.text);
  assert.deepEqual(
    events.slice(0, 2).map((event) => event.type),
    ["session.started", "session.ready"],
  );

  assert.deepEqual(adapter.submittedTexts, ["first", "second"]);
  assert.deepEqual(adapter.submittedContexts, [
    { text: "first", turnId: "turn_1", inputSequence: 1 },
    { text: "second", turnId: "turn_2", inputSequence: 2 },
  ]);
  assert.equal(adapter.startCount, 1);
  assert.equal(adapter.closeCount, 1);

  const turnOne = events.filter((event) => eventHasTurnId(event, "turn_1")).map((event) => event.type);
  const turnTwo = events.filter((event) => eventHasTurnId(event, "turn_2")).map((event) => event.type);
  assert.deepEqual(turnOne, ["turn.started", "message.completed", "turn.completed"]);
  assert.deepEqual(turnTwo, ["turn.started", "message.completed", "turn.completed"]);

  const readySequences = events
    .filter((event) => event.type === "session.ready")
    .map((event) => event.sequence);
  assert.deepEqual(readySequences, [2, 6, 10]);
});

test("runtime treats blank stdin lines as invalid input commands", async () => {
  const repoRoot = await mkdtemp(path.join(tmpdir(), "xagent-runtime-"));
  const stdout = new MemoryWritable();

  await runSession({
    harness: "codex",
    mode: "subagent",
    repoRoot,
    cwd: repoRoot,
    stdin: Readable.from(["\n", JSON.stringify({ type: "control.exit" }), "\n"]),
    stdout,
    adapter: new FakeHarnessAdapter(),
    runId: "xrun_blank_input",
    clock: fixedClock(),
  });

  const error = parseJsonl(stdout.text).find((event) => event.type === "error");
  assert.equal(error !== undefined && "code" in error ? error.code : undefined, "invalid_input_json");
});

test("subagent mode suppresses routine tool output and raw provider events from stdout", async () => {
  const repoRoot = await mkdtemp(path.join(tmpdir(), "xagent-runtime-"));
  const stdout = new MemoryWritable();

  await runSession({
    harness: "codex",
    mode: "subagent",
    repoRoot,
    cwd: repoRoot,
    stdin: Readable.from([
      JSON.stringify({ type: "user.message", text: "use tool" }),
      "\n",
      JSON.stringify({ type: "control.exit" }),
      "\n",
    ]),
    stdout,
    adapter: new FakeHarnessAdapter({ includeToolEvents: true, includeRawProvider: true }),
    runId: "xrun_subagent",
    clock: fixedClock(),
  });

  const events = parseJsonl(stdout.text);
  assert.equal(events.some((event) => event.type === "raw.provider"), false);
  assert.equal(
    events.some((event) => event.type === "tool.completed" && "output" in event),
    false,
  );
});

test("full mode includes raw provider and normalized tool events", async () => {
  const repoRoot = await mkdtemp(path.join(tmpdir(), "xagent-runtime-"));
  const stdout = new MemoryWritable();

  await runSession({
    harness: "codex",
    mode: "full",
    repoRoot,
    cwd: repoRoot,
    stdin: Readable.from([
      JSON.stringify({ type: "user.message", text: "use tool" }),
      "\n",
      JSON.stringify({ type: "control.exit" }),
      "\n",
    ]),
    stdout,
    adapter: new FakeHarnessAdapter({ includeToolEvents: true, includeRawProvider: true }),
    runId: "xrun_full",
    clock: fixedClock(),
  });

  const types = parseJsonl(stdout.text).map((event) => event.type);
  assert.equal(types.includes("raw.provider"), true);
  assert.equal(types.includes("tool.started"), true);
  assert.equal(types.includes("tool.completed"), true);
});

test("full mode emits rawProvider side-channel payloads as raw.provider events", async () => {
  const repoRoot = await mkdtemp(path.join(tmpdir(), "xagent-runtime-"));
  const stdout = new MemoryWritable();

  await runSession({
    harness: "codex",
    mode: "full",
    repoRoot,
    cwd: repoRoot,
    stdin: Readable.from([
      JSON.stringify({ type: "user.message", text: "side channel" }),
      "\n",
      JSON.stringify({ type: "control.exit" }),
      "\n",
    ]),
    stdout,
    adapter: new SideChannelRawAdapter(),
    runId: "xrun_side_raw",
    clock: fixedClock(),
  });

  const rawEvents = parseJsonl(stdout.text).filter((event) => event.type === "raw.provider");
  assert.equal(rawEvents.length, 1);
  assert.deepEqual(rawEvents[0], {
    schema_version: 1,
    type: "raw.provider",
    run_id: "xrun_side_raw",
    sequence: 4,
    timestamp: "2026-06-21T00:00:00.000Z",
    harness: "codex",
    payload: { provider_event: "side-channel" },
  });
});

test("runtime uses its turn context when adapter events omit lifecycle turn ids", async () => {
  const repoRoot = await mkdtemp(path.join(tmpdir(), "xagent-runtime-"));
  const stdout = new MemoryWritable();

  await runSession({
    harness: "codex",
    mode: "subagent",
    repoRoot,
    cwd: repoRoot,
    stdin: Readable.from([
      JSON.stringify({ type: "user.message", text: "context" }),
      "\n",
      JSON.stringify({ type: "control.exit" }),
      "\n",
    ]),
    stdout,
    adapter: new ContextOnlyAdapter(),
    runId: "xrun_context",
    clock: fixedClock(),
  });

  const completed = parseJsonl(stdout.text).find((event) => event.type === "message.completed");
  assert.equal(completed !== undefined && "turn_id" in completed ? completed.turn_id : undefined, "turn_1");
});

test("runtime fills empty turn final text from the last assistant message", async () => {
  const repoRoot = await mkdtemp(path.join(tmpdir(), "xagent-runtime-"));
  const stdout = new MemoryWritable();

  await runSession({
    harness: "codex",
    mode: "subagent",
    repoRoot,
    cwd: repoRoot,
    stdin: Readable.from([
      JSON.stringify({ type: "user.message", text: "context" }),
      "\n",
      JSON.stringify({ type: "control.exit" }),
      "\n",
    ]),
    stdout,
    adapter: new EmptyFinalTextAdapter(),
    runId: "xrun_empty_final_text",
    clock: fixedClock(),
  });

  const turnCompleted = parseJsonl(stdout.text).find((event) => event.type === "turn.completed");
  assert.equal(turnCompleted !== undefined && "final_text" in turnCompleted ? turnCompleted.final_text : undefined, "adapter answer");
});

test("raw provider events are not duplicated when event body is already raw.provider", async () => {
  const repoRoot = await mkdtemp(path.join(tmpdir(), "xagent-runtime-"));
  const stdout = new MemoryWritable();

  await runSession({
    harness: "codex",
    mode: "full",
    repoRoot,
    cwd: repoRoot,
    stdin: Readable.from([
      JSON.stringify({ type: "user.message", text: "raw body" }),
      "\n",
      JSON.stringify({ type: "control.exit" }),
      "\n",
    ]),
    stdout,
    adapter: new RawBodyAdapter(),
    runId: "xrun_raw_body",
    clock: fixedClock(),
  });

  const rawEvents = parseJsonl(stdout.text).filter((event) => event.type === "raw.provider");
  assert.equal(rawEvents.length, 1);
});

test("runSession returns success after a failed turn when shutdown is orderly", async () => {
  const repoRoot = await mkdtemp(path.join(tmpdir(), "xagent-runtime-"));
  const stdout = new MemoryWritable();

  const result = await runSession({
    harness: "codex",
    mode: "subagent",
    repoRoot,
    cwd: repoRoot,
    stdin: Readable.from([
      JSON.stringify({ type: "user.message", text: "fail" }),
      "\n",
      JSON.stringify({ type: "control.exit" }),
      "\n",
    ]),
    stdout,
    adapter: new FailingTurnAdapter(),
    runId: "xrun_failed",
    clock: fixedClock(),
  });

  assert.deepEqual(result, { exitCode: 0 });
  const events = parseJsonl(stdout.text);
  assert.equal(events.some((event) => event.type === "turn.failed"), true);
  const ended = events.find((event) => event.type === "session.ended");
  assert.deepEqual(ended !== undefined && ended.type === "session.ended" ? [ended.reason, ended.exit_code] : undefined, [
    "input_closed",
    0,
  ]);
  const runs = await listRuns(getDefaultLogRoot(repoRoot));
  assert.equal(runs[0]?.exit_status, "completed");
});

test("adapter start failures emit structured JSONL and update metadata away from running", async () => {
  const repoRoot = await mkdtemp(path.join(tmpdir(), "xagent-runtime-"));
  const stdout = new MemoryWritable();

  const result = await runSession({
    harness: "codex",
    mode: "subagent",
    repoRoot,
    cwd: repoRoot,
    stdin: Readable.from([]),
    stdout,
    adapter: new StartFailAdapter(),
    runId: "xrun_start_fail",
    clock: fixedClock(),
  });

  assert.deepEqual(result, { exitCode: 1 });
  const events = parseJsonl(stdout.text);
  assert.deepEqual(events.map((event) => event.type), ["error", "session.ended"]);
  assert.equal(events[0]?.type === "error" ? events[0].code : undefined, "harness_unavailable");
  assert.deepEqual(events[1]?.type === "session.ended" ? [events[1].reason, events[1].exit_code] : undefined, [
    "start_failed",
    1,
  ]);
  const runs = await listRuns(getDefaultLogRoot(repoRoot));
  assert.equal(runs[0]?.exit_status, "failed");
  const normalizedLog = await readFile(path.join(repoRoot, "data", "xagent", "xrun_start_fail", "normalized.jsonl"), "utf8");
  assert.equal(normalizedLog.includes("\"code\":\"harness_unavailable\""), true);
});

test("log root failures emit structured JSONL before starting a harness", async () => {
  const repoRoot = await mkdtemp(path.join(tmpdir(), "xagent-runtime-"));
  const blockedParent = path.join(await mkdtemp(path.join(tmpdir(), "xagent-blocked-log-")), "file");
  await writeFile(blockedParent, "not a directory");
  const stdout = new MemoryWritable();

  const result = await runSession({
    harness: "codex",
    mode: "subagent",
    repoRoot,
    logRoot: path.join(blockedParent, "xagent"),
    cwd: repoRoot,
    stdin: Readable.from([]),
    stdout,
    adapter: new FakeHarnessAdapter(),
    runId: "xrun_log_root_unavailable",
    clock: fixedClock(),
  });

  assert.deepEqual(result, { exitCode: 1 });
  const events = parseJsonl(stdout.text);
  assert.deepEqual(events.map((event) => event.type), ["error", "session.ended"]);
  assert.equal(events[0]?.type === "error" ? events[0].code : undefined, "log_root_unavailable");
  assert.deepEqual(events[1]?.type === "session.ended" ? [events[1].reason, events[1].exit_code] : undefined, [
    "log_root_unavailable",
    1,
  ]);
});

test("session close failures update metadata away from running", async () => {
  const repoRoot = await mkdtemp(path.join(tmpdir(), "xagent-runtime-"));
  const stdout = new MemoryWritable();

  await assert.rejects(
    () =>
      runSession({
        harness: "codex",
        mode: "subagent",
        repoRoot,
        cwd: repoRoot,
        stdin: Readable.from([JSON.stringify({ type: "control.exit" }), "\n"]),
        stdout,
        adapter: new CloseFailAdapter(),
        runId: "xrun_close_fail",
        clock: fixedClock(),
      }),
    /close failed/,
  );

  const runs = await listRuns(getDefaultLogRoot(repoRoot));
  assert.equal(runs[0]?.exit_status, "failed");
  const ended = parseJsonl(stdout.text).filter((event) => event.type === "session.ended");
  assert.deepEqual(ended.map((event) => event.type === "session.ended" ? [event.reason, event.exit_code] : []), [
    ["close_failed", 1],
  ]);
});

test("emit failures update metadata away from running", async () => {
  const repoRoot = await mkdtemp(path.join(tmpdir(), "xagent-runtime-"));
  const stdout = new FailingWritable();
  stdout.on("error", () => {});

  await assert.rejects(
    () =>
      runSession({
        harness: "codex",
        mode: "subagent",
        repoRoot,
        cwd: repoRoot,
        stdin: Readable.from([JSON.stringify({ type: "control.exit" }), "\n"]),
        stdout,
        adapter: new FakeHarnessAdapter(),
        runId: "xrun_emit_fail",
        clock: fixedClock(),
      }),
    /stdout failed/,
  );

  const runs = await listRuns(getDefaultLogRoot(repoRoot));
  assert.equal(runs[0]?.exit_status, "failed");
});

test("runtime emits warnings when selected adapter ignores requested model or thinking level", async () => {
  const repoRoot = await mkdtemp(path.join(tmpdir(), "xagent-runtime-"));
  const stdout = new MemoryWritable();
  const adapter = new UnsupportedOptionsAdapter();

  await runSession({
    harness: "codex",
    mode: "subagent",
    model: "gpt-test",
    thinkingLevel: "high",
    repoRoot,
    cwd: repoRoot,
    stdin: Readable.from([JSON.stringify({ type: "control.exit" }), "\n"]),
    stdout,
    adapter,
    runId: "xrun_capability_warnings",
    clock: fixedClock(),
  });

  assert.deepEqual(adapter.startOptions, {
    cwd: repoRoot,
    model: undefined,
    thinkingLevel: undefined,
  });
  const warnings = parseJsonl(stdout.text).filter((event) => event.type === "status" && event.level === "warning");
  assert.deepEqual(
    warnings.map((event) => event.type === "status" ? event.code : undefined),
    ["model_ignored", "thinking_level_ignored"],
  );
});

test("runtime maps a structured process_exit error event to turn.failed for legacy controllers", async () => {
  const repoRoot = await mkdtemp(path.join(tmpdir(), "xagent-runtime-"));
  const stdout = new MemoryWritable();

  const result = await runSession({
    harness: "codex",
    mode: "subagent",
    repoRoot,
    cwd: repoRoot,
    stdin: Readable.from([
      JSON.stringify({ type: "user.message", text: "crash" }),
      "\n",
      JSON.stringify({ type: "control.exit" }),
      "\n",
    ]),
    stdout,
    adapter: new ProcessExitAdapter(),
    runId: "xrun_process_exit",
    clock: fixedClock(),
  });

  assert.deepEqual(result, { exitCode: 0 });
  const events = parseJsonl(stdout.text);
  const turnFailed = events.find((event) => event.type === "turn.failed");
  assert.ok(turnFailed, "runtime must emit turn.failed when the provider process exits non-zero");
  assert.equal(turnFailed?.type === "turn.failed" ? turnFailed.code : undefined, "harness_process_failed");
  assert.equal(turnFailed?.type === "turn.failed" ? turnFailed.turn_id : undefined, "turn_1");
  assert.deepEqual(
    turnFailed?.type === "turn.failed" ? turnFailed.details : undefined,
    { exit_code: 137, signal: null },
  );
  const ended = events.find((event) => event.type === "session.ended");
  assert.deepEqual(ended !== undefined && ended.type === "session.ended" ? [ended.reason, ended.exit_code] : undefined, [
    "input_closed",
    0,
  ]);
});

class ProcessExitAdapter implements HarnessAdapter {
  readonly harness = "codex";
  readonly capabilities = {
    forwardsModel: false,
    forwardsThinkingLevel: false,
    streamsDeltas: false,
  };

  async start(): Promise<HarnessSession> {
    return {
      async *submit(): AsyncIterable<AdapterEvent> {
        yield {
          type: "error",
          code: "process_exit",
          message: "codex process exited with code 137.",
          details: { exit_code: 137, signal: null },
          recoverable: false,
        };
      },
      async close(): Promise<void> {},
    };
  }
}

test("runtime forwards an explicit permission mode to the adapter", async () => {
  const repoRoot = await mkdtemp(path.join(tmpdir(), "xagent-runtime-"));
  const stdout = new MemoryWritable();
  const adapter = new UnsupportedOptionsAdapter();

  await runSession({
    harness: "codex",
    mode: "subagent",
    permissionMode: "acceptEdits",
    repoRoot,
    cwd: repoRoot,
    stdin: Readable.from([JSON.stringify({ type: "control.exit" }), "\n"]),
    stdout,
    adapter,
    runId: "xrun_permission_mode",
    clock: fixedClock(),
  });

  assert.equal(adapter.startOptions?.permissionMode, "acceptEdits");
});

class SideChannelRawAdapter implements HarnessAdapter {
  readonly harness = "codex";
  readonly capabilities = {
    forwardsModel: false,
    forwardsThinkingLevel: false,
    streamsDeltas: false,
  };

  async start(): Promise<HarnessSession> {
    return {
      async *submit(): AsyncIterable<AdapterEvent> {
        yield {
          type: "status",
          level: "info",
          message: "observed provider event",
          rawProvider: { provider_event: "side-channel" },
        };
      },
      async close(): Promise<void> {},
    };
  }
}

class ContextOnlyAdapter implements HarnessAdapter {
  readonly harness = "codex";
  readonly capabilities = {
    forwardsModel: false,
    forwardsThinkingLevel: false,
    streamsDeltas: false,
  };

  async start(): Promise<HarnessSession> {
    return {
      async *submit(context): AsyncIterable<AdapterEvent> {
        yield {
          type: "message.completed",
          message_id: "m1",
          role: "assistant",
          text: `context ${context.turnId}`,
        };
        yield {
          type: "turn.completed",
          final_text: `context ${context.inputSequence}`,
        };
      },
      async close(): Promise<void> {},
    };
  }
}

class EmptyFinalTextAdapter implements HarnessAdapter {
  readonly harness = "codex";
  readonly capabilities = {
    forwardsModel: false,
    forwardsThinkingLevel: false,
    streamsDeltas: false,
  };

  async start(): Promise<HarnessSession> {
    return {
      async *submit(): AsyncIterable<AdapterEvent> {
        yield {
          type: "message.completed",
          message_id: "m1",
          role: "assistant",
          text: "adapter answer",
        };
        yield {
          type: "turn.completed",
          final_text: "",
        };
      },
      async close(): Promise<void> {},
    };
  }
}

class RawBodyAdapter implements HarnessAdapter {
  readonly harness = "codex";
  readonly capabilities = {
    forwardsModel: false,
    forwardsThinkingLevel: false,
    streamsDeltas: false,
  };

  async start(): Promise<HarnessSession> {
    return {
      async *submit(): AsyncIterable<AdapterEvent> {
        yield {
          type: "raw.provider",
          harness: "codex",
          payload: { provider_event: "body" },
        };
      },
      async close(): Promise<void> {},
    };
  }
}

class FailingTurnAdapter implements HarnessAdapter {
  readonly harness = "codex";
  readonly capabilities = {
    forwardsModel: false,
    forwardsThinkingLevel: false,
    streamsDeltas: false,
  };

  async start(): Promise<HarnessSession> {
    return {
      async *submit(): AsyncIterable<AdapterEvent> {
        throw new Error("turn failed");
      },
      async close(): Promise<void> {},
    };
  }
}

class StartFailAdapter implements HarnessAdapter {
  readonly harness = "codex";
  readonly capabilities = {
    forwardsModel: false,
    forwardsThinkingLevel: false,
    streamsDeltas: false,
  };

  async start(): Promise<HarnessSession> {
    const error = new Error("start failed");
    Object.assign(error, { code: "harness_unavailable" });
    throw error;
  }
}

class CloseFailAdapter implements HarnessAdapter {
  readonly harness = "codex";
  readonly capabilities = {
    forwardsModel: false,
    forwardsThinkingLevel: false,
    streamsDeltas: false,
  };

  async start(): Promise<HarnessSession> {
    return {
      async *submit(): AsyncIterable<AdapterEvent> {},
      async close(): Promise<void> {
        throw new Error("close failed");
      },
    };
  }
}

class UnsupportedOptionsAdapter implements HarnessAdapter {
  readonly harness = "codex";
  readonly capabilities = {
    forwardsModel: false,
    forwardsThinkingLevel: false,
    streamsDeltas: false,
  };
  startOptions: HarnessStartOptions | undefined;

  async start(options: HarnessStartOptions): Promise<HarnessSession> {
    this.startOptions = options;
    return {
      async *submit(): AsyncIterable<AdapterEvent> {},
      async close(): Promise<void> {},
    };
  }
}

test("runtime sanitizes secrets and repo-local paths before stdout emission", async () => {
  const repoRoot = await mkdtemp(path.join(tmpdir(), "xagent-runtime-"));
  const stdout = new MemoryWritable();

  await runSession({
    harness: "codex",
    mode: "full",
    repoRoot,
    cwd: repoRoot,
    stdin: Readable.from([
      JSON.stringify({
        type: "user.message",
        text: `inspect ${repoRoot}/src/index.ts with token=abc123 and sk-testsecret`,
      }),
      "\n",
      JSON.stringify({ type: "control.exit" }),
      "\n",
    ]),
    stdout,
    adapter: new FakeHarnessAdapter({ includeRawProvider: true }),
    runId: "xrun_sanitize",
    clock: fixedClock(),
  });

  assert.equal(stdout.text.includes(repoRoot), false);
  assert.equal(stdout.text.includes("sk-testsecret"), false);
  assert.equal(stdout.text.includes("token=abc123"), false);
  assert.equal(stdout.text.includes("[REDACTED]"), true);
});

test("runtime writes sanitized raw provider payloads to raw log once", async () => {
  const repoRoot = await mkdtemp(path.join(tmpdir(), "xagent-runtime-"));
  const stdout = new MemoryWritable();

  await runSession({
    harness: "codex",
    mode: "subagent",
    repoRoot,
    cwd: repoRoot,
    stdin: Readable.from([
      JSON.stringify({ type: "user.message", text: `token=abc123 in ${repoRoot}/file.txt` }),
      "\n",
      JSON.stringify({ type: "control.exit" }),
      "\n",
    ]),
    stdout,
    adapter: new FakeHarnessAdapter({ includeRawProvider: true }),
    runId: "xrun_raw_log",
    clock: fixedClock(),
  });

  const rawLogPath = path.join(repoRoot, "data", "xagent", "xrun_raw_log", "raw-provider.jsonl");
  const rawText = await readFile(rawLogPath, "utf8");
  assert.equal(rawText.trim().split("\n").length, 1);
  assert.equal(rawText.includes(repoRoot), false);
  assert.equal(rawText.includes("token=abc123"), false);
});

test("subagent filter coalesces message deltas until the interval or message completion", () => {
  let now = 0;
  const filter = createOutputFilter({ mode: "subagent", clock: { now: () => now } });

  assert.deepEqual(
    filter.handle(outputEvent({ type: "message.delta", turn_id: "turn_1", message_id: "m1", role: "assistant", delta: "a" })),
    [outputEvent({ type: "message.delta", turn_id: "turn_1", message_id: "m1", role: "assistant", delta: "a" })],
  );

  now = 1000;
  assert.deepEqual(
    filter.handle(outputEvent({ type: "message.delta", turn_id: "turn_1", message_id: "m1", role: "assistant", delta: "b" })),
    [],
  );

  now = 1200;
  assert.deepEqual(
    filter.handle(outputEvent({ type: "message.completed", turn_id: "turn_1", message_id: "m1", role: "assistant", text: "ab" })),
    [
      outputEvent({ type: "message.delta", turn_id: "turn_1", message_id: "m1", role: "assistant", delta: "b" }),
      outputEvent({ type: "message.completed", turn_id: "turn_1", message_id: "m1", role: "assistant", text: "ab" }),
    ],
  );
});

test("subagent filter drops pending deltas before unrelated visible events inside debounce interval", () => {
  let now = 0;
  const filter = createOutputFilter({ mode: "subagent", clock: { now: () => now } });

  assert.deepEqual(
    filter.handle(outputEvent({ type: "message.delta", turn_id: "turn_1", message_id: "m1", role: "assistant", delta: "a" })),
    [outputEvent({ type: "message.delta", turn_id: "turn_1", message_id: "m1", role: "assistant", delta: "a" })],
  );

  now = 1000;
  assert.deepEqual(
    filter.handle(outputEvent({ type: "message.delta", turn_id: "turn_1", message_id: "m1", role: "assistant", delta: "b" })),
    [],
  );

  assert.deepEqual(
    filter.handle(outputEvent({ type: "status", level: "info", message: "later" })),
    [outputEvent({ type: "status", level: "info", message: "later" })],
  );
});

test("subagent filter does not merge deltas across message identity inside debounce interval", () => {
  let now = 0;
  const filter = createOutputFilter({ mode: "subagent", clock: { now: () => now } });

  assert.deepEqual(
    filter.handle(outputEvent({ type: "message.delta", turn_id: "turn_1", message_id: "m1", role: "assistant", delta: "a" })),
    [outputEvent({ type: "message.delta", turn_id: "turn_1", message_id: "m1", role: "assistant", delta: "a" })],
  );

  now = 1000;
  assert.deepEqual(
    filter.handle(outputEvent({ type: "message.delta", turn_id: "turn_1", message_id: "m1", role: "assistant", delta: "b" })),
    [],
  );

  assert.deepEqual(
    filter.handle(outputEvent({ type: "message.delta", turn_id: "turn_1", message_id: "m2", role: "assistant", delta: "c" })),
    [],
  );

  assert.deepEqual(
    filter.handle(outputEvent({ type: "message.completed", turn_id: "turn_1", message_id: "m2", role: "assistant", text: "c" })),
    [
      outputEvent({ type: "message.delta", turn_id: "turn_1", message_id: "m2", role: "assistant", delta: "c" }),
      outputEvent({ type: "message.completed", turn_id: "turn_1", message_id: "m2", role: "assistant", text: "c" }),
    ],
  );
});

test("subagent filter emits prior identity delta when debounce elapsed before switching identity", () => {
  let now = 0;
  const filter = createOutputFilter({ mode: "subagent", clock: { now: () => now } });

  assert.deepEqual(
    filter.handle(outputEvent({ type: "message.delta", turn_id: "turn_1", message_id: "m1", role: "assistant", delta: "a" })),
    [outputEvent({ type: "message.delta", turn_id: "turn_1", message_id: "m1", role: "assistant", delta: "a" })],
  );

  now = 1000;
  assert.deepEqual(
    filter.handle(outputEvent({ type: "message.delta", turn_id: "turn_1", message_id: "m1", role: "assistant", delta: "b" })),
    [],
  );

  now = 2500;
  assert.deepEqual(
    filter.handle(outputEvent({ type: "message.delta", turn_id: "turn_2", message_id: "m1", role: "assistant", delta: "c" })),
    [outputEvent({ type: "message.delta", turn_id: "turn_1", message_id: "m1", role: "assistant", delta: "b" })],
  );

  assert.deepEqual(
    filter.handle(outputEvent({ type: "message.completed", turn_id: "turn_2", message_id: "m1", role: "assistant", text: "c" })),
    [
      outputEvent({ type: "message.delta", turn_id: "turn_2", message_id: "m1", role: "assistant", delta: "c" }),
      outputEvent({ type: "message.completed", turn_id: "turn_2", message_id: "m1", role: "assistant", text: "c" }),
    ],
  );
});

class MemoryWritable extends Writable {
  text = "";

  override _write(chunk: Buffer | string, _encoding: BufferEncoding, callback: (error?: Error | null) => void): void {
    this.text += chunk.toString();
    callback();
  }
}

class FailingWritable extends Writable {
  override _write(_chunk: Buffer | string, _encoding: BufferEncoding, callback: (error?: Error | null) => void): void {
    callback(new Error("stdout failed"));
  }
}

function parseJsonl(text: string): OutputEvent[] {
  return text
    .trim()
    .split("\n")
    .filter(Boolean)
    .map((line) => JSON.parse(line) as OutputEvent);
}

function fixedClock(): () => Date {
  return () => new Date("2026-06-21T00:00:00.000Z");
}

function eventHasTurnId(event: OutputEvent, turnId: string): boolean {
  return "turn_id" in event && event.turn_id === turnId;
}

function outputEvent(body: OutputEventBody): OutputEvent {
  return {
    schema_version: 1,
    run_id: "xrun_filter",
    sequence: 1,
    timestamp: "2026-06-21T00:00:00.000Z",
    ...body,
  } as OutputEvent;
}
