import { createServer, type Server } from "node:http";
import type { IncomingMessage, ServerResponse } from "node:http";

import { HealthPoller } from "./health_poller.js";
import {
  decodePathSegment,
  parseRequestPath,
  sendJson,
  sendJsonAfterFlush,
} from "./http_json.js";
import { findServiceByName } from "./service_registry.js";
import {
  presentAllServices,
  presentService,
  presentServiceHealth,
} from "./service_presenter.js";
import type { ServiceDefinition } from "./service_definition.js";
import type { ShutdownController } from "./shutdown.js";

export type ConductorServerOptions =
{
  services: ServiceDefinition[];
  bindHost: string;
  bindPort: number;
  healthPoller: HealthPoller;
  shutdownController: ShutdownController;
  serverStartTime?: number;
  warning?: string;
};

export type ConductorServer =
{
  httpServer: Server;
  listen: () => Promise<number>;
  close: () => Promise<void>;
};

function computeUptimeSeconds(serverStartTime: number): number
{
  return (Date.now() - serverStartTime) / 1000;
}

function handleNotFound(response: ServerResponse): void
{
  sendJson(response, 404, { error: "not found" });
}

export function createConductorServer(options: ConductorServerOptions): ConductorServer
{
  const serverStartTime = options.serverStartTime ?? Date.now();
  let acceptingConnections = true;

  const httpServer = createServer((request: IncomingMessage, response: ServerResponse) =>
  {
    if (!acceptingConnections)
    {
      handleNotFound(response);
      return;
    }

    void handleRequest(request, response);
  });

  async function handleRequest(
    request: IncomingMessage,
    response: ServerResponse,
  ): Promise<void>
  {
    const path = parseRequestPath(request);

    if (request.method === "GET" && path === "/health")
    {
      const body: Record<string, unknown> =
      {
        healthy: true,
        uptime: computeUptimeSeconds(serverStartTime),
      };

      if (options.warning !== undefined)
      {
        body.warning = options.warning;
      }

      sendJson(response, 200, body);
      return;
    }

    if (request.method === "POST" && path === "/exit")
    {
      sendJsonAfterFlush(response, 200, { exiting: true }, () =>
      {
        acceptingConnections = false;
        void options.shutdownController.requestShutdown();
      });
      return;
    }

    if (request.method === "GET" && path === "/api/services")
    {
      const services = presentAllServices(
        options.services,
        (serviceName) => options.healthPoller.getHeartbeat(serviceName),
      );
      sendJson(response, 200, services);
      return;
    }

    const healthMatch = path.match(/^\/api\/services\/([^/]+)\/health$/);

    if (request.method === "GET" && healthMatch)
    {
      const serviceName = decodePathSegment(healthMatch[1]);
      const service = findServiceByName(options.services, serviceName);

      if (!service)
      {
        sendJson(response, 404, { error: "service not found" });
        return;
      }

      const heartbeat = options.healthPoller.getHeartbeat(serviceName);

      if (!heartbeat)
      {
        sendJson(response, 404, { error: "service not found" });
        return;
      }

      sendJson(response, 200, presentServiceHealth(serviceName, heartbeat));
      return;
    }

    const serviceMatch = path.match(/^\/api\/services\/([^/]+)$/);

    if (request.method === "GET" && serviceMatch)
    {
      const serviceName = decodePathSegment(serviceMatch[1]);
      const service = findServiceByName(options.services, serviceName);

      if (!service)
      {
        sendJson(response, 404, { error: "service not found" });
        return;
      }

      const heartbeat = options.healthPoller.getHeartbeat(serviceName);

      if (!heartbeat)
      {
        sendJson(response, 404, { error: "service not found" });
        return;
      }

      sendJson(response, 200, presentService(service, heartbeat));
      return;
    }

    handleNotFound(response);
  }

  return {
    httpServer,

    listen(): Promise<number>
    {
      return new Promise((resolve, reject) =>
      {
        httpServer.once("error", reject);
        httpServer.listen(options.bindPort, options.bindHost, () =>
        {
          httpServer.removeListener("error", reject);
          const address = httpServer.address();

          if (address === null || typeof address === "string")
          {
            reject(new Error("server address unavailable"));
            return;
          }

          resolve(address.port);
        });
      });
    },

    close(): Promise<void>
    {
      return new Promise((resolve, reject) =>
      {
        httpServer.close((error) =>
        {
          if (error && (error as NodeJS.ErrnoException).code === "ERR_SERVER_NOT_RUNNING")
          {
            resolve();
            return;
          }

          if (error)
          {
            reject(error);
            return;
          }

          resolve();
        });
      });
    },
  };
}

export function findConductorService(services: ServiceDefinition[]): ServiceDefinition
{
  const conductor = findServiceByName(services, "conductor");

  if (!conductor)
  {
    throw new Error("conductor service is not registered in config/services.json");
  }

  return conductor;
}
