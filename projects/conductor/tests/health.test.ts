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

type FakeTimer =
{
  id: number;
  handler: () => void;
  delayMs: number;
};

class FakeTimers
{
  private m_nextId = 1;
  private m_timers = new Map<number, FakeTimer>();

  readonly setTimeout = ((handler: TimerHandler, delay?: number): ReturnType<typeof setTimeout> =>
  {
    const id = this.m_nextId;
    this.m_nextId += 1;
    this.m_timers.set(id, {
      id,
      handler: handler as () => void,
      delayMs: delay ?? 0,
    });
    return id as unknown as ReturnType<typeof setTimeout>;
  }) as unknown as typeof setTimeout;

  readonly clearTimeout = ((timer?: ReturnType<typeof setTimeout>): void =>
  {
    this.m_timers.delete(timer as unknown as number);
  }) as typeof clearTimeout;

  get timers(): FakeTimer[]
  {
    return [...this.m_timers.values()];
  }

  get onlyTimer(): FakeTimer
  {
    assert.equal(this.m_timers.size, 1);
    return this.timers[0]!;
  }

  run(timer: FakeTimer): void
  {
    this.m_timers.delete(timer.id);
    timer.handler();
  }
}

async function settleAsyncWork(): Promise<void>
{
  await new Promise((resolve) => setImmediate(resolve));
}

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

test("health poller foreground leases renew, release, and expire", () =>
{
  let now = Date.parse("2026-06-16T12:00:00.000Z");
  const poller = new HealthPoller({
    services: [testServices[0]!],
    foregroundLeaseTtlMs: 3_000,
    nowFn: () => now,
  });

  const renewal = poller.renewForegroundLease("page-1");
  assert.deepEqual(renewal, {
    foreground_polling: true,
    poll_interval_ms: 1_000,
    expires_at: "2026-06-16T12:00:03.000Z",
  });
  assert.equal(poller.hasActiveForegroundLeases(), true);

  now += 2_999;
  assert.equal(poller.hasActiveForegroundLeases(), true);

  now += 1;
  assert.equal(poller.hasActiveForegroundLeases(), false);

  poller.renewForegroundLease("page-1");
  poller.renewForegroundLease("page-2");
  assert.deepEqual(poller.releaseForegroundLease("page-1"), {
    foreground_polling: true,
    poll_interval_ms: 1_000,
  });
  assert.deepEqual(poller.releaseForegroundLease("page-2"), {
    foreground_polling: false,
    poll_interval_ms: 1_000,
  });
});

test("health poller switches between background and foreground cadence", async () =>
{
  let now = Date.parse("2026-06-16T12:00:00.000Z");
  let fetchCount = 0;
  const timers = new FakeTimers();
  const poller = new HealthPoller({
    services: [testServices[0]!],
    fetchFn: async () =>
    {
      fetchCount += 1;
      return new Response(JSON.stringify({ healthy: true, uptime: fetchCount }), { status: 200 });
    },
    pollIntervalMs: 30_000,
    foregroundPollIntervalMs: 1_000,
    foregroundLeaseTtlMs: 3_000,
    setTimeoutFn: timers.setTimeout,
    clearTimeoutFn: timers.clearTimeout,
    nowFn: () => now,
  });

  poller.start();
  await settleAsyncWork();
  assert.equal(fetchCount, 1);
  assert.equal(timers.onlyTimer.delayMs, 30_000);

  poller.renewForegroundLease("page-1");
  assert.equal(timers.onlyTimer.delayMs, 0);

  timers.run(timers.onlyTimer);
  await settleAsyncWork();
  assert.equal(fetchCount, 2);
  assert.equal(timers.onlyTimer.delayMs, 1_000);

  now += 3_000;
  timers.run(timers.onlyTimer);
  await settleAsyncWork();
  assert.equal(fetchCount, 3);
  assert.equal(timers.onlyTimer.delayMs, 30_000);

  poller.stop();
});

test("health poller skips overlapping scheduled poll cycles", async () =>
{
  let resolveFetch: (response: Response) => void = () => undefined;
  let fetchCount = 0;
  const timers = new FakeTimers();
  const poller = new HealthPoller({
    services: [testServices[0]!],
    fetchFn: async () =>
    {
      fetchCount += 1;
      return await new Promise<Response>((resolve) =>
      {
        resolveFetch = resolve;
      });
    },
    foregroundPollIntervalMs: 1_000,
    foregroundLeaseTtlMs: 3_000,
    setTimeoutFn: timers.setTimeout,
    clearTimeoutFn: timers.clearTimeout,
  });

  poller.start();
  await settleAsyncWork();
  assert.equal(fetchCount, 1);

  poller.renewForegroundLease("page-1");
  const immediateForegroundPoll = timers.timers.find((timer) => timer.delayMs === 0);
  assert.ok(immediateForegroundPoll);
  timers.run(immediateForegroundPoll);
  await settleAsyncWork();
  assert.equal(fetchCount, 1);
  assert.ok(timers.timers.some((timer) => timer.delayMs === 1_000));

  resolveFetch(new Response(JSON.stringify({ healthy: true, uptime: 1 }), { status: 200 }));
  await settleAsyncWork();
  assert.equal(fetchCount, 1);
  assert.ok(timers.timers.some((timer) => timer.delayMs === 1_000));

  poller.stop();
});

test("health poller stop clears the polling timer", async () =>
{
  const timers = new FakeTimers();
  let clearedTimer = false;
  const clearTimeoutFn = ((timer?: ReturnType<typeof setTimeout>): void =>
  {
    clearedTimer = true;
    timers.clearTimeout(timer);
  }) as typeof clearTimeout;

  const poller = new HealthPoller({
    services: [testServices[0]!],
    fetchFn: async () => new Response(JSON.stringify({ healthy: true, uptime: 1 }), { status: 200 }),
    setTimeoutFn: timers.setTimeout,
    clearTimeoutFn,
  });

  poller.start();
  await settleAsyncWork();
  assert.equal(timers.onlyTimer.delayMs, 30_000);
  poller.stop();
  assert.equal(clearedTimer, true);
  assert.equal(timers.timers.length, 0);
  poller.stop();
});
