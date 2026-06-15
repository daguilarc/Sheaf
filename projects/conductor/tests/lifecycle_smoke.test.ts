import assert from "node:assert/strict";
import test from "node:test";

import {
  HealthPoller,
  LifecycleManager,
  SMOKE_ASSET_ROOT_ENV_VAR,
  SMOKE_TEST_MODE_ENV_VAR,
  createConductorServer,
  createExitRequester,
  createShutdownController,
  parseCommand,
  type ProcessRunner,
  type ServiceDefinition,
  type SpawnedProcess,
} from "../src/index.js";

const alpha: ServiceDefinition = {
  name: "alpha",
  host: "127.0.0.1",
  port: 9101,
  command: "echo alpha",
};

type SpawnRecord = { serviceName: string; env: Record<string, string> | undefined };

function createCapturingRunner(records: SpawnRecord[]): ProcessRunner
{
  return {
    spawn(command: string, _cwd: string, serviceName: string, env?: Record<string, string>): SpawnedProcess
    {
      records.push({ serviceName, env });
      return { pid: 1234, command, argv: parseCommand(command) };
    },
  };
}

function createManager(records: SpawnRecord[]): LifecycleManager
{
  const healthPoller = new HealthPoller({ services: [alpha] });
  return new LifecycleManager({
    repoRoot: "/repo/worktree",
    processRunner: createCapturingRunner(records),
    resolveSmokeAssetRoot: () => "/main/checkout",
    getHeartbeat: (serviceName) => healthPoller.getHeartbeat(serviceName),
  });
}

test("StartService injects the smoke env when smokeTest is true", () =>
{
  const records: SpawnRecord[] = [];
  createManager(records).StartService(alpha, { smokeTest: true });

  assert.equal(records.length, 1);
  assert.deepEqual(records[0]!.env, {
    [SMOKE_TEST_MODE_ENV_VAR]: "1",
    [SMOKE_ASSET_ROOT_ENV_VAR]: "/main/checkout",
  });
});

test("StartService passes no env when smokeTest is absent or false", () =>
{
  const records: SpawnRecord[] = [];
  const manager = createManager(records);
  manager.StartService(alpha);
  manager.StartService(alpha, { smokeTest: false });

  assert.equal(records.length, 2);
  assert.equal(records[0]!.env, undefined);
  assert.equal(records[1]!.env, undefined);
});

test("RestartService forwards the smoke flag to the start phase", async () =>
{
  const records: SpawnRecord[] = [];
  const exitRequester = createExitRequester({
    fetchFn: async () => new Response(JSON.stringify({ exiting: true }), { status: 200 }),
  });
  const healthPoller = new HealthPoller({ services: [alpha] });
  const restartManager = new LifecycleManager({
    repoRoot: "/repo/worktree",
    processRunner: createCapturingRunner(records),
    resolveSmokeAssetRoot: () => "/main/checkout",
    exitRequester,
    getHeartbeat: (serviceName) => healthPoller.getHeartbeat(serviceName),
  });

  await restartManager.RestartService(alpha, { smokeTest: true });

  assert.equal(records.length, 1);
  assert.deepEqual(records[0]!.env, {
    [SMOKE_TEST_MODE_ENV_VAR]: "1",
    [SMOKE_ASSET_ROOT_ENV_VAR]: "/main/checkout",
  });
});

async function withServer(
  records: SpawnRecord[],
  run: (port: number) => Promise<void>,
): Promise<void>
{
  const healthPoller = new HealthPoller({ services: [alpha] });
  const lifecycleManager = new LifecycleManager({
    repoRoot: "/repo/worktree",
    processRunner: createCapturingRunner(records),
    resolveSmokeAssetRoot: () => "/main/checkout",
    exitRequester: createExitRequester({
      fetchFn: async () => new Response(JSON.stringify({ exiting: true }), { status: 200 }),
    }),
    getHeartbeat: (serviceName) => healthPoller.getHeartbeat(serviceName),
  });
  const shutdownController = createShutdownController({
    stopPoller: () => healthPoller.stop(),
    closeServer: async () => undefined,
  });
  const server = createConductorServer({
    services: [alpha],
    bindHost: "127.0.0.1",
    bindPort: 0,
    healthPoller,
    shutdownController,
    repoRoot: "/repo/worktree",
    lifecycleManager,
  });
  const port = await server.listen();

  try
  {
    await run(port);
  }
  finally
  {
    healthPoller.stop();
    await server.close();
  }
}

test("POST start with smoke_test: true in the body injects the smoke env", async () =>
{
  const records: SpawnRecord[] = [];
  await withServer(records, async (port) =>
  {
    const response = await fetch(`http://127.0.0.1:${port}/api/services/alpha/start`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ smoke_test: true }),
    });
    assert.equal(response.status, 200);
  });

  assert.equal(records.length, 1);
  assert.deepEqual(records[0]!.env, {
    [SMOKE_TEST_MODE_ENV_VAR]: "1",
    [SMOKE_ASSET_ROOT_ENV_VAR]: "/main/checkout",
  });
});

test("POST restart without a body leaves the spawn env unchanged", async () =>
{
  const records: SpawnRecord[] = [];
  await withServer(records, async (port) =>
  {
    const response = await fetch(`http://127.0.0.1:${port}/api/services/alpha/restart`, {
      method: "POST",
    });
    assert.equal(response.status, 200);
  });

  assert.equal(records.length, 1);
  assert.equal(records[0]!.env, undefined);
});
