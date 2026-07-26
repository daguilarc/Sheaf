import assert from "node:assert/strict";
import { mkdtemp, readFile } from "node:fs/promises";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import path from "node:path";
import { Readable, Writable } from "node:stream";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { FakeHarnessAdapter } from "../src/adapters/fake.js";
import type { AdapterEvent } from "../src/adapters/types.js";
import { main } from "../src/cli.js";
import {
  createXagentServiceClient,
  mcpToolRequestOptions,
  x_McpAwaitTimeoutSlackSeconds,
} from "../src/service/client.js";
import { XagentRunManager } from "../src/service/run_manager.js";
import {
  createShutdownController,
  createXagentServer,
  type XagentServer,
} from "../src/service/server.js";
import {
  x_ServiceRequestTimeoutMs,
} from "../src/service/config.js";
import {
  x_DefaultAwaitDeadlineSeconds,
} from "../src/service/tool_schemas.js";
import type { SupervisionPolicy } from "../src/supervision/types.js";

const testPolicy: SupervisionPolicy = {
  silenceTimeoutMs: 600_000,
  watchdog: {},
};

test("mcp await request options cover the await deadline instead of the SDK 60s default", () => {
  const short = mcpToolRequestOptions("xagent_await", { deadline_seconds: 5 });
  assert.equal(short.timeout, (5 + x_McpAwaitTimeoutSlackSeconds) * 1000);
  assert.equal(short.maxTotalTimeout, short.timeout);

  const defaulted = mcpToolRequestOptions("xagent_await", {});
  assert.equal(
    defaulted.timeout,
    Math.min(
      x_ServiceRequestTimeoutMs,
      (x_DefaultAwaitDeadlineSeconds + x_McpAwaitTimeoutSlackSeconds) * 1000,
    ),
  );
  assert.ok((defaulted.timeout ?? 0) > 60_000);

  const other = mcpToolRequestOptions("xagent_inspect", { run_id: "xrun_1" });
  assert.equal(other.timeout, undefined);
});

test("client await chunks HTTP MCP deadlines until the application deadline", async () => {
  await withFakeService(async ({ baseUrl, adapterFactory }) => {
    const releaseTurn = deferred<void>();
    async function* scriptedTurn(): AsyncIterable<AdapterEvent> {
      yield {
        type: "message.delta",
        message_id: "message_1",
        role: "assistant",
        delta: "still working",
      };
      await releaseTurn.promise;
      yield {
        type: "message.completed",
        message_id: "message_1",
        role: "assistant",
        text: "done after chunks",
      };
      yield {
        type: "turn.completed",
        final_text: "done after chunks",
        provider_thread_id: "fake-thread-chunk",
      };
    }
    adapterFactory.queueScripts([scriptedTurn()]);

    const client = createXagentServiceClient({
      baseUrl,
      awaitHttpChunkSeconds: 1,
    });
    try {
      const cwd = await mkdtemp(path.join(tmpdir(), "xagent-chunk-"));
      const started = await client.start({
        cwd,
        prompt: "chunked await",
        harness: "codex",
        mode: "subagent",
      });
      const awaiting = client.await({
        run_id: started.run_id,
        after_sequence: started.sequence,
        deadline_seconds: 10,
      });
      await new Promise((resolve) => setTimeout(resolve, 2500));
      releaseTurn.resolve(undefined);
      const result = await awaiting;
      assert.equal(result.event, "turn.completed");
      assert.equal(result.report?.text, "done after chunks");
    } finally {
      await client.close();
    }
  });
});

test("quiet supervise emits no stdout during healthy progress and one completion JSON", async () => {
  await withFakeService(async ({ baseUrl, adapterFactory }) => {
    const releaseTurn = deferred<void>();
    const afterProgress = deferred<void>();
    async function* scriptedTurn(): AsyncIterable<AdapterEvent> {
      yield {
        type: "message.delta",
        message_id: "message_1",
        role: "assistant",
        delta: "healthy progress should stay quiet",
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
        output: { ok: true },
      };
      afterProgress.resolve(undefined);
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
    adapterFactory.queueScripts([scriptedTurn()]);

    const cwd = await mkdtemp(path.join(tmpdir(), "xagent-quiet-"));
    const stdout = new MemoryWritable();
    const stderr = new MemoryWritable();
    const running = main(
      [
        "supervise",
        "--harness",
        "codex",
        "--cwd",
        cwd,
        "--deadline-seconds",
        "5",
        "do the work",
      ],
      Readable.from([]),
      stdout,
      stderr,
      cwd,
      { serviceBaseUrl: baseUrl },
    );

    await afterProgress.promise;
    assert.equal(stdout.text, "");
    assert.equal(stderr.text, "");

    releaseTurn.resolve(undefined);
    const result = await running;
    assert.deepEqual(result, { exitCode: 0 });
    assert.equal(stderr.text, "");
    const body = JSON.parse(stdout.text.trim()) as Record<string, unknown>;
    assert.equal(body.event, "turn.completed");
    assert.equal((body.report as { text: string }).text, "complete final assistant message");
    assert.equal(typeof body.run_id, "string");
    assert.equal(stdout.text.includes("healthy progress"), false);
    assert.equal(stdout.text.includes("fake_tool"), false);
  });
});

test("quiet await returns one compact attention JSON and keeps the run service-owned", async () => {
  await withFakeService(async ({ baseUrl, runManager, adapterFactory }) => {
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
    adapterFactory.queueScripts([scriptedTurn()]);

    const cwd = await mkdtemp(path.join(tmpdir(), "xagent-attention-"));
    const startStdout = new MemoryWritable();
    const attentionResult = await main(
      [
        "supervise",
        "--harness",
        "codex",
        "--cwd",
        cwd,
        "--deadline-seconds",
        "5",
        "need approval",
      ],
      Readable.from([]),
      startStdout,
      new MemoryWritable(),
      cwd,
      { serviceBaseUrl: baseUrl },
    );
    assert.deepEqual(attentionResult, { exitCode: 0 });
    const attention = JSON.parse(startStdout.text.trim()) as Record<string, unknown>;
    assert.equal(attention.event, "supervision.attention");
    assert.equal(attention.reason, "input_required");
    const runId = attention.run_id as string;
    assert.equal(runManager.has(runId), true);

    releaseTurn.resolve(undefined);
    await settle();

    const awaitStdout = new MemoryWritable();
    const continued = await main(
      ["await", runId, "--after-sequence", String(attention.sequence), "--deadline-seconds", "5"],
      Readable.from([]),
      awaitStdout,
      new MemoryWritable(),
      cwd,
      { serviceBaseUrl: baseUrl },
    );
    assert.deepEqual(continued, { exitCode: 0 });
    const completion = JSON.parse(awaitStdout.text.trim()) as Record<string, unknown>;
    assert.equal(completion.event, "turn.completed");
    assert.equal((completion.report as { text: string }).text, "done");
  });
});

test("inspect emits one compact JSON snapshot", async () => {
  await withFakeService(async ({ baseUrl }) => {
    const cwd = await mkdtemp(path.join(tmpdir(), "xagent-inspect-"));
    const superviseStdout = new MemoryWritable();
    const supervise = await main(
      ["supervise", "--harness", "codex", "--cwd", cwd, "--deadline-seconds", "5", "quick"],
      Readable.from([]),
      superviseStdout,
      new MemoryWritable(),
      cwd,
      { serviceBaseUrl: baseUrl },
    );
    assert.deepEqual(supervise, { exitCode: 0 });
    const runId = (JSON.parse(superviseStdout.text.trim()) as { run_id: string }).run_id;

    const stdout = new MemoryWritable();
    const result = await main(
      ["inspect", runId],
      Readable.from([]),
      stdout,
      new MemoryWritable(),
      cwd,
      { serviceBaseUrl: baseUrl },
    );
    assert.deepEqual(result, { exitCode: 0 });
    const body = JSON.parse(stdout.text.trim()) as Record<string, unknown>;
    assert.equal(body.run_id, runId);
    assert.equal(typeof body.phase, "string");
    assert.equal(typeof body.sequence, "number");
  });
});

test("deadline emits one compact JSON result", async () => {
  await withFakeService(async ({ baseUrl, adapterFactory }) => {
    const releaseTurn = deferred<void>();
    async function* scriptedTurn(): AsyncIterable<AdapterEvent> {
      yield {
        type: "message.delta",
        message_id: "message_1",
        role: "assistant",
        delta: "still working",
      };
      await releaseTurn.promise;
      yield {
        type: "message.completed",
        message_id: "message_1",
        role: "assistant",
        text: "late",
      };
      yield {
        type: "turn.completed",
        final_text: "late",
        provider_thread_id: "fake-thread-1",
      };
    }
    adapterFactory.queueScripts([scriptedTurn()]);

    const cwd = await mkdtemp(path.join(tmpdir(), "xagent-deadline-"));
    const stdout = new MemoryWritable();
    const result = await main(
      [
        "supervise",
        "--harness",
        "codex",
        "--cwd",
        cwd,
        "--deadline-seconds",
        "1",
        "slow work",
      ],
      Readable.from([]),
      stdout,
      new MemoryWritable(),
      cwd,
      { serviceBaseUrl: baseUrl },
    );
    assert.deepEqual(result, { exitCode: 0 });
    const body = JSON.parse(stdout.text.trim()) as Record<string, unknown>;
    assert.equal(body.event, "supervision.deadline");
    assert.equal(body.reason, "await_deadline");
    releaseTurn.resolve(undefined);
  });
});

test("follow-up is accepted only in ready; interrupt only in running", async () => {
  await withFakeService(async ({ baseUrl, adapterFactory }) => {
    const cwd = await mkdtemp(path.join(tmpdir(), "xagent-state-"));
    const superviseStdout = new MemoryWritable();
    const supervise = await main(
      ["supervise", "--harness", "codex", "--cwd", cwd, "--deadline-seconds", "5", "first"],
      Readable.from([]),
      superviseStdout,
      new MemoryWritable(),
      cwd,
      { serviceBaseUrl: baseUrl },
    );
    assert.deepEqual(supervise, { exitCode: 0 });
    const runId = (JSON.parse(superviseStdout.text.trim()) as { run_id: string }).run_id;

    const releaseSecond = deferred<void>();
    const secondRunning = deferred<void>();
    async function* secondTurn(): AsyncIterable<AdapterEvent> {
      secondRunning.resolve(undefined);
      await releaseSecond.promise;
      yield {
        type: "message.completed",
        message_id: "message_2",
        role: "assistant",
        text: "second turn",
      };
      yield {
        type: "turn.completed",
        final_text: "second turn",
        provider_thread_id: "fake-thread-1",
      };
    }
    assert.ok(adapterFactory.current !== undefined);
    const scripts: Array<readonly AdapterEvent[] | AsyncIterable<AdapterEvent>> = [];
    scripts[1] = secondTurn();
    adapterFactory.current.options.scriptedEvents = scripts;

    const readyMessageStdout = new MemoryWritable();
    const readyMessagePromise = main(
      ["message", runId, "second turn please"],
      Readable.from([]),
      readyMessageStdout,
      new MemoryWritable(),
      cwd,
      { serviceBaseUrl: baseUrl },
    );

    await secondRunning.promise;

    const invalidStdout = new MemoryWritable();
    const invalid = await main(
      ["message", runId, "not while running"],
      Readable.from([]),
      invalidStdout,
      new MemoryWritable(),
      cwd,
      { serviceBaseUrl: baseUrl },
    );
    assert.equal(invalid.exitCode, 1);
    const invalidBody = JSON.parse(invalidStdout.text.trim()) as Record<string, unknown>;
    assert.equal(typeof invalidBody.error, "string");
    assert.match(String(invalidBody.message), /Cannot submit|running/i);

    releaseSecond.resolve(undefined);
    const readyMessage = await readyMessagePromise;
    assert.deepEqual(readyMessage, { exitCode: 0 });
    assert.equal(
      (JSON.parse(readyMessageStdout.text.trim()) as { run_id: string }).run_id,
      runId,
    );
  });
});

test("interrupt succeeds while running and is rejected while ready", async () => {
  await withFakeService(async ({ baseUrl, runManager, adapterFactory }) => {
    adapterFactory.supportsInterrupt = true;
    const releaseTurn = deferred<void>();
    const afterStart = deferred<void>();
    async function* scriptedTurn(): AsyncIterable<AdapterEvent> {
      afterStart.resolve(undefined);
      await releaseTurn.promise;
      yield {
        type: "message.completed",
        message_id: "message_1",
        role: "assistant",
        text: "interrupted path",
      };
      yield {
        type: "turn.completed",
        final_text: "interrupted path",
        provider_thread_id: "fake-thread-1",
      };
    }
    adapterFactory.queueScripts([scriptedTurn()]);

    const cwd = await mkdtemp(path.join(tmpdir(), "xagent-interrupt-"));
    const superviseStdout = new MemoryWritable();
    const supervisePromise = main(
      [
        "supervise",
        "--harness",
        "codex",
        "--cwd",
        cwd,
        "--deadline-seconds",
        "5",
        "running work",
      ],
      Readable.from([]),
      superviseStdout,
      new MemoryWritable(),
      cwd,
      { serviceBaseUrl: baseUrl },
    );
    await afterStart.promise;

    const runIds = runManager.listRunIds();
    assert.equal(runIds.length, 1);
    const runId = runIds[0]!;

    const interruptStdout = new MemoryWritable();
    const interrupted = await main(
      ["interrupt", runId],
      Readable.from([]),
      interruptStdout,
      new MemoryWritable(),
      cwd,
      { serviceBaseUrl: baseUrl },
    );
    assert.deepEqual(interrupted, { exitCode: 0 });
    assert.equal(
      (JSON.parse(interruptStdout.text.trim()) as { run_id: string }).run_id,
      runId,
    );
    releaseTurn.resolve(undefined);
    await supervisePromise;

    const badInterruptStdout = new MemoryWritable();
    const badInterrupt = await main(
      ["interrupt", runId],
      Readable.from([]),
      badInterruptStdout,
      new MemoryWritable(),
      cwd,
      { serviceBaseUrl: baseUrl },
    );
    assert.equal(badInterrupt.exitCode, 1);
    const badInterruptBody = JSON.parse(badInterruptStdout.text.trim()) as Record<string, unknown>;
    assert.match(String(badInterruptBody.message), /Cannot interrupt|ready/i);
  });
});

test("reattachment uses the same run_id across CLI invocations", async () => {
  await withFakeService(async ({ baseUrl, runManager, adapterFactory }) => {
    const releaseTurn = deferred<void>();
    async function* scriptedTurn(): AsyncIterable<AdapterEvent> {
      yield {
        type: "status",
        level: "info",
        code: "input_required",
        message: "pause",
      };
      await releaseTurn.promise;
      yield {
        type: "message.completed",
        message_id: "message_1",
        role: "assistant",
        text: "reattached completion",
      };
      yield {
        type: "turn.completed",
        final_text: "reattached completion",
        provider_thread_id: "fake-thread-1",
      };
    }
    adapterFactory.queueScripts([scriptedTurn()]);

    const cwd = await mkdtemp(path.join(tmpdir(), "xagent-reattach-"));
    const firstStdout = new MemoryWritable();
    const first = await main(
      [
        "supervise",
        "--harness",
        "codex",
        "--cwd",
        cwd,
        "--deadline-seconds",
        "5",
        "start",
      ],
      Readable.from([]),
      firstStdout,
      new MemoryWritable(),
      cwd,
      { serviceBaseUrl: baseUrl },
    );
    assert.deepEqual(first, { exitCode: 0 });
    const attention = JSON.parse(firstStdout.text.trim()) as { run_id: string; sequence: number };
    assert.equal(runManager.has(attention.run_id), true);

    releaseTurn.resolve(undefined);
    const secondStdout = new MemoryWritable();
    const second = await main(
      [
        "await",
        attention.run_id,
        "--after-sequence",
        String(attention.sequence),
        "--deadline-seconds",
        "5",
      ],
      Readable.from([]),
      secondStdout,
      new MemoryWritable(),
      cwd,
      { serviceBaseUrl: baseUrl },
    );
    assert.deepEqual(second, { exitCode: 0 });
    const completion = JSON.parse(secondStdout.text.trim()) as Record<string, unknown>;
    assert.equal(completion.run_id, attention.run_id);
    assert.equal(completion.event, "turn.completed");
    assert.equal((completion.report as { text: string }).text, "reattached completion");

    const closeStdout = new MemoryWritable();
    const closed = await main(
      ["close", attention.run_id],
      Readable.from([]),
      closeStdout,
      new MemoryWritable(),
      cwd,
      { serviceBaseUrl: baseUrl },
    );
    assert.deepEqual(closed, { exitCode: 0 });
    assert.equal(JSON.parse(closeStdout.text.trim()).closed, true);
    assert.equal(runManager.has(attention.run_id), false);
  });
});

test("quiet supervise surfaces a terminal provider failure immediately instead of spinning to the await deadline", async () => {
  await withFakeService(async ({ baseUrl, adapterFactory }) => {
    async function* scriptedTurn(): AsyncIterable<AdapterEvent> {
      yield {
        type: "message.delta",
        message_id: "message_1",
        role: "assistant",
        delta: "partial before crash",
      };
      yield {
        type: "turn.failed",
        code: "provider_failed",
        message: "provider reported failure",
      };
    }
    adapterFactory.queueScripts([scriptedTurn()]);

    const cwd = await mkdtemp(path.join(tmpdir(), "xagent-supervise-fail-"));
    const stdout = new MemoryWritable();
    const stderr = new MemoryWritable();
    const start = Date.now();
    const result = await main(
      [
        "supervise",
        "--harness",
        "codex",
        "--cwd",
        cwd,
        "--deadline-seconds",
        "30",
        "do work that crashes",
      ],
      Readable.from([]),
      stdout,
      stderr,
      cwd,
      { serviceBaseUrl: baseUrl },
    );

    assert.equal(result.exitCode, 1);
    assert.equal(stderr.text, "");
    const body = JSON.parse(stdout.text.trim()) as Record<string, unknown>;
    assert.equal(body.event, "supervision.state");
    assert.equal(body.phase, "failed");
    assert.equal(body.reason, "provider_failed");
    assert.equal(typeof body.run_id, "string");
    // Must return well before the 30s deadline; a quiet spin would take ~30s.
    assert.ok(Date.now() - start < 5_000, "supervise did not return the failure promptly");
  });
});

test("unavailable service emits structured failure and never constructs a Supervisor", async () => {
  const baseUrl = `http://127.0.0.1:${await findFreePort()}`;
  const cwd = await mkdtemp(path.join(tmpdir(), "xagent-unavailable-"));
  const stdout = new MemoryWritable();
  const stderr = new MemoryWritable();
  let adapterCreated = false;

  const result = await main(
    ["supervise", "--harness", "codex", "--cwd", cwd, "hello"],
    Readable.from([]),
    stdout,
    stderr,
    cwd,
    {
      serviceBaseUrl: baseUrl,
      createAdapter: () => {
        adapterCreated = true;
        return new FakeHarnessAdapter();
      },
    },
  );

  assert.equal(result.exitCode, 1);
  assert.equal(adapterCreated, false);
  assert.equal(stderr.text, "");
  const body = JSON.parse(stdout.text.trim()) as Record<string, unknown>;
  assert.equal(body.error, "xagent_service_unavailable");
  assert.equal(typeof body.message, "string");

  const clientSource = await readFile(
    path.join(
      path.dirname(fileURLToPath(import.meta.url)),
      "..",
      "..",
      "src",
      "service",
      "client.ts",
    ),
    "utf8",
  );
  assert.equal(clientSource.includes("Supervisor"), false);
  assert.equal(clientSource.includes("createAdapter"), false);
  assert.equal(clientSource.includes("createXagentServer"), false);
});

test("createXagentServiceClient maps connection failure to xagent_service_unavailable", async () => {
  const missingCwd = await mkdtemp(path.join(tmpdir(), "xagent-client-"));
  const client = createXagentServiceClient({
    baseUrl: `http://127.0.0.1:${await findFreePort()}`,
  });
  await assert.rejects(
    () =>
      client.start({
        cwd: missingCwd,
        prompt: "nope",
        harness: "codex",
        mode: "subagent",
      }),
    (error: unknown) => {
      assert.ok(error !== null && typeof error === "object");
      const structured = (error as { structured?: { error?: string } }).structured;
      assert.equal(structured?.error, "xagent_service_unavailable");
      return true;
    },
  );
  await client.close().catch(() => {});
});

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

type AdapterFactoryState = {
  current?: FakeHarnessAdapter;
  supportsInterrupt?: boolean;
  queueScripts(scripts: Array<readonly AdapterEvent[] | AsyncIterable<AdapterEvent>>): void;
};

async function withFakeService(
  run: (context: {
    baseUrl: string;
    server: XagentServer;
    runManager: XagentRunManager;
    adapterFactory: AdapterFactoryState;
  }) => Promise<void>,
): Promise<void> {
  let queuedScripts: Array<readonly AdapterEvent[] | AsyncIterable<AdapterEvent>> | undefined;
  const adapterFactory: AdapterFactoryState = {
    queueScripts(scripts) {
      queuedScripts = scripts;
    },
  };
  const runManager = new XagentRunManager({
    repoRoot: process.cwd(),
    logRoot: path.join(tmpdir(), `xagent-cli-svc-${Math.random().toString(36).slice(2)}`),
    adapterFactory: () => {
      const adapter = new FakeHarnessAdapter({
        includeToolEvents: true,
        includeDeltas: true,
        supportsInterrupt: adapterFactory.supportsInterrupt === true,
        ...(queuedScripts === undefined ? {} : { scriptedEvents: queuedScripts }),
      });
      adapterFactory.current = adapter;
      queuedScripts = undefined;
      return adapter;
    },
    policy: testPolicy,
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
  try {
    await run({ baseUrl, server, runManager, adapterFactory });
  } finally {
    if (!shutdownController.wasShutdownRequested()) {
      await server.close();
    }
    await runManager.closeAll();
  }
}

function deferred<T>(): {
  promise: Promise<T>;
  resolve: (value: T) => void;
  reject: (error: unknown) => void;
} {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

async function findFreePort(): Promise<number> {
  const server = createServer();
  await new Promise<void>((resolve) => {
    server.listen(0, "127.0.0.1", () => resolve());
  });
  const address = server.address();
  assert.ok(address !== null && typeof address !== "string");
  const port = address.port;
  await new Promise<void>((resolve, reject) => {
    server.close((error) => {
      if (error) {
        reject(error);
        return;
      }
      resolve();
    });
  });
  return port;
}

function settle(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 50));
}
