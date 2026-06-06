import assert from "node:assert/strict";
import { createConnection } from "node:net";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import WebSocket from "ws";

import {
  HealthPoller,
  createConductorServer,
  createShutdownController,
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

type ServerMessage = Record<string, unknown>;

async function withWebSocketServer(
  repoRoot: string,
  run: (context: { port: number }) => Promise<void>,
  options?: { followPollIntervalMs?: number },
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
    logStreamFollowPollIntervalMs: options?.followPollIntervalMs ?? 20,
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

function connectWebSocket(port: number, serviceName: string): Promise<WebSocket>
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

async function withWebSocketConnection(
  port: number,
  serviceName: string,
  run: (webSocket: WebSocket) => Promise<void>,
): Promise<void>
{
  const webSocket = await connectWebSocket(port, serviceName);

  try
  {
    await run(webSocket);
  }
  finally
  {
    webSocket.close();
  }
}

async function waitForMessage(
  webSocket: WebSocket,
  predicate: (message: ServerMessage) => boolean,
  timeoutMs = 2000,
): Promise<ServerMessage>
{
  return new Promise((resolve, reject) =>
  {
    const timeout = setTimeout(() =>
    {
      webSocket.off("message", onMessage);
      reject(new Error("timed out waiting for websocket message"));
    }, timeoutMs);

    const onMessage = (data: WebSocket.RawData): void =>
    {
      const message = JSON.parse(data.toString()) as ServerMessage;

      if (predicate(message))
      {
        clearTimeout(timeout);
        webSocket.off("message", onMessage);
        resolve(message);
      }
    };

    webSocket.on("message", onMessage);
  });
}

async function readUpgradeResponse(
  port: number,
  serviceName: string,
): Promise<string>
{
  return new Promise((resolve, reject) =>
  {
    const socket = createConnection({ host: "127.0.0.1", port }, () =>
    {
      socket.write(
        `GET /api/services/${serviceName}/logs/stream HTTP/1.1\r\n`
        + "Host: 127.0.0.1\r\n"
        + "Upgrade: websocket\r\n"
        + "Connection: Upgrade\r\n"
        + "Sec-WebSocket-Key: dGhlIHNhbXBsZSBub25jZQ==\r\n"
        + "Sec-WebSocket-Version: 13\r\n"
        + "\r\n",
      );
    });

    let response = "";

    socket.on("data", (chunk) =>
    {
      response += chunk.toString();
      socket.destroy();
      resolve(response);
    });

    socket.on("error", reject);
  });
}

test("websocket open returns one bounded chunk", async () =>
{
  const tempRoot = await mkdtemp(join(tmpdir(), "conductor-ws-open-"));

  try
  {
    const logRoot = join(tempRoot, "logs", "alpha");
    await mkdir(logRoot, { recursive: true });
    await writeFile(join(logRoot, "server.log"), "x".repeat(100));

    await withWebSocketServer(tempRoot, async ({ port }) =>
    {
      await withWebSocketConnection(port, "alpha", async (webSocket) =>
      {
        webSocket.send(JSON.stringify({ type: "open", file: "server.log", tail_bytes: 20 }));

        const message = await waitForMessage(webSocket, (entry) => entry.type === "chunk");
        assert.equal(message.type, "chunk");
        assert.equal(message.file, "server.log");
        assert.equal(message.start, 80);
        assert.equal(message.end, 100);
      });
    });
  }
  finally
  {
    await rm(tempRoot, { recursive: true, force: true });
  }
});

test("websocket open does not send the entire file for small tail_bytes", async () =>
{
  const tempRoot = await mkdtemp(join(tmpdir(), "conductor-ws-tail-"));

  try
  {
    const logRoot = join(tempRoot, "logs", "alpha");
    await mkdir(logRoot, { recursive: true });
    await writeFile(join(logRoot, "server.log"), "x".repeat(500));

    await withWebSocketServer(tempRoot, async ({ port }) =>
    {
      await withWebSocketConnection(port, "alpha", async (webSocket) =>
      {
        webSocket.send(JSON.stringify({ type: "open", file: "server.log", tail_bytes: 50 }));

        const message = await waitForMessage(webSocket, (entry) => entry.type === "chunk");
        assert.equal(message.start, 450);
        assert.equal(message.end, 500);
        assert.equal((message.text as string).length, 50);
      });
    });
  }
  finally
  {
    await rm(tempRoot, { recursive: true, force: true });
  }
});

test("websocket read_before returns chunk with correct offsets", async () =>
{
  const tempRoot = await mkdtemp(join(tmpdir(), "conductor-ws-before-"));

  try
  {
    const logRoot = join(tempRoot, "logs", "alpha");
    await mkdir(logRoot, { recursive: true });
    await writeFile(join(logRoot, "server.log"), "0123456789");

    await withWebSocketServer(tempRoot, async ({ port }) =>
    {
      await withWebSocketConnection(port, "alpha", async (webSocket) =>
      {
        webSocket.send(JSON.stringify({ type: "open", file: "server.log", tail_bytes: 4 }));
        await waitForMessage(webSocket, (entry) => entry.type === "chunk");

        webSocket.send(JSON.stringify({ type: "read_before", before: 7, max_bytes: 3 }));
        const message = await waitForMessage(
          webSocket,
          (entry) => entry.type === "chunk" && entry.start === 4,
        );

        assert.equal(message.end, 7);
        assert.equal(message.text, "456");
      });
    });
  }
  finally
  {
    await rm(tempRoot, { recursive: true, force: true });
  }
});

test("websocket follow delivers appended data when enabled", async () =>
{
  const tempRoot = await mkdtemp(join(tmpdir(), "conductor-ws-follow-"));

  try
  {
    const logRoot = join(tempRoot, "logs", "alpha");
    await mkdir(logRoot, { recursive: true });
    const filePath = join(logRoot, "server.log");
    await writeFile(filePath, "start");

    await withWebSocketServer(tempRoot, async ({ port }) =>
    {
      await withWebSocketConnection(port, "alpha", async (webSocket) =>
      {
        const appendPromise = waitForMessage(webSocket, (entry) => entry.type === "append");

        webSocket.send(JSON.stringify({ type: "open", file: "server.log", tail_bytes: 10 }));
        await waitForMessage(webSocket, (entry) => entry.type === "chunk");

        webSocket.send(JSON.stringify({ type: "follow", enabled: true }));
        await writeFile(filePath, " more", { flag: "a" });

        const message = await appendPromise;
        assert.equal(message.text, " more");
      });
    });
  }
  finally
  {
    await rm(tempRoot, { recursive: true, force: true });
  }
});

test("websocket follow does not deliver appended data when disabled", async () =>
{
  const tempRoot = await mkdtemp(join(tmpdir(), "conductor-ws-no-follow-"));

  try
  {
    const logRoot = join(tempRoot, "logs", "alpha");
    await mkdir(logRoot, { recursive: true });
    const filePath = join(logRoot, "server.log");
    await writeFile(filePath, "start");

    await withWebSocketServer(tempRoot, async ({ port }) =>
    {
      await withWebSocketConnection(port, "alpha", async (webSocket) =>
      {
        webSocket.send(JSON.stringify({ type: "open", file: "server.log", tail_bytes: 10 }));
        await waitForMessage(webSocket, (entry) => entry.type === "chunk");

        await writeFile(filePath, " more", { flag: "a" });
        await new Promise((resolve) => setTimeout(resolve, 80));
      });
    });
  }
  finally
  {
    await rm(tempRoot, { recursive: true, force: true });
  }
});

test("websocket malformed and unknown messages return error", async () =>
{
  const tempRoot = await mkdtemp(join(tmpdir(), "conductor-ws-errors-"));

  try
  {
    const logRoot = join(tempRoot, "logs", "alpha");
    await mkdir(logRoot, { recursive: true });
    await writeFile(join(logRoot, "server.log"), "hello");

    await withWebSocketServer(tempRoot, async ({ port }) =>
    {
      await withWebSocketConnection(port, "alpha", async (webSocket) =>
      {
        webSocket.send("{ not json");
        const malformed = await waitForMessage(webSocket, (entry) => entry.type === "error");
        assert.match(malformed.message as string, /malformed JSON/i);

        webSocket.send(JSON.stringify({ type: "nope" }));
        const unknown = await waitForMessage(
          webSocket,
          (entry) => entry.type === "error" && /unknown message type/i.test(entry.message as string),
        );
        assert.ok(unknown);
      });
    });
  }
  finally
  {
    await rm(tempRoot, { recursive: true, force: true });
  }
});

test("websocket truncation returns clear error and allows reopen", async () =>
{
  const tempRoot = await mkdtemp(join(tmpdir(), "conductor-ws-truncate-"));

  try
  {
    const logRoot = join(tempRoot, "logs", "alpha");
    await mkdir(logRoot, { recursive: true });
    const filePath = join(logRoot, "server.log");
    await writeFile(filePath, "0123456789");

    await withWebSocketServer(tempRoot, async ({ port }) =>
    {
      await withWebSocketConnection(port, "alpha", async (webSocket) =>
      {
        webSocket.send(JSON.stringify({ type: "open", file: "server.log", tail_bytes: 4 }));
        await waitForMessage(webSocket, (entry) => entry.type === "chunk");

        const truncationPromise = waitForMessage(
          webSocket,
          (entry) => entry.type === "error" && /truncated or rotated/i.test(entry.message as string),
        );

        webSocket.send(JSON.stringify({ type: "follow", enabled: true }));
        await writeFile(filePath, "short", { flag: "w" });

        const truncation = await truncationPromise;
        assert.ok(truncation);

        webSocket.send(JSON.stringify({ type: "open", file: "server.log", tail_bytes: 10 }));
        const reopened = await waitForMessage(webSocket, (entry) => entry.type === "chunk");
        assert.equal(reopened.text, "short");
      });
    });
  }
  finally
  {
    await rm(tempRoot, { recursive: true, force: true });
  }
});

test("websocket rejects unknown services and unsafe file paths", async () =>
{
  const tempRoot = await mkdtemp(join(tmpdir(), "conductor-ws-reject-"));

  try
  {
    const logRoot = join(tempRoot, "logs", "alpha");
    await mkdir(logRoot, { recursive: true });
    await writeFile(join(logRoot, "server.log"), "hello");

    await withWebSocketServer(tempRoot, async ({ port }) =>
    {
      const unknownServiceResponse = await readUpgradeResponse(port, "missing");
      assert.match(unknownServiceResponse, /404 Not Found/);

      await withWebSocketConnection(port, "alpha", async (webSocket) =>
      {
        webSocket.send(JSON.stringify({ type: "open", file: "../beta/server.log" }));

        const unsafe = await waitForMessage(webSocket, (entry) => entry.type === "error");
        assert.match(unsafe.message as string, /invalid log file path/i);
      });
    });
  }
  finally
  {
    await rm(tempRoot, { recursive: true, force: true });
  }
});
