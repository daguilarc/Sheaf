import { createServer, type Server } from "node:http";
import type { IncomingMessage, ServerResponse } from "node:http";

import { createXagentMcpHandler, type XagentMcpHandler } from "./mcp.js";
import {
  x_ServiceHeadersTimeoutMs,
  x_ServiceRequestTimeoutMs,
  XAGENT_DEFAULT_BIND_PORT,
} from "./config.js";
import type { XagentRunManager } from "./run_manager.js";

export type XagentShutdownController = {
  requestShutdown(): Promise<void>;
  wasShutdownRequested(): boolean;
};

export function createShutdownController(deps: {
  closeRuns: () => Promise<void>;
  closeServer: () => Promise<void>;
  onShutdownComplete?: () => void;
}): XagentShutdownController {
  let requested = false;
  let pending: Promise<void> | undefined;
  return {
    requestShutdown(): Promise<void> {
      if (pending !== undefined) {
        return pending;
      }
      requested = true;
      // Close the listener first so Conductor can rebind the port while
      // stubborn child process groups are still being cleaned up.
      //
      pending = (async () => {
        try {
          await deps.closeServer();
        } finally {
          try {
            await deps.closeRuns();
          } finally {
            deps.onShutdownComplete?.();
          }
        }
      })();
      return pending;
    },
    wasShutdownRequested(): boolean {
      return requested;
    },
  };
}

export type XagentServerOptions = {
  readonly bindHost: string;
  readonly bindPort: number;
  readonly runManager: XagentRunManager;
  readonly shutdownController: XagentShutdownController;
  readonly serverStartTime?: number;
  readonly warning?: string;
  readonly mcpHandler?: XagentMcpHandler;
};

export type XagentServer = {
  readonly httpServer: Server;
  listen(): Promise<number>;
  close(): Promise<void>;
};

export function createXagentServer(options: XagentServerOptions): XagentServer {
  const serverStartTime = options.serverStartTime ?? Date.now();
  let acceptingConnections = true;
  // DNS rebinding protection allow lists. The shipped production port
  // (9005) is always allowed so a service that rebinds to that port
  // before `listen()` resolves is still reachable; the actual ephemeral
  // listen port is added once `listen()` returns. Both the MCP handler
  // and the `/health` and `/exit` routes consult these lists.
  //
  const allowedHosts = new Set<string>(buildAllowedHosts(options.bindHost, XAGENT_DEFAULT_BIND_PORT));
  const allowedOrigins = new Set<string>(buildAllowedOrigins(options.bindHost, XAGENT_DEFAULT_BIND_PORT));
  const mcpHandler =
    options.mcpHandler
    ?? createXagentMcpHandler({
      runManager: options.runManager,
      getAllowedHosts: () => [...allowedHosts],
      getAllowedOrigins: () => [...allowedOrigins],
    });

  const httpServer = createServer((request: IncomingMessage, response: ServerResponse) => {
    if (!acceptingConnections) {
      sendJson(response, 404, { error: "not found" });
      return;
    }
    void handleRequest(request, response);
  });
  httpServer.requestTimeout = x_ServiceRequestTimeoutMs;
  httpServer.timeout = x_ServiceRequestTimeoutMs;
  httpServer.headersTimeout = x_ServiceHeadersTimeoutMs;
  httpServer.keepAliveTimeout = x_ServiceRequestTimeoutMs;

  async function handleRequest(
    request: IncomingMessage,
    response: ServerResponse,
  ): Promise<void> {
    const hostHeader = request.headers.host;
    if (typeof hostHeader === "string" && !allowedHosts.has(hostHeader)) {
      sendJson(response, 403, { error: "invalid_host" });
      return;
    }
    const originHeader = request.headers.origin;
    if (typeof originHeader === "string" && !allowedOrigins.has(originHeader)) {
      sendJson(response, 403, { error: "invalid_origin" });
      return;
    }

    const url = new URL(request.url ?? "/", `http://${hostHeader ?? "localhost"}`);
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

    if (url.pathname === "/mcp") {
      await mcpHandler.handleRequest(request, response);
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
          // Populate the allow lists with the actual listen port so requests
          // to the ephemeral bind port (port 0) are accepted alongside the
          // shipped production port.
          //
          for (const host of buildAllowedHosts(options.bindHost, address.port)) {
            allowedHosts.add(host);
          }
          for (const origin of buildAllowedOrigins(options.bindHost, address.port)) {
            allowedOrigins.add(origin);
          }
          resolve(address.port);
        });
      });
    },
    close(): Promise<void> {
      acceptingConnections = false;
      // Release the listening handle and transport resources without waiting
      // for in-flight HTTP connections to drain. With enableJsonResponse, a
      // pending xagent_await POST never settles after transport.close() —
      // the SDK only deletes its stream mapping and never calls resolveJson —
      // so the httpServer.close() drain callback would never fire and the
      // shutdown controller's closeRuns() would be gated forever, orphaning
      // owned provider process groups. The listening handle itself is
      // released synchronously inside httpServer.close(), so Conductor can
      // rebind the port immediately while stubborn children are still being
      // cleaned up.
      //
      return new Promise((resolve) => {
        void mcpHandler.close().finally(() => {
          try {
            httpServer.close(() => {
              // Drain completion is intentionally ignored; see comment above.
              //
            });
          } catch {
            // Listener already closed or never started.
            //
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

// The loopback host names that may legitimately appear in the Host or Origin
// header of a request to this service. The shipped bind host is always
// included so a service bound to `::1` accepts `[::1]:port` as well.
//
function loopbackHostNames(bindHost: string): readonly string[] {
  const hosts = new Set<string>(["127.0.0.1", "localhost"]);
  hosts.add(bindHost);
  return [...hosts];
}

function formatHostHeader(host: string, port: number): string {
  // IPv6 literal addresses require brackets in the Host header.
  if (host.includes(":")) {
    return `[${host}]:${port}`;
  }
  return `${host}:${port}`;
}

function buildAllowedHosts(bindHost: string, port: number): string[] {
  const result = new Set<string>();
  for (const host of loopbackHostNames(bindHost)) {
    result.add(formatHostHeader(host, port));
  }
  return [...result];
}

function buildAllowedOrigins(bindHost: string, port: number): string[] {
  return buildAllowedHosts(bindHost, port).map((host) => `http://${host}`);
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
