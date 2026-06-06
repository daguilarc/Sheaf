import assert from "node:assert/strict";
import test from "node:test";

import {
  HealthPoller,
  createConductorServer,
  createShutdownController,
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
  run: (context: { port: number; healthPoller: HealthPoller }) => Promise<void>,
): Promise<void>
{
  const healthPoller = new HealthPoller({
    services: testServices,
    fetchFn: async (input) =>
    {
      const url = String(input);

      if (url.includes(":9101/health"))
      {
        return new Response(JSON.stringify({ healthy: true, uptime: 11, warning: "alpha warn" }), {
          status: 200,
        });
      }

      return new Response(JSON.stringify({ healthy: false, uptime: 0 }), { status: 200 });
    },
  });

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
  });

  const port = await server.listen();
  await healthPoller.runPollCycle();

  try
  {
    await run({ port, healthPoller });
  }
  finally
  {
    healthPoller.stop();
    await server.close();
  }
}

test("GET /api/services returns merged registry and heartbeat state", async () =>
{
  await withTestServer(async ({ port }) =>
  {
    const response = await requestJson(port, "GET", "/api/services");
    assert.equal(response.status, 200);

    const services = response.body as Array<Record<string, unknown>>;
    assert.equal(services.length, 2);

    const alpha = services.find((service) => service.name === "alpha");
    assert.ok(alpha);
    assert.equal(alpha.host, "0.0.0.0");
    assert.equal(alpha.port, 9101);
    assert.equal(alpha.command, "echo alpha");
    assert.equal(alpha.healthy, true);
    assert.equal(alpha.uptime, 11);
    assert.equal(alpha.warning, "alpha warn");
    assert.equal(alpha.home_url, undefined);

    const beta = services.find((service) => service.name === "beta");
    assert.ok(beta);
    assert.equal(beta.home_path, "/beta");
    assert.equal(beta.home_url, "http://127.0.0.1:9102/beta");
    assert.equal(beta.healthy, false);
  });
});

test("GET /api/services/{service_name} returns one merged service", async () =>
{
  await withTestServer(async ({ port }) =>
  {
    const response = await requestJson(port, "GET", "/api/services/beta");
    assert.equal(response.status, 200);

    const service = response.body as Record<string, unknown>;
    assert.equal(service.name, "beta");
    assert.equal(service.home_url, "http://127.0.0.1:9102/beta");
    assert.equal(service.healthy, false);
  });
});

test("GET /api/services/{service_name}/health returns heartbeat-only data", async () =>
{
  await withTestServer(async ({ port }) =>
  {
    const response = await requestJson(port, "GET", "/api/services/alpha/health");
    assert.equal(response.status, 200);

    const health = response.body as Record<string, unknown>;
    assert.deepEqual(Object.keys(health).sort(), [
      "healthy",
      "last_checked_at",
      "last_error",
      "name",
      "uptime",
      "warning",
    ]);
    assert.equal(health.name, "alpha");
    assert.equal(health.healthy, true);
    assert.equal(health.uptime, 11);
    assert.equal(health.warning, "alpha warn");
    assert.ok(health.last_checked_at);
    assert.equal(health.last_error, null);
  });
});

test("unknown service routes return 404", async () =>
{
  await withTestServer(async ({ port }) =>
  {
    const detail = await requestJson(port, "GET", "/api/services/missing");
    assert.equal(detail.status, 404);

    const health = await requestJson(port, "GET", "/api/services/missing/health");
    assert.equal(health.status, 404);
  });
});

test("unknown routes return JSON 404", async () =>
{
  await withTestServer(async ({ port }) =>
  {
    const response = await requestJson(port, "GET", "/api/unknown");
    assert.equal(response.status, 404);
    assert.deepEqual(response.body, { error: "not found" });
  });
});
