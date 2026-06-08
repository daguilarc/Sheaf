import { createServer, type Server } from "node:http";
import type { IncomingMessage, ServerResponse } from "node:http";

import type { AgentManager } from "../agents/manager.js";
import { FormatRestError } from "../shared/errors.js";
import type { SheafChatConfig } from "./config.js";
import { x_serviceName, x_serviceVersion } from "./constants.js";
import { SendJson } from "./http.js";
import { DispatchApiRoute } from "./router.js";
import type { RouteContext } from "./routes/context.js";

export { x_serviceName, x_serviceVersion };

export interface SheafChatServerOptions
{
  config: SheafChatConfig;
  bindHost: string;
  bindPort: number;
  agentManager: AgentManager;
}

export interface SheafChatServer
{
  httpServer: Server;
  listen: () => Promise<number>;
  close: () => Promise<void>;
}

function HandleNotFound(response: ServerResponse): void
{
  SendJson(response, 404, FormatRestError("not_found", "route not found"));
}

export function CreateSheafChatServer(options: SheafChatServerOptions): SheafChatServer
{
  const routeContext: RouteContext = {
    config: options.config,
    agentManager: options.agentManager,
  };

  const httpServer = createServer((request: IncomingMessage, response: ServerResponse) =>
  {
    const url = new URL(request.url ?? "/", `http://${request.headers.host ?? "localhost"}`);

    if (url.pathname.startsWith("/api/"))
    {
      void DispatchApiRoute(routeContext, request, response, url);
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
