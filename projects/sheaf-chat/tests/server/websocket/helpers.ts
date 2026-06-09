import { mkdirSync } from "node:fs";
import path from "node:path";

import WebSocket from "ws";

import type { PiSessionHandle } from "../../../src/agents/piAdapter.js";
import { AgentManager } from "../../../src/agents/manager.js";
import type { SessionBroadcasterRegistry } from "../../../src/protocol/sessionBroadcaster.js";
import type { SessionPersistenceHubRegistry } from "../../../src/protocol/sessionPersistenceHub.js";
import type { ChatEnvelope } from "../../../src/shared/envelope.js";
import { CreateChatEnvelope } from "../../../src/shared/envelope.js";
import type { SheafChatConfig } from "../../../src/server/config.js";
import { BuildChatWebSocketUrl } from "../../../src/server/websockets.js";
import { CreateSheafChatServer } from "../../../src/server/server.js";
import { CreateStoragePaths } from "../../../src/storage/paths.js";
import { CreatePile } from "../../../src/storage/piles.js";
import {
  CreateFakeTimers,
  CreateTestConfigWithRoot,
  CreateTestModelBundle,
  FakePiSession,
} from "../../agents/lifecycle/helpers.js";
import { WithFakeRepoAsync } from "../../agents/modelRegistry/helpers.js";

export { CreateFakeTimers, WithFakeRepoAsync };

export interface WebSocketTestHandle
{
  baseUrl: string;
  wsBaseUrl: string;
  config: SheafChatConfig;
  agentManager: AgentManager;
  broadcasterRegistry: SessionBroadcasterRegistry;
  persistenceHubRegistry: SessionPersistenceHubRegistry;
  fakeSessions: Map<string, FakePiSession>;
  timers?: ReturnType<typeof CreateFakeTimers>;
  close: () => Promise<void>;
}

export async function StartWebSocketTestServer(
  repoRoot: string,
  options: {
    idleOffloadSeconds?: number;
    timers?: ReturnType<typeof CreateFakeTimers>;
  } = {},
): Promise<WebSocketTestHandle>
{
  mkdirSync(repoRoot, { recursive: true });
  mkdirSync(path.join(repoRoot, "projects", "demo"), { recursive: true });

  const config = CreateTestConfigWithRoot(repoRoot);
  const storagePaths = CreateStoragePaths(repoRoot);
  const modelBundle = CreateTestModelBundle();
  const fakeSessions = new Map<string, FakePiSession>();

  const agentManager = await AgentManager.Create({
    config,
    storagePaths,
    modelBundle,
    idleOffloadSeconds: options.idleOffloadSeconds ?? 1,
    setTimeoutFn: options.timers?.setTimeout,
    clearTimeoutFn: options.timers?.clearTimeout,
    createPiSession: async (input): Promise<PiSessionHandle> =>
    {
      const fake = new FakePiSession(
        path.basename(input.sessionFilePath, ".jsonl"),
        input.sessionFilePath,
        input.model,
      );
      fakeSessions.set(input.sessionFilePath, fake);
      return fake;
    },
  });

  const server = CreateSheafChatServer({
    config,
    bindHost: "127.0.0.1",
    bindPort: 0,
    agentManager,
  });
  const port = await server.listen();
  const baseUrl = `http://127.0.0.1:${port}`;
  const wsBaseUrl = `ws://127.0.0.1:${port}`;

  return {
    baseUrl,
    wsBaseUrl,
    config,
    agentManager,
    broadcasterRegistry: server.broadcasterRegistry,
    persistenceHubRegistry: server.persistenceHubRegistry,
    fakeSessions,
    timers: options.timers,
    close: async () =>
    {
      await server.close();
      await agentManager.dispose();
    },
  };
}

export async function WithWebSocketTestServer(
  callback: (handle: WebSocketTestHandle) => Promise<void>,
  options?: { idleOffloadSeconds?: number; timers?: ReturnType<typeof CreateFakeTimers> },
): Promise<void>
{
  await WithFakeRepoAsync(async (repoRoot) =>
  {
    const handle = await StartWebSocketTestServer(repoRoot, options);

    try
    {
      await callback(handle);
    }
    finally
    {
      await handle.close();
    }
  });
}

export function ResolveOpenAiTestModel(agentManager: AgentManager): { provider: string; id: string }
{
  const model = agentManager.listModels().find((entry) => entry.provider === "openai" && entry.available);
  if (model === undefined)
  {
    throw new Error("openai test model not found");
  }

  return {
    provider: model.provider,
    id: model.id,
  };
}

export async function CreateBlankSessionViaApi(
  handle: WebSocketTestHandle,
  pile = "default",
): Promise<{ pile: string; sessionId: string }>
{
  const storagePaths = CreateStoragePaths(handle.config.repoRoot);
  await CreatePile(storagePaths, pile);
  const model = ResolveOpenAiTestModel(handle.agentManager);
  const response = await fetch(`${handle.baseUrl}/api/piles/${pile}/sessions`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      rootDirectory: path.join(handle.config.repoRoot, "projects", "demo"),
      model,
    }),
  });

  if (!response.ok)
  {
    throw new Error(`create session failed: ${response.status}`);
  }

  const body = await response.json() as { sessionId: string };
  return {
    pile,
    sessionId: body.sessionId,
  };
}

export function BuildWsUrl(
  handle: WebSocketTestHandle,
  pile: string,
  sessionId: string,
  options: { clientId?: string; after?: number } = {},
): string
{
  const route = BuildChatWebSocketUrl({
    pile,
    sessionId,
    clientId: options.clientId,
    after: options.after,
  });

  return `${handle.wsBaseUrl}${route}`;
}

export interface ConnectedChatSocket
{
  socket: WebSocket;
  bootstrap: ChatEnvelope[];
}

export function ConnectWebSocket(url: string): Promise<ConnectedChatSocket>
{
  return new Promise((resolve, reject) =>
  {
    const bootstrap: ChatEnvelope[] = [];
    const socket = new WebSocket(url);

    const onMessage = (data: WebSocket.RawData) =>
    {
      try
      {
        const envelope = JSON.parse(data.toString()) as ChatEnvelope;
        bootstrap.push(envelope);

        if (envelope.kind === "server.caught_up")
        {
          socket.off("message", onMessage);
          resolve({ socket, bootstrap });
        }
      }
      catch
      {
        //
      }
    };

    socket.on("message", onMessage);
    socket.once("error", (error) =>
    {
      socket.off("message", onMessage);
      reject(error);
    });
  });
}

export async function WithWebSocket(
  url: string,
  callback: (socket: WebSocket, bootstrap: ChatEnvelope[]) => Promise<void>,
): Promise<void>
{
  const connected = await ConnectWebSocket(url);

  try
  {
    await new Promise((resolve) => setTimeout(resolve, 50));
    await callback(connected.socket, connected.bootstrap);
  }
  finally
  {
    connected.socket.close();
  }
}

export async function WaitForCondition(
  predicate: () => boolean,
  timeoutMs = 3000,
): Promise<void>
{
  const startedAt = Date.now();

  while (Date.now() - startedAt < timeoutMs)
  {
    if (predicate())
    {
      return;
    }

    await new Promise((resolve) => setTimeout(resolve, 10));
  }

  throw new Error("timed out waiting for condition");
}

export async function WaitForEnvelope(
  socket: WebSocket,
  predicate: (envelope: ChatEnvelope) => boolean,
  timeoutMs = 3000,
): Promise<ChatEnvelope>
{
  return new Promise((resolve, reject) =>
  {
    const timeout = setTimeout(() =>
    {
      cleanup();
      reject(new Error("timed out waiting for envelope"));
    }, timeoutMs);

    const onMessage = (data: WebSocket.RawData) =>
    {
      try
      {
        const envelope = JSON.parse(data.toString()) as ChatEnvelope;

        if (predicate(envelope))
        {
          cleanup();
          resolve(envelope);
        }
      }
      catch
      {
        //
      }
    };

    const cleanup = () =>
    {
      clearTimeout(timeout);
      socket.off("message", onMessage);
    };

    socket.on("message", onMessage);
  });
}

export async function DrainConnection(_socket: WebSocket, delayMs = 100): Promise<void>
{
  await new Promise((resolve) => setTimeout(resolve, delayMs));
}

export async function CollectEnvelopesUntil(
  socket: WebSocket,
  endKind: string,
  timeoutMs = 3000,
): Promise<ChatEnvelope[]>
{
  const envelopes: ChatEnvelope[] = [];

  await new Promise<void>((resolve, reject) =>
  {
    const timeout = setTimeout(() =>
    {
      cleanup();
      reject(new Error(`timed out waiting for ${endKind}`));
    }, timeoutMs);

    const onMessage = (data: WebSocket.RawData) =>
    {
      try
      {
        const envelope = JSON.parse(data.toString()) as ChatEnvelope;
        envelopes.push(envelope);

        if (envelope.kind === endKind)
        {
          cleanup();
          resolve();
        }
      }
      catch
      {
        //
      }
    };

    const cleanup = () =>
    {
      clearTimeout(timeout);
      socket.off("message", onMessage);
    };

    socket.on("message", onMessage);
  });

  return envelopes;
}

export function CreateClientEnvelope(
  kind: string,
  pile: string,
  sessionId: string,
  payload?: unknown,
  id?: string,
): ChatEnvelope
{
  return CreateChatEnvelope({
    kind,
    pile,
    sessionId,
    payload,
    id: id ?? `client-${kind}-${Date.now()}`,
  });
}

export function SendClientFrame(socket: WebSocket, envelope: ChatEnvelope): void
{
  socket.send(JSON.stringify(envelope));
}

export async function WaitForOpenOrReject(url: string): Promise<{ ok: true; socket: WebSocket } | { ok: false; status: number }>
{
  return new Promise((resolve) =>
  {
    const socket = new WebSocket(url);

    socket.once("open", () => resolve({ ok: true, socket }));
    socket.once("unexpected-response", (_request, response) =>
    {
      resolve({ ok: false, status: response.statusCode ?? 400 });
    });
    socket.once("error", () =>
    {
      resolve({ ok: false, status: 0 });
    });
  });
}
