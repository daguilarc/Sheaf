import assert from "node:assert/strict";
import { spawn, type ChildProcess } from "node:child_process";
import { readFile, writeFile, mkdtemp, mkdir } from "node:fs/promises";
import { createServer, request as httpRequest, type IncomingMessage } from "node:http";
import net from "node:net";
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
import { createRunRecord, updateRunSupervision } from "../src/logs.js";
import { XagentRunManager } from "../src/service/run_manager.js";
import {
  createShutdownController,
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
  await withServiceServer({}, async ({ port, server }) => {
    const response = await fetchJson(port, "GET", "/health");
    assert.equal(response.status, 200);
    assert.equal((response.body as { healthy: boolean }).healthy, true);
    assert.equal(typeof (response.body as { uptime: number }).uptime, "number");
    assert.equal("warning" in (response.body as object), false);
    assert.equal(server.httpServer.requestTimeout, 7_200_000);
    assert.equal(server.httpServer.timeout, 7_200_000);
    assert.ok((server.httpServer.headersTimeout ?? 0) >= 7_200_000);
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

// C1: DNS rebinding protection — bad Host header must be rejected on every
// route, including the cheap deterministic /health and /exit endpoints,
// so a browser that rebinds a public hostname to 127.0.0.1 cannot drive
// the local agent-launching service.
test("GET /health rejects a rebinding Host header with a bounded JSON 403", async () => {
  await withServiceServer({}, async ({ port }) => {
    const response = await rawHttpRequest(port, "GET", "/health", { Host: "evil.com:9005" });
    assert.equal(response.status, 403);
    assert.equal((response.body as { error: string }).error, "invalid_host");
  });
});

test("GET /health rejects a Host header that omits the port", async () => {
  await withServiceServer({}, async ({ port }) => {
    const response = await rawHttpRequest(port, "GET", "/health", { Host: "127.0.0.1" });
    assert.equal(response.status, 403);
    assert.equal((response.body as { error: string }).error, "invalid_host");
  });
});

test("GET /health accepts an explicit loopback Origin alongside the actual port", async () => {
  await withServiceServer({}, async ({ port }) => {
    const response = await rawHttpRequest(port, "GET", "/health", {
      Origin: `http://127.0.0.1:${port}`,
    });
    assert.equal(response.status, 200);
    assert.equal((response.body as { healthy: boolean }).healthy, true);
  });
});

test("GET /health rejects a cross-origin Origin header with a bounded JSON 403", async () => {
  await withServiceServer({}, async ({ port }) => {
    const response = await rawHttpRequest(port, "GET", "/health", {
      Origin: "http://evil.com",
    });
    assert.equal(response.status, 403);
    assert.equal((response.body as { error: string }).error, "invalid_origin");
  });
});

test("POST /exit rejects a rebinding Host header and does not trigger shutdown", async () => {
  await withServiceServer({}, async ({ port, shutdownController }) => {
    const response = await rawHttpRequest(port, "POST", "/exit", { Host: "evil.com:9005" });
    assert.equal(response.status, 403);
    assert.equal((response.body as { error: string }).error, "invalid_host");
    // The shutdown sequence must not start when the Host is rejected.
    assert.equal(shutdownController.wasShutdownRequested(), false);
  });
});

test("POST /mcp rejects a rebinding Host header before the MCP transport accepts the session", async () => {
  await withServiceServer({}, async ({ port }) => {
    const response = await rawHttpRequest(
      port,
      "POST",
      "/mcp",
      {
        Host: "evil.com:9005",
        "Content-Type": "application/json",
      },
      JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        method: "initialize",
        params: {
          protocolVersion: "2025-11-25",
          capabilities: {},
          clientInfo: { name: "rebinding-attacker", version: "0.0.0" },
        },
      }),
    );
    assert.equal(response.status, 403);
    const body = response.body as { error?: unknown };
    assert.ok(typeof body === "object" && body !== null);
    // The SDK's DNS-rebinding guard returns a JSON-RPC error envelope
    // mentioning the Host header; either that envelope or the server's own
    // 403 is acceptable as long as the status is 403 and the body is bounded
    // JSON.
    assert.ok(
      textContains(response.rawText, "Invalid Host header") || body.error === "invalid_host",
      `expected host-rejection body, got ${response.rawText}`,
    );
  });
});


test("POST /exit closes the listener before owned runs so the bind port is free during cleanup", async () => {
  const events: string[] = [];
  let bindPort = 0;
  let reboundDuringRunClose = false;

  await withServiceServer(
    {
      closeRuns: async (runManager) => {
        events.push("runs-closed");
        // The listener must already be closed so Conductor can rebind immediately
        // while stubborn children are still being cleaned up.
        //
        try {
          const probe = createServer();
          await new Promise<void>((resolve, reject) => {
            probe.once("error", reject);
            probe.listen(bindPort, "127.0.0.1", () => {
              probe.close((error) => {
                if (error) {
                  reject(error);
                  return;
                }
                resolve();
              });
            });
          });
          reboundDuringRunClose = true;
        } catch {
          reboundDuringRunClose = false;
        }
        await runManager.closeAll();
      },
      closeServer: async (server) => {
        events.push("server-closed");
        await server.close();
      },
    },
    async ({ port, shutdownController }) => {
      bindPort = port;
      const response = await fetchJson(port, "POST", "/exit");
      assert.equal(response.status, 200);
      assert.deepEqual(response.body, { exiting: true });
      await shutdownController.shutdownComplete();
      assert.deepEqual(events, ["server-closed", "runs-closed"]);
      assert.equal(reboundDuringRunClose, true);
    },
  );
});

test("POST /exit with an in-flight HTTP connection still closes owned runs (drain does not gate cleanup)", async () => {
  const events: string[] = [];
  let closeRunsRan = false;

  await withServiceServer(
    {
      closeRuns: async (runManager) => {
        events.push("runs-closed");
        closeRunsRan = true;
        await runManager.closeAll();
      },
      closeServer: async (server) => {
        events.push("server-closed");
        await server.close();
      },
    },
    async ({ port, shutdownController }) => {
      // Open a hung HTTP connection that never completes its body. This
      // mimics a pending xagent_await POST whose JSON response cannot
      // settle after transport.close() with enableJsonResponse: the
      // connection never becomes idle, so httpServer.close()'s drain
      // callback would never fire if we waited for it.
      //
      const hungSocket = net.createConnection({ host: "127.0.0.1", port });
      await new Promise<void>((resolve) => hungSocket.once("connect", resolve));
      hungSocket.write(
        `POST /mcp HTTP/1.1\r\nHost: 127.0.0.1:${port}\r\nContent-Length: 100\r\nMCP-Session-Id: hung-session\r\n\r\n`,
      );

      try {
        const response = await fetchJson(port, "POST", "/exit");
        assert.equal(response.status, 200);
        assert.deepEqual(response.body, { exiting: true });

        const completed = await Promise.race([
          shutdownController.shutdownComplete().then(() => true),
          new Promise<boolean>((resolve) => setTimeout(() => resolve(false), 5_000)),
        ]);

        assert.equal(
          completed,
          true,
          "closeRuns must run even when an in-flight HTTP connection never drains",
        );
        assert.equal(closeRunsRan, true);
        assert.deepEqual(events, ["server-closed", "runs-closed"]);
      } finally {
        hungSocket.destroy();
      }
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

test("service_main reconciles stale active runs before accepting work", async () => {
  const sheafRoot = await mkdtemp(path.join(tmpdir(), "xagent-svc-reconcile-"));
  await mkdir(path.join(sheafRoot, "config"), { recursive: true });
  await mkdir(path.join(sheafRoot, "structure"), { recursive: true });
  await writeFile(path.join(sheafRoot, "structure", ".gitkeep"), "", "utf8");
  const servicesJsonPath = path.join(sheafRoot, "config", "services.json");
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

  const logRoot = path.join(sheafRoot, "data", "xagent");
  await mkdir(logRoot, { recursive: true });
  const staleRunId = "xrun_stale_at_boot";
  const record = await createRunRecord({
    repoRoot: sheafRoot,
    logRoot,
    runId: staleRunId,
    harness: "codex",
    mode: "subagent",
    clock: () => new Date("2026-07-25T12:00:00.000Z"),
  });
  await updateRunSupervision(record, {
    phase: "running",
    sequence: 3,
    provider_thread_id: "provider-thread-stale",
    last_transport_progress_at: "2026-07-25T12:01:00.000Z",
    last_semantic_progress_at: "2026-07-25T12:00:30.000Z",
    owned_process: {
      pid: 4_999_999,
      process_group_id: 4_999_999,
      started_at: "2026-07-25T11:59:59.000Z",
      start_identity: "stale-boot-start",
    },
  });
  const metadataBefore = JSON.parse(await readFile(record.metadataPath, "utf8")) as {
    supervision: { phase: string };
  };
  assert.equal(metadataBefore.supervision.phase, "running");

  const serviceMain = path.join(process.cwd(), "dist", "src", "service_main.js");
  const child = trackChild(
    spawn(process.execPath, [serviceMain], {
      cwd: sheafRoot,
      stdio: ["ignore", "pipe", "pipe"],
    }),
  );

  const stderrChunks: Buffer[] = [];
  child.stderr?.on("data", (chunk: Buffer) => stderrChunks.push(chunk));

  const port = await waitForPort(stderrChunks, 10_000);

  // Reconciliation runs before the listener accepts work; by the time the
  // listening line is printed the stale run must already be abandoned.
  const metadataAfter = JSON.parse(await readFile(record.metadataPath, "utf8")) as {
    supervision: { phase: string };
    exit_status: string;
  };
  assert.equal(metadataAfter.supervision.phase, "abandoned");
  assert.equal(metadataAfter.exit_status, "failed");

  const exitResponse = await fetchJson(port, "POST", "/exit");
  assert.equal(exitResponse.status, 200);
  assert.deepEqual(exitResponse.body, { exiting: true });

  const exitCode = await waitForExit(child, 10_000);
  assert.equal(exitCode, 0);
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
  let resolveShutdown: (() => void) | undefined;
  const shutdownDone = new Promise<void>((resolve) => {
    resolveShutdown = resolve;
  });
  const inner = createShutdownController({
    closeServer: deps.closeServer,
    closeRuns: deps.closeRuns,
    onShutdownComplete: () => {
      resolveShutdown?.();
    },
  });

  return {
    requestShutdown(): Promise<void> {
      return inner.requestShutdown();
    },
    wasShutdownRequested(): boolean {
      return inner.wasShutdownRequested();
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

// Sends a raw HTTP/1.1 request with arbitrary headers (including a
// caller-controlled Host header, which the global `fetch` implementation
// may refuse to override). Used to exercise DNS-rebinding protection on
// the loopback service.
async function rawHttpRequest(
  port: number,
  method: string,
  requestPath: string,
  headers: Record<string, string>,
  body?: string,
): Promise<{ status: number; body: unknown; rawText: string }> {
  const response = await new Promise<{ status: number; rawText: string }>((resolve, reject) => {
    const req = httpRequest(
      {
        host: "127.0.0.1",
        port,
        method,
        path: requestPath,
        headers,
      },
      (res: IncomingMessage) => {
        const chunks: Buffer[] = [];
        res.on("data", (chunk: Buffer) => chunks.push(chunk));
        res.on("end", () => {
          const rawText = Buffer.concat(chunks).toString("utf8");
          resolve({ status: res.statusCode ?? 0, rawText });
        });
      },
    );
    req.on("error", reject);
    if (body !== undefined) {
      req.end(body);
    } else {
      req.end();
    }
  });
  assert.ok(response.rawText.length <= 4096, "response body must be bounded");
  let parsed: unknown = response.rawText;
  if (response.rawText.length > 0) {
    try {
      parsed = JSON.parse(response.rawText);
    } catch {
      // Keep raw text for diagnostics.
    }
  }
  return { status: response.status, body: parsed, rawText: response.rawText };
}

function textContains(haystack: string, needle: string): boolean {
  return haystack.includes(needle);
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
