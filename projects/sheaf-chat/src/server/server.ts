import { readFile } from "node:fs/promises";
import { createServer, type Server } from "node:http";
import type { IncomingMessage, ServerResponse } from "node:http";

import type { WebSocketServer } from "ws";

import type { AgentManager } from "../agents/manager.js";
import { SessionBroadcasterRegistry } from "../protocol/sessionBroadcaster.js";
import { SessionPersistenceHubRegistry } from "../protocol/sessionPersistenceHub.js";
import { StorageError } from "../storage/errors.js";
import { FormatRestError } from "../shared/errors.js";
import type { SheafChatConfig } from "./config.js";
import { x_serviceName, x_serviceVersion } from "./constants.js";
import { SendJson } from "./http.js";
import { DispatchApiRoute } from "./router.js";
import type { RouteContext } from "./routes/context.js";
import {
  BuildSheafChatStaticRoots,
  ReadStaticFile,
  ResolveSheafChatIndexPath,
  SendHtml,
  SendStaticResult,
} from "./static.js";
import {
  AttachChatWebSocketConnection,
  CreateChatWebSocketServer,
  rejectUpgradeWithHttpStatus,
  ResolveChatWebSocketUpgrade,
  StorageErrorToHttpStatus,
} from "./websocket.js";

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
  chatWebSocketServer: WebSocketServer;
  broadcasterRegistry: SessionBroadcasterRegistry;
  persistenceHubRegistry: SessionPersistenceHubRegistry;
  listen: () => Promise<number>;
  close: () => Promise<void>;
}

function HandleNotFound(response: ServerResponse): void
{
  SendJson(response, 404, FormatRestError("not_found", "route not found"));
}

function ComputeUptimeSeconds(serverStartTime: number): number
{
  return Math.max(0, (Date.now() - serverStartTime) / 1000);
}

async function HandleStaticRequest(
  config: SheafChatConfig,
  pathname: string,
  response: ServerResponse,
): Promise<void>
{
  const staticRoots = BuildSheafChatStaticRoots(config.repoRoot);

  if (pathname === "/" || pathname === "/index.html")
  {
    try
    {
      const html = await readFile(ResolveSheafChatIndexPath(config.repoRoot), "utf8");
      SendHtml(response, html);
    }
    catch
    {
      HandleNotFound(response);
    }
    return;
  }

  const staticFile = await ReadStaticFile(pathname, staticRoots);

  if (!staticFile)
  {
    HandleNotFound(response);
    return;
  }

  SendStaticResult(response, staticFile);
}

export function CreateSheafChatServer(options: SheafChatServerOptions): SheafChatServer
{
  const serverStartTime = Date.now();
  const routeContext: RouteContext = {
    config: options.config,
    agentManager: options.agentManager,
  };
  const persistenceHubRegistry = new SessionPersistenceHubRegistry();
  const broadcasterRegistry = new SessionBroadcasterRegistry();
  options.agentManager.SetNotifyFileChanged((event) =>
  {
    void broadcasterRegistry.BroadcastFileChanged(event);
  });
  const chatWebSocketServer = CreateChatWebSocketServer();
  const chatWebSocketContext = {
    config: options.config,
    agentManager: options.agentManager,
    persistenceHubRegistry,
    broadcasterRegistry,
  };

  const httpServer = createServer((request: IncomingMessage, response: ServerResponse) =>
  {
    void (async () =>
    {
      const url = new URL(request.url ?? "/", `http://${request.headers.host ?? "localhost"}`);

      if (url.pathname === "/health")
      {
        if (request.method !== "GET")
        {
          SendJson(response, 405, FormatRestError("method_not_allowed", "method not allowed"));
          return;
        }

        SendJson(response, 200, {
          healthy: true,
          uptime: ComputeUptimeSeconds(serverStartTime),
        });
        return;
      }

      if (url.pathname.startsWith("/api/"))
      {
        await DispatchApiRoute(routeContext, request, response, url);
        return;
      }

      await HandleStaticRequest(options.config, url.pathname, response);
    })();
  });

  httpServer.on("upgrade", (request, socket, head) =>
  {
    void (async () =>
    {
      try
      {
        const params = await ResolveChatWebSocketUpgrade(chatWebSocketContext, request);

        if (params === null)
        {
          socket.destroy();
          return;
        }

        chatWebSocketServer.handleUpgrade(request, socket, head, (webSocket) =>
        {
          chatWebSocketServer.emit("connection", webSocket, request);
          void AttachChatWebSocketConnection(webSocket, params, chatWebSocketContext);
        });
      }
      catch (error)
      {
        if (error instanceof StorageError)
        {
          const status = StorageErrorToHttpStatus(error);
          rejectUpgradeWithHttpStatus(socket, status, error.message);
          return;
        }

        rejectUpgradeWithHttpStatus(socket, 400, "bad request");
      }
    })();
  });

  return {
    httpServer,
    chatWebSocketServer,
    broadcasterRegistry,
    persistenceHubRegistry,
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
        broadcasterRegistry.Dispose();
        persistenceHubRegistry.Dispose();

        chatWebSocketServer.close(() =>
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
        });
      }),
  };
}
