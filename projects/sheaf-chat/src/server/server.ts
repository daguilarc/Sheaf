import { readFile } from "node:fs/promises";
import { createServer, type Server } from "node:http";
import type { IncomingMessage, ServerResponse } from "node:http";

import type { WebSocketServer } from "ws";

import type { AgentManager } from "../agents/manager.js";
import {
  AgentReviewService,
  HandleAgentReviewUpgrade,
} from "./agentReview/service.js";
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
  BuildVendorAssetAllowlist,
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
  scheduleShutdown?: (shutdown: () => void) => void;
  onShutdownComplete?: () => void | Promise<void>;
}

export interface SheafChatServer
{
  httpServer: Server;
  chatWebSocketServer: WebSocketServer;
  agentReviewWebSocketServer: WebSocketServer;
  agentReviewService: AgentReviewService;
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

function ScheduleShutdown(shutdown: () => void): void
{
  setImmediate(shutdown);
}

async function HandleStaticRequest(
  config: SheafChatConfig,
  pathname: string,
  response: ServerResponse,
): Promise<void>
{
  const staticRoots = BuildSheafChatStaticRoots(config.repoRoot);
  const vendorAllowlist = BuildVendorAssetAllowlist(config.repoRoot);

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

  const staticFile = await ReadStaticFile(pathname, staticRoots, vendorAllowlist);

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
  const scheduleShutdown = options.scheduleShutdown ?? ScheduleShutdown;
  const agentReviewService = new AgentReviewService({
    config: options.config,
    agentManager: options.agentManager,
  });
  const routeContext: RouteContext = {
    config: options.config,
    agentManager: options.agentManager,
    agentReviewService,
  };
  const persistenceHubRegistry = new SessionPersistenceHubRegistry();
  const broadcasterRegistry = new SessionBroadcasterRegistry();
  options.agentManager.SetNotifyFileChanged((event) =>
  {
    void broadcasterRegistry.BroadcastFileChanged(event);
    void agentReviewService.NotifyFileChanged(event);
  });
  const chatWebSocketServer = CreateChatWebSocketServer();
  const agentReviewWebSocketServer = agentReviewService.CreateWebSocketServer();
  const chatWebSocketContext = {
    config: options.config,
    agentManager: options.agentManager,
    persistenceHubRegistry,
    broadcasterRegistry,
  };
  let shutdownRequested = false;
  let shutdownScheduled = false;
  let closePromise: Promise<void> | null = null;

  const closeResources = (): Promise<void> =>
  {
    if (closePromise !== null)
    {
      return closePromise;
    }

    closePromise = new Promise<void>((resolve, reject) =>
    {
      broadcasterRegistry.Dispose();
      persistenceHubRegistry.Dispose();

      // Drain Agent Review sessions (in-flight git/RPC work) before tearing
      // down the WebSocket and HTTP servers, so no async work outlives close.
      void agentReviewService.Dispose().then(() =>
      {
        chatWebSocketServer.close(() =>
        {
          agentReviewWebSocketServer.close(() =>
          {
            if (!httpServer.listening)
            {
              resolve();
              return;
            }

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
        });
      }).catch(reject);
    });

    return closePromise;
  };

  const scheduleExitShutdown = (): void =>
  {
    if (shutdownScheduled)
    {
      return;
    }

    shutdownScheduled = true;
    scheduleShutdown(() =>
    {
      void closeResources().then(() => options.onShutdownComplete?.()).catch((error: unknown) =>
      {
        console.error(error);
        process.exitCode = 1;
      });
    });
  };

  const httpServer = createServer((request: IncomingMessage, response: ServerResponse) =>
  {
    void (async () =>
    {
      const url = new URL(request.url ?? "/", `http://${request.headers.host ?? "localhost"}`);

      if (url.pathname === "/exit")
      {
        if (request.method !== "POST")
        {
          SendJson(response, 405, FormatRestError("method_not_allowed", "method not allowed"));
          return;
        }

        shutdownRequested = true;
        response.once("finish", scheduleExitShutdown);
        SendJson(response, 200, { exiting: true });
        return;
      }

      if (shutdownRequested)
      {
        HandleNotFound(response);
        return;
      }

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
        if (shutdownRequested)
        {
          rejectUpgradeWithHttpStatus(socket, 404, "not found");
          return;
        }

        if (
          await HandleAgentReviewUpgrade(
            agentReviewService,
            agentReviewWebSocketServer,
            request,
            socket,
            head,
          )
        )
        {
          return;
        }

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
    agentReviewWebSocketServer,
    agentReviewService,
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
      closeResources(),
  };
}
