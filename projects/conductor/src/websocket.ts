import type { IncomingMessage } from "node:http";
import type { Duplex } from "node:stream";

import { WebSocket, WebSocketServer } from "ws";

import { decodePathSegment, parseRequestPath } from "./http_json.js";
import { LogStreamSession } from "./log_stream.js";

export type LogStreamWebSocketOptions =
{
  services: Array<{ name: string }>;
  serviceLogRoot: (serviceName: string) => string;
  followPollIntervalMs?: number;
};

export type LogStreamWebSocketUpgrade =
{
  serviceName: string;
  logRoot: string;
} | null;

export function matchLogStreamUpgradePath(path: string): string | null
{
  const match = path.match(/^\/api\/services\/([^/]+)\/logs\/stream$/);

  if (!match)
  {
    return null;
  }

  return decodePathSegment(match[1]!);
}

export function resolveLogStreamUpgrade(
  request: IncomingMessage,
  options: LogStreamWebSocketOptions,
): LogStreamWebSocketUpgrade
{
  const path = parseRequestPath(request);
  const serviceName = matchLogStreamUpgradePath(path);

  if (!serviceName)
  {
    return null;
  }

  const service = options.services.find((entry) => entry.name === serviceName);

  if (!service)
  {
    return null;
  }

  return {
    serviceName,
    logRoot: options.serviceLogRoot(serviceName),
  };
}

export function rejectUpgradeWithHttpStatus(
  socket: Duplex,
  statusCode: number,
  statusText: string,
): void
{
  const body = `${statusText}\r\n`;
  socket.write(
    `HTTP/1.1 ${statusCode} ${statusText}\r\n`
    + `Content-Type: text/plain\r\n`
    + `Content-Length: ${Buffer.byteLength(body)}\r\n`
    + `Connection: close\r\n`
    + `\r\n`
    + body,
  );
  socket.destroy();
}

export function createLogStreamWebSocketServer(): WebSocketServer
{
  return new WebSocketServer({ noServer: true });
}

export function attachLogStreamConnection(
  webSocket: WebSocket,
  logRoot: string,
  followPollIntervalMs?: number,
): LogStreamSession
{
  const session = new LogStreamSession({
    logRoot,
    followPollIntervalMs,
    onMessage(message)
    {
      if (webSocket.readyState === WebSocket.OPEN)
      {
        webSocket.send(JSON.stringify(message));
      }
    },
  });

  webSocket.on("message", (data) =>
  {
    void handleClientMessage(session, data);
  });

  webSocket.on("close", () =>
  {
    session.Destroy();
  });

  return session;
}

async function handleClientMessage(
  session: LogStreamSession,
  data: WebSocket.RawData,
): Promise<void>
{
  let parsed: unknown;

  try
  {
    parsed = JSON.parse(data.toString());
  }
  catch
  {
    session.SendError("malformed JSON message");
    return;
  }

  if (typeof parsed !== "object" || parsed === null || !("type" in parsed))
  {
    session.SendError("unknown message type");
    return;
  }

  const message = parsed as Record<string, unknown>;
  const messageType = message.type;

  if (messageType === "open")
  {
    if (typeof message.file !== "string")
    {
      session.SendError("open requires a file path");
      return;
    }

    const tailBytes = message.tail_bytes;
    await session.HandleOpen(
      message.file,
      typeof tailBytes === "number" ? tailBytes : undefined,
    );
    return;
  }

  if (messageType === "read_before")
  {
    const before = message.before;

    if (typeof before !== "number")
    {
      session.SendError("read_before requires a before offset");
      return;
    }

    const maxBytes = message.max_bytes;
    await session.HandleReadBefore(
      before,
      typeof maxBytes === "number" ? maxBytes : undefined,
    );
    return;
  }

  if (messageType === "follow")
  {
    if (typeof message.enabled !== "boolean")
    {
      session.SendError("follow requires an enabled boolean");
      return;
    }

    session.HandleFollow(message.enabled);
    return;
  }

  session.SendError("unknown message type");
}
