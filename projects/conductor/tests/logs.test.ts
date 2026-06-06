import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import {
  HealthPoller,
  createConductorServer,
  createShutdownController,
  isPathInsideRoot,
  listServiceLogs,
  normalizeRelativeLogPath,
  resolveLogFilePath,
  type ServiceDefinition,
} from "../src/index.js";

const testServices: ServiceDefinition[] = [
  {
    name: "alpha",
    host: "127.0.0.1",
    port: 9101,
    command: "echo alpha",
  },
];

async function requestJson(
  port: number,
  method: string,
  path: string,
): Promise<{ status: number; body: unknown }>
{
  const response = await fetch(`http://127.0.0.1:${port}${path}`, { method });
  const body = await response.json() as unknown;
  return { status: response.status, body };
}

async function withLogServer(
  repoRoot: string,
  run: (context: { port: number }) => Promise<void>,
): Promise<void>
{
  const healthPoller = new HealthPoller({ services: testServices });
  const shutdownController = createShutdownController({
    stopPoller: () => healthPoller.stop(),
    closeServer: async () => undefined,
  });

  const server = createConductorServer({
    services: testServices,
    bindHost: "127.0.0.1",
    bindPort: 0,
    healthPoller,
    shutdownController,
    repoRoot,
  });

  const port = await server.listen();

  try
  {
    await run({ port });
  }
  finally
  {
    healthPoller.stop();
    await server.close();
  }
}

test("normalizeRelativeLogPath rejects absolute paths and traversal", () =>
{
  assert.equal(normalizeRelativeLogPath("server.log"), "server.log");
  assert.equal(normalizeRelativeLogPath("nested/server.log"), "nested/server.log");
  assert.equal(normalizeRelativeLogPath("../secret.log"), null);
  assert.equal(normalizeRelativeLogPath("/etc/passwd"), null);
  assert.equal(normalizeRelativeLogPath("nested/../secret.log"), null);
});

test("resolveLogFilePath stays inside the log root", () =>
{
  const logRoot = join(process.cwd(), "logs", "alpha");
  const resolved = resolveLogFilePath(logRoot, "nested/server.log");

  assert.ok(resolved);
  assert.equal(isPathInsideRoot(resolved!, logRoot), true);
  assert.equal(resolveLogFilePath(logRoot, "../beta/server.log"), null);
});

test("listServiceLogs returns empty files for missing log directory", async () =>
{
  const tempRoot = await mkdtemp(join(tmpdir(), "conductor-logs-empty-"));

  try
  {
    const logRoot = join(tempRoot, "logs", "alpha");
    const listing = await listServiceLogs("alpha", logRoot);

    assert.equal(listing.name, "alpha");
    assert.equal(listing.log_root, "logs/alpha/");
    assert.deepEqual(listing.files, []);
  }
  finally
  {
    await rm(tempRoot, { recursive: true, force: true });
  }
});

test("listServiceLogs returns nested files with size and modified timestamp", async () =>
{
  const tempRoot = await mkdtemp(join(tmpdir(), "conductor-logs-nested-"));

  try
  {
    const logRoot = join(tempRoot, "logs", "alpha");
    await mkdir(join(logRoot, "nested"), { recursive: true });
    await writeFile(join(logRoot, "server.log"), "hello");
    await writeFile(join(logRoot, "nested", "worker.log"), "worker");

    const listing = await listServiceLogs("alpha", logRoot);
    assert.equal(listing.files.length, 2);

    const serverLog = listing.files.find((entry) => entry.path === "server.log");
    const workerLog = listing.files.find((entry) => entry.path === "nested/worker.log");

    assert.ok(serverLog);
    assert.ok(workerLog);
    assert.equal(serverLog.size, 5);
    assert.equal(workerLog.size, 6);
    assert.ok(Date.parse(serverLog.modified_at));
    assert.ok(Date.parse(workerLog.modified_at));
  }
  finally
  {
    await rm(tempRoot, { recursive: true, force: true });
  }
});

test("GET /api/services/{service_name}/logs lists service log files", async () =>
{
  const tempRoot = await mkdtemp(join(tmpdir(), "conductor-logs-api-"));

  try
  {
    const logRoot = join(tempRoot, "logs", "alpha");
    await mkdir(logRoot, { recursive: true });
    await writeFile(join(logRoot, "api.log"), "api");

    await withLogServer(tempRoot, async ({ port }) =>
    {
      const response = await requestJson(port, "GET", "/api/services/alpha/logs");
      assert.equal(response.status, 200);

      const body = response.body as Record<string, unknown>;
      assert.equal(body.name, "alpha");
      assert.equal(body.log_root, "logs/alpha/");

      const files = body.files as Array<Record<string, unknown>>;
      assert.equal(files.length, 1);
      assert.equal(files[0]!.path, "api.log");
      assert.equal(files[0]!.size, 3);
      assert.ok(files[0]!.modified_at);
    });
  }
  finally
  {
    await rm(tempRoot, { recursive: true, force: true });
  }
});

test("GET /api/services/{service_name}/logs returns 404 for unknown services", async () =>
{
  const tempRoot = await mkdtemp(join(tmpdir(), "conductor-logs-404-"));

  try
  {
    await withLogServer(tempRoot, async ({ port }) =>
    {
      const response = await requestJson(port, "GET", "/api/services/missing/logs");
      assert.equal(response.status, 404);
    });
  }
  finally
  {
    await rm(tempRoot, { recursive: true, force: true });
  }
});
