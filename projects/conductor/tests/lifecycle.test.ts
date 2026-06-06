import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import {
  HealthPoller,
  LifecycleManager,
  buildExitUrl,
  createConductorServer,
  createExitRequester,
  createShutdownController,
  parseCommand,
  validateServiceCommand,
  type ProcessRunner,
  type ServiceDefinition,
  type SpawnedProcess,
} from "../src/index.js";

const testServices: ServiceDefinition[] = [
  {
    name: "alpha",
    host: "0.0.0.0",
    port: 9101,
    command: "echo alpha",
  },
  {
    name: "beta",
    host: "127.0.0.1",
    port: 9102,
    command: "echo beta",
    home_path: "/beta",
  },
  {
    name: "conductor",
    host: "0.0.0.0",
    port: 9103,
    command: "npm --prefix projects/conductor start",
    home_path: "/",
  },
  {
    name: "empty-command",
    host: "127.0.0.1",
    port: 9104,
    command: "   ",
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

function createFakeProcessRunner(
  behavior: (command: string, cwd: string) => SpawnedProcess | Error,
): ProcessRunner
{
  return {
    spawn(command: string, cwd: string): SpawnedProcess
    {
      const result = behavior(command, cwd);

      if (result instanceof Error)
      {
        throw result;
      }

      return result;
    },
  };
}

async function withLifecycleServer(
  options: {
    services?: ServiceDefinition[];
    processRunner?: ProcessRunner;
    exitRequester?: ReturnType<typeof createExitRequester>;
    killProcess?: (pid: number) => void;
  },
  run: (context: {
    port: number;
    healthPoller: HealthPoller;
    lifecycleManager: LifecycleManager;
    exitUrls: string[];
  }) => Promise<void>,
): Promise<void>
{
  const services = options.services ?? testServices;
  const healthPoller = new HealthPoller({
    services,
    fetchFn: async (input) =>
    {
      const url = String(input);

      if (url.includes("/health"))
      {
        return new Response(JSON.stringify({ healthy: true, uptime: 9 }), { status: 200 });
      }

      return new Response("not found", { status: 404 });
    },
  });

  const exitUrls: string[] = [];
  const exitRequester = options.exitRequester ?? createExitRequester({
    fetchFn: async (input) =>
    {
      exitUrls.push(String(input));
      return new Response(JSON.stringify({ exiting: true }), { status: 200 });
    },
  });

  const lifecycleManager = new LifecycleManager({
    repoRoot: process.cwd(),
    processRunner: options.processRunner,
    exitRequester,
    getHeartbeat: (serviceName) => healthPoller.getHeartbeat(serviceName),
    killProcess: options.killProcess,
  });

  const shutdownController = createShutdownController({
    stopPoller: () => healthPoller.stop(),
    closeServer: async () => undefined,
  });

  const server = createConductorServer({
    services,
    bindHost: "127.0.0.1",
    bindPort: 0,
    healthPoller,
    shutdownController,
    repoRoot: process.cwd(),
    lifecycleManager,
  });

  const port = await server.listen();
  await healthPoller.runPollCycle();

  try
  {
    await run({ port, healthPoller, lifecycleManager, exitUrls });
  }
  finally
  {
    healthPoller.stop();
    await server.close();
  }
}

test("parseCommand splits quoted arguments", () =>
{
  assert.deepEqual(
    parseCommand("npm --prefix projects/conductor start"),
    ["npm", "--prefix", "projects/conductor", "start"],
  );
  assert.deepEqual(parseCommand("echo 'hello world'"), ["echo", "hello world"]);
});

test("buildExitUrl uses loopback host for bind-all addresses", () =>
{
  assert.equal(buildExitUrl(testServices[0]!), "http://127.0.0.1:9101/exit");
  assert.equal(buildExitUrl(testServices[2]!), "http://127.0.0.1:9103/exit");
});

test("validateServiceCommand rejects empty commands", () =>
{
  assert.equal(validateServiceCommand(testServices[0]!), null);
  assert.ok(validateServiceCommand(testServices[3]!));
});

test("POST /api/services/{service_name}/start returns process info and heartbeat", async () =>
{
  const spawned: Array<{ command: string; cwd: string }> = [];

  await withLifecycleServer({
    processRunner: createFakeProcessRunner((command, cwd) =>
    {
      spawned.push({ command, cwd });
      return { pid: 4242, command, argv: parseCommand(command) };
    }),
  }, async ({ port }) =>
  {
    const response = await requestJson(port, "POST", "/api/services/alpha/start");
    assert.equal(response.status, 200);

    const body = response.body as Record<string, unknown>;
    assert.equal(body.name, "alpha");
    assert.equal(body.action, "start");
    assert.equal(body.started, true);
    assert.deepEqual(body.process, {
      pid: 4242,
      command: "echo alpha",
      argv: ["echo", "alpha"],
    });
    assert.equal((body.heartbeat as { name: string }).name, "alpha");
    assert.equal((body.heartbeat as { healthy: boolean }).healthy, true);
    assert.equal(spawned.length, 1);
    assert.equal(spawned[0]!.command, "echo alpha");
    assert.equal(spawned[0]!.cwd, process.cwd());
  });
});

test("POST /api/services/{service_name}/start rejects invalid commands", async () =>
{
  await withLifecycleServer({}, async ({ port }) =>
  {
    const response = await requestJson(port, "POST", "/api/services/empty-command/start");
    assert.equal(response.status, 400);

    const body = response.body as Record<string, unknown>;
    assert.equal(body.started, false);
    assert.ok(body.error);
    assert.equal((body.heartbeat as { name: string }).name, "empty-command");
  });
});

test("POST /api/services/{service_name}/start reports spawn failures", async () =>
{
  await withLifecycleServer({
    processRunner: createFakeProcessRunner(() =>
    {
      const error = Object.assign(new Error("spawn ENOENT"), {
        message: "spawn ENOENT",
        command: "missing-binary",
        argv: ["missing-binary"],
      });
      throw error;
    }),
    services: [{
      name: "broken",
      host: "127.0.0.1",
      port: 9200,
      command: "missing-binary",
    }],
  }, async ({ port }) =>
  {
    const response = await requestJson(port, "POST", "/api/services/broken/start");
    assert.equal(response.status, 500);

    const body = response.body as Record<string, unknown>;
    assert.equal(body.started, false);
    assert.equal(body.error, "spawn ENOENT");
    assert.deepEqual(body.process, {
      pid: -1,
      command: "missing-binary",
      argv: ["missing-binary"],
    });
  });
});

test("POST /api/services/{service_name}/stop requests POST /exit", async () =>
{
  await withLifecycleServer({}, async ({ port, exitUrls }) =>
  {
    const response = await requestJson(port, "POST", "/api/services/beta/stop");
    assert.equal(response.status, 200);

    const body = response.body as Record<string, unknown>;
    assert.equal(body.stop_requested, true);
    assert.equal(exitUrls.length, 1);
    assert.equal(exitUrls[0], "http://127.0.0.1:9102/exit");
    assert.equal((body.heartbeat as { name: string }).name, "beta");
  });
});

test("POST /api/services/{service_name}/stop reports unreachable /exit", async () =>
{
  await withLifecycleServer({
    exitRequester: createExitRequester({
      fetchFn: async () =>
      {
        throw new Error("connection refused");
      },
    }),
  }, async ({ port }) =>
  {
    const response = await requestJson(port, "POST", "/api/services/beta/stop");
    assert.equal(response.status, 200);

    const body = response.body as Record<string, unknown>;
    assert.equal(body.stop_requested, false);
    assert.equal(body.error, "connection refused");
  });
});

test("POST /api/services/{service_name}/stop kills only owned process handles", async () =>
{
  const killed: number[] = [];
  const processRunner = createFakeProcessRunner((command) => ({
    pid: 5151,
    command,
    argv: parseCommand(command),
  }));

  await withLifecycleServer({
    processRunner,
    exitRequester: createExitRequester({
      fetchFn: async () =>
      {
        throw new Error("connection refused");
      },
    }),
    killProcess: (pid) =>
    {
      killed.push(pid);
    },
  }, async ({ port, lifecycleManager }) =>
  {
    const alpha = testServices[0]!;
    lifecycleManager.StartService(alpha);

    const response = await requestJson(port, "POST", "/api/services/alpha/stop");
    assert.equal(response.status, 200);
    assert.equal((response.body as { stop_requested: boolean }).stop_requested, true);
    assert.deepEqual(killed, [5151]);

    killed.length = 0;
    const betaResponse = await requestJson(port, "POST", "/api/services/beta/stop");
    assert.equal((betaResponse.body as { stop_requested: boolean }).stop_requested, false);
    assert.deepEqual(killed, []);
  });
});

test("POST /api/services/conductor/stop targets self /exit URL", async () =>
{
  await withLifecycleServer({}, async ({ port, exitUrls }) =>
  {
    const response = await requestJson(port, "POST", "/api/services/conductor/stop");
    assert.equal(response.status, 200);
    assert.equal((response.body as { stop_requested: boolean }).stop_requested, true);
    assert.equal(exitUrls.length, 1);
    assert.equal(exitUrls[0], "http://127.0.0.1:9103/exit");
  });
});

test("POST /api/services/{service_name}/restart stops before start", async () =>
{
  const events: string[] = [];

  await withLifecycleServer({
    processRunner: createFakeProcessRunner((command) =>
    {
      events.push(`start:${command}`);
      return { pid: 6060, command, argv: parseCommand(command) };
    }),
    exitRequester: createExitRequester({
      fetchFn: async (input) =>
      {
        events.push(`stop:${String(input)}`);
        return new Response(JSON.stringify({ exiting: true }), { status: 200 });
      },
    }),
  }, async ({ port }) =>
  {
    const response = await requestJson(port, "POST", "/api/services/alpha/restart");
    assert.equal(response.status, 200);

    const body = response.body as Record<string, unknown>;
    assert.equal(body.restart_requested, true);
    assert.equal(body.stop_requested, true);
    assert.equal(body.started, true);
    assert.deepEqual(events, [
      "stop:http://127.0.0.1:9101/exit",
      "start:echo alpha",
    ]);
  });
});

test("POST /api/services/conductor/restart uses injected exit and start fakes", async () =>
{
  const events: string[] = [];

  await withLifecycleServer({
    processRunner: createFakeProcessRunner((command) =>
    {
      events.push(`start:${command}`);
      return { pid: 7070, command, argv: parseCommand(command) };
    }),
    exitRequester: createExitRequester({
      fetchFn: async (input) =>
      {
        events.push(`stop:${String(input)}`);
        return new Response(JSON.stringify({ exiting: true }), { status: 200 });
      },
    }),
  }, async ({ port }) =>
  {
    const response = await requestJson(port, "POST", "/api/services/conductor/restart");
    assert.equal(response.status, 200);

    const body = response.body as Record<string, unknown>;
    assert.equal(body.restart_requested, true);
    assert.equal(body.stop_requested, true);
    assert.equal(body.started, true);
    assert.deepEqual(body.process, {
      pid: 7070,
      command: "npm --prefix projects/conductor start",
      argv: ["npm", "--prefix", "projects/conductor", "start"],
    });
    assert.deepEqual(events, [
      "stop:http://127.0.0.1:9103/exit",
      "start:npm --prefix projects/conductor start",
    ]);
  });
});

test("lifecycle routes return 404 for unknown services", async () =>
{
  await withLifecycleServer({}, async ({ port }) =>
  {
    const start = await requestJson(port, "POST", "/api/services/missing/start");
    assert.equal(start.status, 404);

    const stop = await requestJson(port, "POST", "/api/services/missing/stop");
    assert.equal(stop.status, 404);

    const restart = await requestJson(port, "POST", "/api/services/missing/restart");
    assert.equal(restart.status, 404);
  });
});

test("LifecycleManager StartService runs from provided repo root", async () =>
{
  const tempRoot = await mkdtemp(join(tmpdir(), "conductor-lifecycle-"));
  const spawned: string[] = [];

  try
  {
    const healthPoller = new HealthPoller({ services: [testServices[0]!] });
    const lifecycleManager = new LifecycleManager({
      repoRoot: tempRoot,
      processRunner: createFakeProcessRunner((command, cwd) =>
      {
        spawned.push(cwd);
        return { pid: 1, command, argv: parseCommand(command) };
      }),
      getHeartbeat: (serviceName) => healthPoller.getHeartbeat(serviceName),
    });

    const result = lifecycleManager.StartService(testServices[0]!);
    assert.equal(result.started, true);
    assert.deepEqual(spawned, [tempRoot]);
  }
  finally
  {
    await rm(tempRoot, { recursive: true, force: true });
  }
});
