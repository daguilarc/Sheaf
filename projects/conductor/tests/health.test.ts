import assert from "node:assert/strict";
import test from "node:test";

import {
  HealthPoller,
  buildHealthUrl,
  createConductorServer,
  createShutdownController,
  parseHealthResponseBody,
  resolvePollHost,
  type ServiceDefinition,
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

async function withTestServer(
  options: {
    serverStartTime?: number;
    warning?: string;
    shutdownDeps?: Parameters<typeof createShutdownController>[0];
  },
  run: (context: {
    port: number;
    healthPoller: HealthPoller;
    shutdownController: ReturnType<typeof createShutdownController>;
    close: () => Promise<void>;
  }) => Promise<void>,
): Promise<void>
{
  const healthPoller = new HealthPoller({ services: testServices });
  let serverClose = async (): Promise<void> => undefined;

  let shutdownController!: ReturnType<typeof createShutdownController>;

  shutdownController = createShutdownController(options.shutdownDeps ?? {
    stopPoller: () => healthPoller.stop(),
    closeServer: async () =>
    {
      await serverClose();
    },
  });

  const server = createConductorServer({
    services: testServices,
    bindHost: "127.0.0.1",
    bindPort: 0,
    healthPoller,
    shutdownController,
    serverStartTime: options.serverStartTime,
    warning: options.warning,
  });

  serverClose = () => server.close();
  const port = await server.listen();

  try
  {
    await run({
      port,
      healthPoller,
      shutdownController,
      close: serverClose,
    });
  }
  finally
  {
    healthPoller.stop();
    await server.close();
  }
}

test("resolvePollHost maps 0.0.0.0 to 127.0.0.1", () =>
{
  assert.equal(resolvePollHost("0.0.0.0"), "127.0.0.1");
  assert.equal(resolvePollHost("127.0.0.1"), "127.0.0.1");
});

test("buildHealthUrl uses loopback host for bind-all addresses", () =>
{
  assert.equal(
    buildHealthUrl(testServices[0]!),
    "http://127.0.0.1:9101/health",
  );
});

test("parseHealthResponseBody accepts healthy responses", () =>
{
  const parsed = parseHealthResponseBody({
    healthy: true,
    uptime: 12.5,
    warning: "disk low",
  });

  assert.equal(parsed.healthy, true);
  assert.equal(parsed.uptime, 12.5);
  assert.equal(parsed.warning, "disk low");
  assert.equal(parsed.error, null);
});

test("parseHealthResponseBody rejects unhealthy and invalid responses", () =>
{
  assert.equal(parseHealthResponseBody({ healthy: false }).error, "healthy: false");
  assert.equal(parseHealthResponseBody({ uptime: 1 }).error, "missing healthy");
  assert.equal(parseHealthResponseBody({ healthy: true }).error, "missing uptime");
  assert.equal(parseHealthResponseBody("bad").error, "invalid JSON");
});

test("GET /health returns the standard health shape", async () =>
{
  const startTime = Date.now() - 2_500;

  await withTestServer({ serverStartTime: startTime }, async ({ port }) =>
  {
    const first = await requestJson(port, "GET", "/health");
    assert.equal(first.status, 200);
    assert.equal((first.body as { healthy: boolean }).healthy, true);
    assert.ok((first.body as { uptime: number }).uptime >= 2);

    await new Promise((resolve) => setTimeout(resolve, 50));

    const second = await requestJson(port, "GET", "/health");
    assert.ok(
      (second.body as { uptime: number }).uptime
        > (first.body as { uptime: number }).uptime,
    );
  });
});

test("GET /health includes optional warning", async () =>
{
  await withTestServer({ warning: "maintenance soon" }, async ({ port }) =>
  {
    const response = await requestJson(port, "GET", "/health");
    assert.equal((response.body as { warning: string }).warning, "maintenance soon");
  });
});

test("POST /exit acknowledges shutdown and runs shutdown work after response flush", async () =>
{
  const events: string[] = [];
  let pollerStopped = false;
  let serverToClose: (() => Promise<void>) | undefined;

  const healthPoller = new HealthPoller({ services: testServices });
  const shutdownController = createShutdownController({
    stopPoller: () =>
    {
      pollerStopped = true;
      events.push("poller-stopped");
    },
    closeServer: async () =>
    {
      events.push("server-closed");
      if (serverToClose)
      {
        await serverToClose();
      }
    },
  });

  const server = createConductorServer({
    services: testServices,
    bindHost: "127.0.0.1",
    bindPort: 0,
    healthPoller,
    shutdownController,
  });

  serverToClose = () => server.close();
  const port = await server.listen();

  try
  {
    const response = await requestJson(port, "POST", "/exit");
    assert.equal(response.status, 200);
    assert.deepEqual(response.body, { exiting: true });
    assert.equal(shutdownController.wasShutdownRequested(), true);
    assert.equal(pollerStopped, true);
    assert.deepEqual(events, ["poller-stopped", "server-closed"]);
  }
  finally
  {
    healthPoller.stop();
    await server.close();
  }
});

test("health poller marks healthy 2xx JSON responses as healthy", async () =>
{
  const fetchCalls: string[] = [];
  const fetchFn: typeof fetch = async (input) =>
  {
    fetchCalls.push(String(input));
    return new Response(JSON.stringify({ healthy: true, uptime: 42 }), { status: 200 });
  };

  const poller = new HealthPoller({
    services: testServices,
    fetchFn,
  });

  await poller.runPollCycle();

  const alpha = poller.getHeartbeat("alpha");
  assert.equal(alpha?.healthy, true);
  assert.equal(alpha?.uptime, 42);
  assert.equal(alpha?.last_error, null);
  assert.ok(alpha?.last_checked_at);
  assert.equal(fetchCalls.length, 2);
});

test("health poller marks explicit unhealthy responses as unhealthy", async () =>
{
  const fetchFn: typeof fetch = async () =>
    new Response(JSON.stringify({ healthy: false, uptime: 1 }), { status: 200 });

  const poller = new HealthPoller({
    services: [testServices[0]!],
    fetchFn,
  });

  await poller.runPollCycle();

  const heartbeat = poller.getHeartbeat("alpha");
  assert.equal(heartbeat?.healthy, false);
  assert.equal(heartbeat?.last_error, "healthy: false");
});

test("health poller marks invalid JSON as unhealthy", async () =>
{
  const fetchFn: typeof fetch = async () => new Response("not-json", { status: 200 });

  const poller = new HealthPoller({
    services: [testServices[0]!],
    fetchFn,
  });

  await poller.runPollCycle();

  const heartbeat = poller.getHeartbeat("alpha");
  assert.equal(heartbeat?.healthy, false);
  assert.equal(heartbeat?.last_error, "invalid JSON");
});

test("health poller marks missing required fields as unhealthy", async () =>
{
  const fetchFn: typeof fetch = async () =>
    new Response(JSON.stringify({ healthy: true }), { status: 200 });

  const poller = new HealthPoller({
    services: [testServices[0]!],
    fetchFn,
  });

  await poller.runPollCycle();

  const heartbeat = poller.getHeartbeat("alpha");
  assert.equal(heartbeat?.healthy, false);
  assert.equal(heartbeat?.last_error, "missing uptime");
});

test("health poller marks non-2xx responses as unhealthy", async () =>
{
  const fetchFn: typeof fetch = async () => new Response("down", { status: 503 });

  const poller = new HealthPoller({
    services: [testServices[0]!],
    fetchFn,
  });

  await poller.runPollCycle();

  const heartbeat = poller.getHeartbeat("alpha");
  assert.equal(heartbeat?.healthy, false);
  assert.equal(heartbeat?.last_error, "HTTP 503");
});

test("health poller marks network failures as unhealthy", async () =>
{
  const fetchFn: typeof fetch = async () =>
  {
    throw new Error("connection refused");
  };

  const poller = new HealthPoller({
    services: [testServices[0]!],
    fetchFn,
  });

  await poller.runPollCycle();

  const heartbeat = poller.getHeartbeat("alpha");
  assert.equal(heartbeat?.healthy, false);
  assert.equal(heartbeat?.last_error, "connection refused");
});

test("health poller marks request timeouts as unhealthy", async () =>
{
  const fetchFn: typeof fetch = async (_input, init) =>
  {
    return new Promise((_resolve, reject) =>
    {
      init?.signal?.addEventListener("abort", () =>
      {
        reject(new Error("The operation was aborted"));
      });
    });
  };

  const poller = new HealthPoller({
    services: [testServices[0]!],
    fetchFn,
    requestTimeoutMs: 10,
  });

  await poller.runPollCycle();

  const heartbeat = poller.getHeartbeat("alpha");
  assert.equal(heartbeat?.healthy, false);
  assert.ok(heartbeat?.last_error);
});

test("health poller initial state is deterministic", () =>
{
  const poller = new HealthPoller({ services: testServices });
  const heartbeat = poller.getHeartbeat("alpha");

  assert.deepEqual(heartbeat, {
    healthy: false,
    last_checked_at: null,
    last_error: "not checked yet",
  });
});

test("health poller stop clears the polling timer", async () =>
{
  let intervalCount = 0;
  const setIntervalFn = ((handler: TimerHandler) =>
  {
    intervalCount += 1;
    return setInterval(handler, 1_000);
  }) as typeof setInterval;

  const poller = new HealthPoller({
    services: [testServices[0]!],
    fetchFn: async () => new Response(JSON.stringify({ healthy: true, uptime: 1 }), { status: 200 }),
    setIntervalFn,
  });

  poller.start();
  assert.equal(intervalCount, 1);
  poller.stop();
  poller.stop();
});
