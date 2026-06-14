import { access } from "node:fs/promises";
import type { IncomingMessage } from "node:http";
import type { Duplex } from "node:stream";

import { WebSocket, WebSocketServer } from "ws";

import type { AgentManager } from "../agents/manager.js";
import { RelativizeAbsolutePath } from "../agui/sanitizer.js";
import {
  ParseClientFrame,
  x_clientAckKind,
  x_clientCancelKind,
  x_clientHelloKind,
  x_clientHistoryRequestKind,
  x_clientModelSelectKind,
  x_clientPingKind,
  x_clientStopGeneratingKind,
  x_clientUserMessageKind,
  ToModelReference,
} from "../protocol/clientFrames.js";
import {
  CreateChatEnvelope,
  x_serverCaughtUpKind,
  x_serverErrorKind,
  x_serverHelloKind,
  x_serverPongKind,
} from "../protocol/envelopes.js";
import {
  SessionBroadcasterRegistry,
  type ConnectedClient,
} from "../protocol/sessionBroadcaster.js";
import type { SessionPersistenceHubRegistry } from "../protocol/sessionPersistenceHub.js";
import type { SheafChatConfig } from "./config.js";
import { ProfileStreamPoint } from "./streamProfiler.js";
import { ParseOptionalInteger } from "./http.js";
import { CreateSessionRootPolicy } from "./files/sessionBrowser.js";
import { ResolveSessionFilePath } from "../storage/paths.js";
import { StorageError } from "../storage/errors.js";
import { ValidateChatId, ValidateRepoId, ValidateWorkspaceId } from "../storage/validation.js";

export interface ChatWebSocketContext
{
  config: SheafChatConfig;
  agentManager: AgentManager;
  persistenceHubRegistry: SessionPersistenceHubRegistry;
  broadcasterRegistry: SessionBroadcasterRegistry;
}

export interface ChatWebSocketConnectParams
{
  repoId: string;
  workspaceId: string;
  chatId: string;
  clientId?: string;
  after?: number;
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

export function CreateChatWebSocketServer(): WebSocketServer
{
  return new WebSocketServer({ noServer: true });
}

export function ParseChatWebSocketQuery(url: URL): ChatWebSocketConnectParams
{
  const repoId = url.searchParams.get("repo");

  if (repoId === null || repoId.length === 0)
  {
    throw new StorageError("invalid_request", "repo query parameter is required");
  }

  const workspaceId = url.searchParams.get("workspace");

  if (workspaceId === null || workspaceId.length === 0)
  {
    throw new StorageError("invalid_request", "workspace query parameter is required");
  }

  const chatId = url.searchParams.get("chat");

  if (chatId === null || chatId.length === 0)
  {
    throw new StorageError("invalid_request", "chat query parameter is required");
  }

  const validatedRepoId = ValidateRepoId(repoId);
  const validatedWorkspaceId = ValidateWorkspaceId(workspaceId);
  const validatedChatId = ValidateChatId(chatId);
  const clientId = url.searchParams.get("client") ?? undefined;
  const after = ParseOptionalInteger(url.searchParams.get("after"), "after");

  const params: ChatWebSocketConnectParams = {
    repoId: validatedRepoId,
    workspaceId: validatedWorkspaceId,
    chatId: validatedChatId,
  };

  if (clientId !== undefined && clientId.length > 0)
  {
    params.clientId = clientId;
  }

  if (after !== undefined)
  {
    params.after = after;
  }

  return params;
}

export interface WorkspaceWebSocketConnectParams
{
  repoId: string;
  workspaceId: string;
  clientId?: string;
}

// Agent Review is workspace-scoped: its socket carries repo/workspace/client and
// no chat parameter.
export function ParseAgentReviewWebSocketQuery(url: URL): WorkspaceWebSocketConnectParams
{
  const repoId = url.searchParams.get("repo");

  if (repoId === null || repoId.length === 0)
  {
    throw new StorageError("invalid_request", "repo query parameter is required");
  }

  const workspaceId = url.searchParams.get("workspace");

  if (workspaceId === null || workspaceId.length === 0)
  {
    throw new StorageError("invalid_request", "workspace query parameter is required");
  }

  const validatedRepoId = ValidateRepoId(repoId);
  const validatedWorkspaceId = ValidateWorkspaceId(workspaceId);
  const clientId = url.searchParams.get("client") ?? undefined;

  const params: WorkspaceWebSocketConnectParams = {
    repoId: validatedRepoId,
    workspaceId: validatedWorkspaceId,
  };

  if (clientId !== undefined && clientId.length > 0)
  {
    params.clientId = clientId;
  }

  return params;
}

export function MatchChatWebSocketPath(pathname: string): boolean
{
  return pathname === "/ws/chat";
}

async function SessionFileExists(
  context: ChatWebSocketContext,
  repoId: string,
  workspaceId: string,
  chatId: string,
): Promise<boolean>
{
  const sessionPath = ResolveSessionFilePath(
    context.agentManager.storagePaths,
    repoId,
    workspaceId,
    chatId,
  );

  try
  {
    await access(sessionPath);
    return true;
  }
  catch
  {
    return false;
  }
}

export async function ValidateChatWebSocketConnect(
  context: ChatWebSocketContext,
  params: ChatWebSocketConnectParams,
): Promise<void>
{
  const exists = await SessionFileExists(
    context,
    params.repoId,
    params.workspaceId,
    params.chatId,
  );

  if (!exists)
  {
    throw new StorageError("not_found", "session not found");
  }
}

function SendErrorFrame(
  socket: WebSocket,
  params: ChatWebSocketConnectParams,
  code: string,
  message: string,
  fatal = false,
  requestId?: string,
): void
{
  const payload: Record<string, unknown> = {
    code,
    message,
    fatal,
  };

  if (requestId !== undefined)
  {
    payload.requestId = requestId;
  }

  const envelope = CreateChatEnvelope({
    kind: x_serverErrorKind,
    repoId: params.repoId,
    workspaceId: params.workspaceId,
    chatId: params.chatId,
    clientId: params.clientId,
    payload,
  });

  if (socket.readyState === WebSocket.OPEN)
  {
    socket.send(JSON.stringify(envelope));
  }
}

async function SendHello(
  client: ConnectedClient,
  context: ChatWebSocketContext,
  params: ChatWebSocketConnectParams,
  broadcaster: Awaited<ReturnType<SessionBroadcasterRegistry["GetOrCreate"]>>,
  onAttached: () => void,
): Promise<void>
{
  const status = await context.agentManager.attachSession(
    params.repoId,
    params.workspaceId,
    params.chatId,
    client.connectionId,
  );
  onAttached();

  const historyWindow = await broadcaster.HistoryWindow();
  const models = context.agentManager.listModels();
  const manifest = status.manifest;

  const helloPayload: Record<string, unknown> = {
    connectionId: client.connectionId,
    manifest: manifest ?? null,
    latestSequence: historyWindow.newestSequence ?? 0,
    historyWindow,
    models,
    activeModel: status.model,
  };

  if (manifest === undefined && status.provisionalRootDirectory !== undefined)
  {
    helloPayload.provisionalChat = {
      rootDirectory: RelativizeAbsolutePath(
        status.provisionalRootDirectory,
        context.config.repoRoot,
      ),
      model: status.model,
    };
  }

  const envelope = CreateChatEnvelope({
    kind: x_serverHelloKind,
    repoId: params.repoId,
    workspaceId: params.workspaceId,
    chatId: params.chatId,
    clientId: params.clientId,
    payload: helloPayload,
  });

  client.socket.send(JSON.stringify(envelope));
}

async function SendReplayAndCaughtUp(
  client: ConnectedClient,
  params: ChatWebSocketConnectParams,
  broadcaster: Awaited<ReturnType<SessionBroadcasterRegistry["GetOrCreate"]>>,
  replayThroughSequence: number,
): Promise<void>
{
  if (params.after !== undefined)
  {
    await broadcaster.ReplayAfter(client, params.after, replayThroughSequence);
  }

  const caughtUp = CreateChatEnvelope({
    kind: x_serverCaughtUpKind,
    repoId: params.repoId,
    workspaceId: params.workspaceId,
    chatId: params.chatId,
    clientId: params.clientId,
    payload: {},
  });

  client.socket.send(JSON.stringify(caughtUp));
  await broadcaster.ReplayAfter(client, replayThroughSequence);
}

export async function AttachChatWebSocketConnection(
  socket: WebSocket,
  params: ChatWebSocketConnectParams,
  context: ChatWebSocketContext,
): Promise<void>
{
  const key = {
    repoId: params.repoId,
    workspaceId: params.workspaceId,
    chatId: params.chatId,
  };

  const persistenceHub = await context.persistenceHubRegistry.GetOrCreate({
    key,
    config: context.config,
    storagePaths: context.agentManager.storagePaths,
    agentManager: context.agentManager,
  });
  const sessionRootPolicy = await CreateSessionRootPolicy(
    context.agentManager,
    params.repoId,
    params.workspaceId,
    params.chatId,
  );
  const broadcaster = await context.broadcasterRegistry.GetOrCreate({
    key,
    storagePaths: context.agentManager.storagePaths,
    agentManager: context.agentManager,
    persistenceHub,
    canonicalRootDirectory: sessionRootPolicy.canonicalRoot,
  });

  const client = broadcaster.RegisterClient(socket, params.clientId);
  const replayThroughSequence = broadcaster.LatestSequence;
  let connectionEnded = false;
  let runtimeAttached = false;
  let runtimeDetached = false;
  let clientFramesReady = false;
  const queuedClientFrames: WebSocket.RawData[] = [];

  const cleanup = () =>
  {
    connectionEnded = true;
    broadcaster.RemoveClient(client.connectionId);

    if (runtimeAttached && !runtimeDetached)
    {
      runtimeDetached = true;
      context.agentManager.markClientDetached(key, client.connectionId);
    }

    context.broadcasterRegistry.ReleaseIfIdle(key);
  };

  socket.on("close", cleanup);
  socket.on("message", (data) =>
  {
    ProfileStreamPoint("client_frame_received", {
      bytes: data.toString().length,
      queued: !clientFramesReady,
    });

    if (!clientFramesReady)
    {
      queuedClientFrames.push(data);
      return;
    }

    void HandleClientMessage(socket, client, params, context, broadcaster, data);
  });

  try
  {
    await SendHello(client, context, params, broadcaster, () =>
    {
      runtimeAttached = true;
    });

    if (connectionEnded || socket.readyState !== WebSocket.OPEN)
    {
      cleanup();
      return;
    }

    await SendReplayAndCaughtUp(client, params, broadcaster, replayThroughSequence);

    if (connectionEnded || socket.readyState !== WebSocket.OPEN)
    {
      cleanup();
      return;
    }

    broadcaster.ActivateClient(client);

    while (queuedClientFrames.length > 0)
    {
      if (connectionEnded || socket.readyState !== WebSocket.OPEN)
      {
        cleanup();
        return;
      }

      const data = queuedClientFrames.shift();

      if (data !== undefined)
      {
        await HandleClientMessage(socket, client, params, context, broadcaster, data);
      }
    }

    clientFramesReady = true;
  }
  catch (error)
  {
    const message = error instanceof Error ? error.message : String(error);
    const code = error instanceof StorageError ? error.code : "connection_failed";
    SendErrorFrame(socket, params, code, message, true);
    socket.close();
    cleanup();
    return;
  }
}

async function HandleClientMessage(
  socket: WebSocket,
  client: ConnectedClient,
  params: ChatWebSocketConnectParams,
  context: ChatWebSocketContext,
  broadcaster: Awaited<ReturnType<SessionBroadcasterRegistry["GetOrCreate"]>>,
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
    SendErrorFrame(socket, params, "invalid_frame", "malformed JSON frame", false);
    return;
  }

  let frame;

  try
  {
    frame = ParseClientFrame(parsed);
  }
  catch (error)
  {
    const message = error instanceof Error ? error.message : String(error);
    const code = error instanceof StorageError ? error.code : "invalid_frame";
    SendErrorFrame(socket, params, code, message, false);
    return;
  }

  if (
    frame.frame.repoId !== params.repoId ||
    frame.frame.workspaceId !== params.workspaceId ||
    frame.frame.chatId !== params.chatId
  )
  {
    SendErrorFrame(
      socket,
      params,
      "invalid_frame",
      "frame repoId/workspaceId/chatId does not match connection",
      false,
      frame.frame.id,
    );
    return;
  }

  const key = {
    repoId: params.repoId,
    workspaceId: params.workspaceId,
    chatId: params.chatId,
  };

  try
  {
    switch (frame.kind)
    {
      case x_clientHelloKind:
        ProfileStreamPoint("client_hello_received");
        break;

      case x_clientUserMessageKind:
        ProfileStreamPoint("client_user_message_received", {
          textChars: frame.payload.text.length,
        });
        await broadcaster.HandleUserMessage(client.connectionId, frame.payload);
        break;

      case x_clientHistoryRequestKind:
        await broadcaster.HandleHistoryRequest(
          client.connectionId,
          frame.frame.id,
          frame.payload,
        );
        break;

      case x_clientModelSelectKind:
        await context.agentManager.selectModel(
          key,
          ToModelReference(frame.payload),
          frame.payload.applyTo ?? "next_turn",
        );
        break;

      case x_clientAckKind:
        broadcaster.RecordAck(client.connectionId, frame.payload.sequence);
        break;

      case x_clientCancelKind:
      case x_clientStopGeneratingKind:
        await context.agentManager.cancelTurn(key);
        break;

      case x_clientPingKind:
      {
        const pong = CreateChatEnvelope({
          kind: x_serverPongKind,
          repoId: params.repoId,
          workspaceId: params.workspaceId,
          chatId: params.chatId,
          clientId: params.clientId,
          payload: {
            requestId: frame.frame.id,
          },
        });
        socket.send(JSON.stringify(pong));
        break;
      }
    }
  }
  catch (error)
  {
    const message = error instanceof Error ? error.message : String(error);
    const code = error instanceof StorageError ? error.code : "request_failed";
    SendErrorFrame(socket, params, code, message, false, frame.frame.id);
  }
}

export async function ResolveChatWebSocketUpgrade(
  context: ChatWebSocketContext,
  request: IncomingMessage,
): Promise<ChatWebSocketConnectParams | null>
{
  const url = new URL(request.url ?? "/", `http://${request.headers.host ?? "localhost"}`);

  if (!MatchChatWebSocketPath(url.pathname))
  {
    return null;
  }

  try
  {
    const params = ParseChatWebSocketQuery(url);
    await ValidateChatWebSocketConnect(context, params);
    return params;
  }
  catch (error)
  {
    if (error instanceof StorageError)
    {
      throw error;
    }

    throw new StorageError(
      "invalid_request",
      error instanceof Error ? error.message : String(error),
    );
  }
}

export function StorageErrorToHttpStatus(error: StorageError): number
{
  switch (error.code)
  {
    case "not_found":
      return 404;

    case "invalid_id":
    case "invalid_request":
    case "invalid_history_request":
      return 400;

    default:
      return 400;
  }
}
