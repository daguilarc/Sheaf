import assert from "node:assert/strict";
import { mkdir, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import test from "node:test";
import WebSocket from "ws";

import {
  HealthPoller,
  createConductorServer,
  createRepoPaths,
  createShutdownController,
  x_LogsJsAssetPath,
  x_MainJsAssetPath,
  x_SharedCssAssetPath,
  type ServiceDefinition,
} from "../src/index.js";

const testServices: ServiceDefinition[] = [
  {
    name: "alpha",
    host: "0.0.0.0",
    port: 9101,
    command: "echo alpha",
    home_path: "/alpha",
  },
  {
    name: "emptylogs",
    host: "127.0.0.1",
    port: 9102,
    command: "echo empty",
  },
];

async function requestText(
  port: number,
  method: string,
  path: string,
): Promise<{ status: number; contentType: string | null; body: string }>
{
  const response = await fetch(`http://127.0.0.1:${port}${path}`, { method });
  const body = await response.text();

  return {
    status: response.status,
    contentType: response.headers.get("content-type"),
    body,
  };
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

async function withUiServer(
  repoRoot: string,
  run: (context: { port: number }) => Promise<void>,
): Promise<void>
{
  const healthPoller = new HealthPoller({
    services: testServices,
    fetchFn: async (input) =>
    {
      const url = String(input);

      if (url.includes(":9101/health"))
      {
        return new Response(JSON.stringify({ healthy: true, uptime: 42, warning: "check" }), {
          status: 200,
        });
      }

      return new Response(JSON.stringify({ healthy: true, uptime: 1 }), { status: 200 });
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
    repoRoot,
  });

  const port = await server.listen();
  await healthPoller.runPollCycle();

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

test("GET / serves the main UI and static assets", async () =>
{
  const paths = createRepoPaths();

  await withUiServer(paths.repoRoot, async ({ port }) =>
  {
    const mainPage = await requestText(port, "GET", "/");
    assert.equal(mainPage.status, 200);
    assert.match(mainPage.contentType ?? "", /text\/html/);
    assert.match(mainPage.body, new RegExp(x_SharedCssAssetPath));
    assert.match(mainPage.body, new RegExp(x_MainJsAssetPath));

    const css = await requestText(port, "GET", x_SharedCssAssetPath);
    assert.equal(css.status, 200);
    assert.match(css.contentType ?? "", /text\/css/);
    assert.match(css.body, /--sheaf-bg/);

    const mainJs = await requestText(port, "GET", x_MainJsAssetPath);
    assert.equal(mainJs.status, 200);
    assert.match(mainJs.contentType ?? "", /javascript/);
    assert.match(mainJs.body, /loadServices/);
  });
});

test("GET /services/{service_name}/logs serves logs UI and streams via WebSocket", async () =>
{
  const paths = createRepoPaths();
  const logRoot = join(paths.repoRoot, "logs", "alpha");
  const logPath = join(logRoot, "ui-integration.log");
  await mkdir(logRoot, { recursive: true });
  await writeFile(logPath, "alpha log line\n", "utf8");

  try
  {
    await withUiServer(paths.repoRoot, async ({ port }) =>
    {
      const logsPage = await requestText(port, "GET", "/services/alpha/logs");
      assert.equal(logsPage.status, 200);
      assert.match(logsPage.body, new RegExp(x_LogsJsAssetPath));
      assert.doesNotMatch(logsPage.body, /ui-integration\.log/);

      const listing = await requestJson(port, "GET", "/api/services/alpha/logs");
      assert.equal(listing.status, 200);

      const files = (listing.body as { files: Array<{ path: string }> }).files;
      assert.ok(files.some((file) => file.path === "ui-integration.log"));

      const webSocket = await connectLogStream(port, "alpha");
      webSocket.send(JSON.stringify({
        type: "open",
        file: "ui-integration.log",
        tail_bytes: 65536,
      }));

      const chunk = await waitForMessage(webSocket, (message) => message.type === "chunk");
      webSocket.close();

      assert.match(String(chunk.text), /alpha log line/);
    });
  }
  finally
  {
    await rm(logPath, { force: true });
  }
});

test("logs UI no-logs state uses empty REST listing", async () =>
{
  const paths = createRepoPaths();
  const logRoot = join(paths.repoRoot, "logs", "emptylogs");
  await mkdir(logRoot, { recursive: true });

  await withUiServer(paths.repoRoot, async ({ port }) =>
  {
    const logsPage = await requestText(port, "GET", "/services/emptylogs/logs");
    assert.equal(logsPage.status, 200);
    assert.match(logsPage.body, /Loading log files/);

    const listing = await requestJson(port, "GET", "/api/services/emptylogs/logs");
    assert.equal(listing.status, 200);
    assert.deepEqual((listing.body as { files: unknown[] }).files, []);

    const logsJs = await requestText(port, "GET", x_LogsJsAssetPath);
    assert.match(logsJs.body, /No log files are available/);
  });
});

test("main UI service list and lifecycle endpoints integrate with REST APIs", async () =>
{
  const paths = createRepoPaths();

  await withUiServer(paths.repoRoot, async ({ port }) =>
  {
    const services = await requestJson(port, "GET", "/api/services");
    assert.equal(services.status, 200);

    const entries = services.body as Array<Record<string, unknown>>;
    const alpha = entries.find((entry) => entry.name === "alpha");
    assert.ok(alpha);
    assert.equal(alpha.healthy, true);
    assert.equal(alpha.uptime, 42);
    assert.equal(alpha.warning, "check");
    assert.equal(alpha.home_url, "http://0.0.0.0:9101/alpha");

    const start = await requestJson(port, "POST", "/api/services/alpha/start");
    assert.equal(start.status, 200);
    assert.equal((start.body as { action: string }).action, "start");

    const stop = await requestJson(port, "POST", "/api/services/alpha/stop");
    assert.equal(stop.status, 200);
    assert.equal((stop.body as { action: string }).action, "stop");

    const restart = await requestJson(port, "POST", "/api/services/alpha/restart");
    assert.equal(restart.status, 200);
    assert.equal((restart.body as { action: string }).action, "restart");
  });
});

test("unknown logs page service returns 404 JSON", async () =>
{
  const paths = createRepoPaths();

  await withUiServer(paths.repoRoot, async ({ port }) =>
  {
    const response = await requestJson(port, "GET", "/services/missing/logs");
    assert.equal(response.status, 404);
  });
});

type ServerMessage = Record<string, unknown>;

function connectLogStream(port: number, serviceName: string): Promise<WebSocket>
{
  return new Promise((resolve, reject) =>
  {
    const webSocket = new WebSocket(
      `ws://127.0.0.1:${port}/api/services/${serviceName}/logs/stream`,
    );

    webSocket.once("open", () => resolve(webSocket));
    webSocket.once("error", reject);
  });
}

function waitForMessage(
  webSocket: WebSocket,
  predicate: (message: ServerMessage) => boolean,
): Promise<ServerMessage>
{
  return new Promise((resolve, reject) =>
  {
    const onMessage = (data: WebSocket.RawData): void =>
    {
      const message = JSON.parse(data.toString()) as ServerMessage;

      if (predicate(message))
      {
        webSocket.off("message", onMessage);
        resolve(message);
      }
    };

    webSocket.on("message", onMessage);
    webSocket.once("error", reject);
  });
}
