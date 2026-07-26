import { createServer, type Server } from "node:http";
import type { IncomingMessage, ServerResponse } from "node:http";

import type { XagentRunManager } from "./run_manager.js";

export type XagentShutdownController = {
  requestShutdown(): Promise<void>;
  wasShutdownRequested(): boolean;
};

export type XagentServerOptions = {
  readonly bindHost: string;
  readonly bindPort: number;
  readonly runManager: XagentRunManager;
  readonly shutdownController: XagentShutdownController;
  readonly serverStartTime?: number;
  readonly warning?: string;
};

export type XagentServer = {
  readonly httpServer: Server;
  listen(): Promise<number>;
  close(): Promise<void>;
};

export function createXagentServer(options: XagentServerOptions): XagentServer {
  const serverStartTime = options.serverStartTime ?? Date.now();
  let acceptingConnections = true;

  const httpServer = createServer((request: IncomingMessage, response: ServerResponse) => {
    if (!acceptingConnections) {
      sendJson(response, 404, { error: "not found" });
      return;
    }
    void handleRequest(request, response);
  });

  async function handleRequest(
    request: IncomingMessage,
    response: ServerResponse,
  ): Promise<void> {
    const url = new URL(request.url ?? "/", `http://${request.headers.host ?? "localhost"}`);
    const method = request.method ?? "GET";

    if (method === "GET" && url.pathname === "/health") {
      const body: Record<string, unknown> = {
        healthy: true,
        uptime: computeUptimeSeconds(serverStartTime),
      };
      if (options.warning !== undefined) {
        body.warning = options.warning;
      }
      sendJson(response, 200, body);
      return;
    }

    if (method === "POST" && url.pathname === "/exit") {
      sendJsonAfterFlush(response, 200, { exiting: true }, () => {
        acceptingConnections = false;
        void options.shutdownController.requestShutdown();
      });
      return;
    }

    sendJson(response, 404, { error: "not found" });
  }

  return {
    httpServer,
    listen(): Promise<number> {
      return new Promise((resolve, reject) => {
        httpServer.once("error", reject);
        httpServer.listen(options.bindPort, options.bindHost, () => {
          httpServer.removeListener("error", reject);
          const address = httpServer.address();
          if (address === null || typeof address === "string") {
            reject(new Error("server address unavailable"));
            return;
          }
          resolve(address.port);
        });
      });
    },
    close(): Promise<void> {
      acceptingConnections = false;
      return new Promise((resolve, reject) => {
        httpServer.close((error) => {
          if (error && (error as NodeJS.ErrnoException).code === "ERR_SERVER_NOT_RUNNING") {
            resolve();
            return;
          }
          if (error) {
            reject(error);
            return;
          }
          resolve();
        });
      });
    },
  };
}

function computeUptimeSeconds(serverStartTime: number): number {
  return Math.max(0, (Date.now() - serverStartTime) / 1000);
}

function sendJson(
  response: ServerResponse,
  statusCode: number,
  body: unknown,
): void {
  const payload = JSON.stringify(body);
  response.statusCode = statusCode;
  response.setHeader("Content-Type", "application/json; charset=utf-8");
  response.setHeader("Content-Length", Buffer.byteLength(payload));
  response.end(payload);
}

function sendJsonAfterFlush(
  response: ServerResponse,
  statusCode: number,
  body: unknown,
  onFlushed: () => void | Promise<void>,
): void {
  const payload = JSON.stringify(body);
  response.statusCode = statusCode;
  response.setHeader("Content-Type", "application/json; charset=utf-8");
  response.setHeader("Content-Length", Buffer.byteLength(payload));
  response.end(payload, () => {
    void Promise.resolve(onFlushed());
  });
}
