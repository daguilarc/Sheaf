import { createServer, type Server } from "node:http";
import type { IncomingMessage, ServerResponse } from "node:http";

import { FormatRestError } from "../shared/errors.js";
import type { SheafChatConfig } from "./config.js";

export const x_serviceName = "sheaf-chat";
export const x_serviceVersion = "0.1.0";

export interface SheafChatServerOptions
{
  config: SheafChatConfig;
  bindHost: string;
  bindPort: number;
}

export interface SheafChatServer
{
  httpServer: Server;
  listen: () => Promise<number>;
  close: () => Promise<void>;
}

function SendJson(response: ServerResponse, statusCode: number, body: unknown): void
{
  const payload = JSON.stringify(body);
  response.writeHead(statusCode, {
    "content-type": "application/json; charset=utf-8",
    "content-length": Buffer.byteLength(payload),
  });
  response.end(payload);
}

function HandleHealth(response: ServerResponse): void
{
  SendJson(response, 200, {
    service: x_serviceName,
    version: x_serviceVersion,
    status: "ok",
  });
}

function HandleNotFound(response: ServerResponse): void
{
  SendJson(response, 404, FormatRestError("not_found", "route not found"));
}

export function CreateSheafChatServer(options: SheafChatServerOptions): SheafChatServer
{
  const httpServer = createServer((request: IncomingMessage, response: ServerResponse) =>
  {
    const url = new URL(request.url ?? "/", `http://${request.headers.host ?? "localhost"}`);

    if (request.method === "GET" && url.pathname === "/api/health")
    {
      HandleHealth(response);
      return;
    }

    HandleNotFound(response);
  });

  return {
    httpServer,
    listen: () =>
      new Promise<number>((resolve, reject) =>
      {
        httpServer.once("error", reject);
        httpServer.listen(options.bindPort, options.bindHost, () =>
        {
          httpServer.off("error", reject);
          const address = httpServer.address();

          if (address === null || typeof address === "string")
          {
            resolve(options.bindPort);
            return;
          }

          resolve(address.port);
        });
      }),
    close: () =>
      new Promise<void>((resolve, reject) =>
      {
        httpServer.close((error) =>
        {
          if (error)
          {
            reject(error);
            return;
          }

          resolve();
        });
      }),
  };
}
