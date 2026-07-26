import assert from "node:assert/strict";
import { spawn, type ChildProcess } from "node:child_process";
import { writeFile, mkdtemp, mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";

import { FakeHarnessAdapter } from "../src/adapters/fake.js";
import { ProcessJsonlSession } from "../src/adapters/process_jsonl.js";
import type {
  AdapterEvent,
  HarnessAdapter,
  HarnessSession,
} from "../src/adapters/types.js";
import {
  findSheafRoot,
  loadXagentServiceConfig,
  resolveXagentLogRoot,
} from "../src/service/config.js";
import { XagentRunManager } from "../src/service/run_manager.js";
import {
  createXagentServer,
  type XagentServer,
  type XagentShutdownController,
} from "../src/service/server.js";
import type { SupervisionPolicy } from "../src/supervision/types.js";

const testPolicy: SupervisionPolicy = {
  silenceTimeoutMs: 60_000,
  watchdog: {},
};

const fixtureChildren = new Set<ChildProcess>();

test.afterEach(async () => {
  for (const child of fixtureChildren) {
    stopChild(child);
  }
  fixtureChildren.clear();
});

test("loadXagentServiceConfig reads the tracked xagent registry entry and requires loopback", async () => {
  const config = await loadXagentServiceConfig({
    servicesJsonPath: path.join(findSheafRoot(process.cwd()), "config", "services.json"),
  });

  assert.equal(config.bindHost, "127.0.0.1");
  assert.equal(config.bindPort, 9005);
  assert.equal(config.command, "make xagent-service-run");
  assert.equal(config.logRoot, resolveXagentLogRoot(config.repoRoot));
});

test("loadXagentServiceConfig rejects a non-loopback shipped bind host", async () => {
  const dir = await mkdtemp(path.join(tmpdir(), "xagent-service-cfg-"));
  const servicesJsonPath = path.join(dir, "services.json");
  await writeFile(
    servicesJsonPath,
    `${JSON.stringify([
      {
        name: "xagent",
        host: "0.0.0.0",
        port: 9005,
        command: "make xagent-service-run",
      },
    ])}\n`,
    "utf8",
  );

  await assert.rejects(
    () => loadXagentServiceConfig({ servicesJsonPath }),
    /loopback/,
  );
});

test("GET /health returns the standard health shape without a warning when healthy", async () => {
  await withServiceServer({}, async ({ port }) => {
    const response = await fetchJson(port, "GET", "/health");
    assert.equal(response.status, 200);
    assert.equal((response.body as { healthy: boolean }).healthy, true);
    assert.equal(typeof (response.body as { uptime: number }).uptime, "number");
    assert.equal("warning" in (response.body as object), false);
  });
});

test("GET /health includes a warning only when supervision is degraded", async () => {
  await withServiceServer({ warning: "degraded" }, async ({ port }) => {
    const response = await fetchJson(port, "GET", "/health");
    assert.equal(response.status, 200);
    assert.equal((response.body as { warning: string }).warning, "degraded");
  });
});

test("unknown routes return a bounded JSON 404 and do not change supervised runs", async () => {
  await withServiceServer({}, async ({ port, runManager }) => {
    const before = runManager.listRunIds();
    const response = await fetchJson(port, "GET", "/nope");
    assert.equal(response.status, 404);
    assert.equal(typeof (response.body as { error: string }).error, "string");
    assert.deepEqual(runManager.listRunIds(), before);
  });
});

test("POST /exit acknowledges shutdown before closing owned supervisors and listeners", async () => {
  const events: string[] = [];

  await withServiceServer(
    {
      closeRuns: async (runManager) => {
        events.push("runs-closed");
        await runManager.closeAll();
      },
      closeServer: async (server) => {
        events.push("server-closed");
        await server.close();
      },
    },
    async ({ port, shutdownController }) => {
      const response = await fetchJson(port, "POST", "/exit");
      assert.equal(response.status, 200);
      assert.deepEqual(response.body, { exiting: true });
      await shutdownController.shutdownComplete();
      assert.deepEqual(events, ["runs-closed", "server-closed"]);
    },
  );
});

test("repeated POST /exit is idempotent and does not start a second shutdown sequence", async () => {
  let shutdownSequences = 0;

  await withServiceServer(
    {
      closeRuns: async (runManager) => {
        shutdownSequences += 1;
        await runManager.closeAll();
      },
      closeServer: async (server) => {
        await server.close();
      },
    },
    async ({ port, shutdownController }) => {
      const first = await fetchJson(port, "POST", "/exit");
      assert.equal(first.status, 200);
      assert.deepEqual(first.body, { exiting: true });

      // A second exit request may arrive while the listener is still bound
      // (404 acknowledgement) or after it has been closed (connection reset).
      // Either is an acceptable idempotent acknowledgement; the contract is
      // that no second shutdown sequence starts.
      await fetchJson(port, "POST", "/exit").catch(() => ({
        status: 0,
        body: { exiting: true },
      }));

      await shutdownController.shutdownComplete();
      assert.equal(shutdownSequences, 1);
    },
  );
});

test("await request cancellation removes only the waiter and leaves the run owned by the manager", async () => {
  await withServiceServer({}, async ({ runManager }) => {
    const { runId } = await runManager.create({
      harness: "codex",
      mode: "subagent",
      cwd: process.cwd(),
    });
    await runManager.start(runId);

    const abort = new AbortController();
    const awaiting = runManager.awaitEvent(
      runId,
      runManager.inspect(runId)!.sequence,
      5_000,
      abort.signal,
    );
    abort.abort();
    await assert.rejects(awaiting, { name: "AbortError" });

    assert.equal(runManager.has(runId), true);
    assert.equal(runManager.inspect(runId)?.phase, "ready");
    await runManager.close(runId);
  });
});

test("service shutdown closes owned provider process groups orderly", async () => {
  const repoRoot = await mkdtemp(path.join(tmpdir(), "xagent-svc-pgrp-"));
  const logRoot = path.join(repoRoot, "xagent");
  const sentinel = trackChild(
    spawn(process.execPath, ["-e", "setInterval(() => {}, 1000)"], {
      stdio: "ignore",
    }),
  );
  let providerChild: ChildProcess | undefined;
  const session = new ProcessJsonlSession({
    harness: "codex",
    cwd: process.cwd(),
    buildCommand: () => ({
      command: process.execPath,
      args: ["-e", "setInterval(() => {}, 1000)"],
    }),
    parseEvent: (): AdapterEvent[] => [],
    spawnProcess: (command, args, childOptions) => {
      providerChild = trackChild(spawn(command, [...args], childOptions));
      return providerChild as never;
    },
  });
  const adapter: HarnessAdapter = {
    harness: "codex",
    capabilities: {
      forwardsModel: true,
      forwardsThinkingLevel: true,
      streamsDeltas: true,
    },
    async start(): Promise<HarnessSession> {
      return session;
    },
  };

  const runManager = new XagentRunManager({
    repoRoot,
    logRoot,
    adapterFactory: () => adapter,
    policy: testPolicy,
  });

  await withServiceServer(
    {
      runManager,
      closeRuns: async (manager) => {
        await manager.closeAll();
      },
      closeServer: async (server) => {
        await server.close();
      },
    },
    async ({ shutdownController }) => {
      const { runId } = await runManager.create({
        harness: "codex",
        mode: "subagent",
        cwd: process.cwd(),
      });
      await runManager.start(runId);
      const turn = runManager.submit(runId, "stay alive");
      await waitUntil(() => session.processIdentity !== undefined);
      const providerPid = session.processIdentity?.pid;
      assert.ok(providerPid);
      assert.equal(isProcessAlive(providerPid), true);

      await shutdownController.requestShutdown();
      await shutdownController.shutdownComplete();
      await turn.catch(() => {});

      await waitUntil(() => !isProcessAlive(providerPid));
      assert.equal(isProcessAlive(sentinel.pid), true);
    },
  );

  stopChild(sentinel);
});

test("create rejects a duplicate runId and leaves the original run owned", async () => {
  await withServiceServer({}, async ({ runManager }) => {
    const runId = "xrun_duplicate_owner_test";
    const first = await runManager.create({
      runId,
      harness: "codex",
      mode: "subagent",
      cwd: process.cwd(),
    });
    assert.equal(first.runId, runId);
    await runManager.start(runId);
    assert.equal(runManager.inspect(runId)?.phase, "ready");

    await assert.rejects(
      () =>
        runManager.create({
          runId,
          harness: "codex",
          mode: "subagent",
          cwd: process.cwd(),
        }),
      /already exists|in use|duplicate/i,
    );

    assert.equal(runManager.has(runId), true);
    assert.equal(runManager.inspect(runId)?.phase, "ready");
    await runManager.close(runId);
  });
});

test("Conductor-style start, health, stop, restart lifecycle is consistent", async () => {
  const first = await startServiceServer();
  try {
    const health = await fetchJson(first.port, "GET", "/health");
    assert.equal(health.status, 200);
    assert.equal((health.body as { healthy: boolean }).healthy, true);
  } finally {
    await first.shutdownController.requestShutdown();
    await first.shutdownController.shutdownComplete();
  }

  const restarted = await startServiceServer();
  try {
    const health = await fetchJson(restarted.port, "GET", "/health");
    assert.equal(health.status, 200);
    assert.equal((health.body as { healthy: boolean }).healthy, true);
  } finally {
    await restarted.shutdownController.requestShutdown();
    await restarted.shutdownController.shutdownComplete();
  }
});

test("spawned service_main captures Conductor-style stdout/stderr logs and exits 0 on /exit", async () => {
  const sheafRoot = await mkdtemp(path.join(tmpdir(), "xagent-svc-spawn-"));
  await mkdir(path.join(sheafRoot, "config"), { recursive: true });
  await mkdir(path.join(sheafRoot, "structure"), { recursive: true });
  const servicesJsonPath = path.join(sheafRoot, "config", "services.json");
  await writeFile(
    path.join(sheafRoot, "structure", ".gitkeep"),
    "",
    "utf8",
  );
  await writeFile(
    servicesJsonPath,
    `${JSON.stringify([
      {
        name: "xagent",
        host: "127.0.0.1",
        port: 0,
        command: "make xagent-service-run",
      },
    ])}\n`,
    "utf8",
  );

  const serviceMain = path.join(process.cwd(), "dist", "src", "service_main.js");
  await mkdir(path.join(sheafRoot, "xagent"), { recursive: true });

  const child = trackChild(
    spawn(process.execPath, [serviceMain], {
      cwd: sheafRoot,
      stdio: ["ignore", "pipe", "pipe"],
    }),
  );

  const stdoutChunks: Buffer[] = [];
  const stderrChunks: Buffer[] = [];
  child.stdout?.on("data", (chunk: Buffer) => stdoutChunks.push(chunk));
  child.stderr?.on("data", (chunk: Buffer) => stderrChunks.push(chunk));

  const port = await waitForPort(stderrChunks, 10_000);

  const health = await fetchJson(port, "GET", "/health");
  assert.equal(health.status, 200);
  assert.equal((health.body as { healthy: boolean }).healthy, true);

  const exitResponse = await fetchJson(port, "POST", "/exit");
  assert.equal(exitResponse.status, 200);
  assert.deepEqual(exitResponse.body, { exiting: true });

  const exitCode = await waitForExit(child, 10_000);
  assert.equal(exitCode, 0);

  const capturedStderr = Buffer.concat(stderrChunks).toString("utf8");
  const capturedStdout = Buffer.concat(stdoutChunks).toString("utf8");
  assert.ok(
    capturedStderr.length > 0 || capturedStdout.length > 0,
    "service must emit capturable process output for Conductor log capture",
  );
  assert.match(capturedStderr, /xagent service listening on 127\.0\.0\.1:\d+/);
});

async function waitForPort(stderrChunks: Buffer[], timeoutMs: number): Promise<number> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const text = Buffer.concat(stderrChunks).toString("utf8");
    const match = text.match(/xagent service listening on 127\.0\.0\.1:(\d+)/);
    if (match) {
      return Number(match[1]);
    }
    await new Promise<void>((resolve) => setTimeout(resolve, 20));
  }
  throw new Error(
    `service did not announce a port within ${timeoutMs} ms; stderr=${Buffer.concat(stderrChunks).toString("utf8")}`,
  );
}

async function waitForExit(child: ChildProcess, timeoutMs: number): Promise<number | null> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new Error(`service child did not exit within ${timeoutMs} ms`));
    }, timeoutMs);
    child.once("exit", (code) => {
      clearTimeout(timer);
      resolve(code);
    });
  });
}

async function startServiceServer(): Promise<{
  port: number;
  server: XagentServer;
  runManager: XagentRunManager;
  shutdownController: TrackingShutdownController;
}> {
  const runManager = new XagentRunManager({
    repoRoot: process.cwd(),
    logRoot: path.join(tmpdir(), `xagent-svc-${Math.random().toString(36).slice(2)}`),
    adapterFactory: () => new FakeHarnessAdapter(),
    policy: testPolicy,
  });
  let server: XagentServer | undefined;
  const shutdownController = createTrackingShutdownController({
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
  return { port, server, runManager, shutdownController };
}

async function withServiceServer(
  options: {
    warning?: string;
    runManager?: XagentRunManager;
    closeRuns?: (runManager: XagentRunManager) => Promise<void>;
    closeServer?: (server: XagentServer) => Promise<void>;
  },
  run: (context: {
    port: number;
    server: XagentServer;
    runManager: XagentRunManager;
    shutdownController: TrackingShutdownController;
  }) => Promise<void>,
): Promise<void> {
  const runManager =
    options.runManager ?? defaultManager();
  let server: XagentServer | undefined;
  const shutdownController = createTrackingShutdownController({
    closeRuns: async () => {
      await (options.closeRuns ?? defaultCloseRuns)(runManager);
    },
    closeServer: async () => {
      await (options.closeServer ?? defaultCloseServer)(server!);
    },
  });
  server = createXagentServer({
    bindHost: "127.0.0.1",
    bindPort: 0,
    runManager,
    shutdownController,
    warning: options.warning,
  });
  const port = await server.listen();
  try {
    await run({ port, server, runManager, shutdownController });
  } finally {
    if (!shutdownController.wasShutdownRequested()) {
      await server.close();
    }
    await runManager.closeAll();
  }
}

function defaultManager(): XagentRunManager {
  return new XagentRunManager({
    repoRoot: process.cwd(),
    logRoot: path.join(tmpdir(), `xagent-svc-${Math.random().toString(36).slice(2)}`),
    adapterFactory: () => new FakeHarnessAdapter(),
    policy: testPolicy,
  });
}

async function defaultCloseRuns(runManager: XagentRunManager): Promise<void> {
  await runManager.closeAll();
}

async function defaultCloseServer(server: XagentServer): Promise<void> {
  await server.close();
}

type TrackingShutdownController = XagentShutdownController & {
  shutdownComplete(): Promise<void>;
};

function createTrackingShutdownController(deps: {
  closeServer: () => Promise<void>;
  closeRuns: () => Promise<void>;
}): TrackingShutdownController {
  let requested = false;
  let pending: Promise<void> | undefined;
  let resolveShutdown: (() => void) | undefined;
  const shutdownDone = new Promise<void>((resolve) => {
    resolveShutdown = resolve;
  });

  return {
    requestShutdown(): Promise<void> {
      if (pending !== undefined) {
        return pending;
      }
      requested = true;
      pending = (async () => {
        await deps.closeRuns();
        await deps.closeServer();
        resolveShutdown?.();
      })();
      return pending;
    },
    wasShutdownRequested(): boolean {
      return requested;
    },
    shutdownComplete(): Promise<void> {
      return shutdownDone;
    },
  };
}

async function fetchJson(
  port: number,
  method: string,
  requestPath: string,
): Promise<{ status: number; body: unknown }> {
  const response = await fetch(`http://127.0.0.1:${port}${requestPath}`, { method });
  const text = await response.text();
  let body: unknown = text;
  if (text.length > 0) {
    try {
      body = JSON.parse(text);
    } catch {
      // Keep raw text for diagnostics.
    }
  }
  assert.ok(text.length <= 4096, "response body must be bounded");
  return { status: response.status, body };
}

function trackChild<T extends ChildProcess>(child: T): T {
  fixtureChildren.add(child);
  child.once("close", () => {
    fixtureChildren.delete(child);
  });
  return child;
}

function stopChild(child: ChildProcess): void {
  if (child.pid !== undefined && isProcessAlive(child.pid)) {
    child.kill("SIGTERM");
  }
}

function isProcessAlive(pid: number | undefined): boolean {
  if (pid === undefined) {
    return false;
  }
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return error instanceof Error && "code" in error && error.code === "EPERM";
  }
}

async function waitUntil(predicate: () => boolean, timeoutMs = 5_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (!predicate()) {
    if (Date.now() >= deadline) {
      throw new Error(`Condition was not met within ${timeoutMs} ms.`);
    }
    await new Promise<void>((resolve) => setTimeout(resolve, 10));
  }
}
