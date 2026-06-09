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
import type { SheafChatConfig } from "./config.js";
import { ProfileStreamPoint } from "./streamProfiler.js";
import { ParseOptionalInteger } from "./http.js";
import { ResolveSessionFilePath } from "../storage/paths.js";
import { StorageError } from "../storage/errors.js";
import { ValidatePileName, ValidateSessionId } from "../storage/validation.js";

export interface ChatWebSocketContext
{
  config: SheafChatConfig;
  agentManager: AgentManager;
  broadcasterRegistry: SessionBroadcasterRegistry;
}

export interface ChatWebSocketConnectParams
{
  pile: string;
  sessionId: string;
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
  const pile = url.searchParams.get("p") ?? url.searchParams.get("pile");

  if (pile === null || pile.length === 0)
  {
    throw new StorageError("invalid_request", "pile query parameter is required");
  }

  const session = url.searchParams.get("session");

  if (session === null || session.length === 0)
  {
    throw new StorageError("invalid_request", "session query parameter is required");
  }

  const validatedPile = ValidatePileName(pile);
  const validatedSessionId = ValidateSessionId(session);
  const clientId = url.searchParams.get("client") ?? undefined;
  const after = ParseOptionalInteger(url.searchParams.get("after"), "after");

  const params: ChatWebSocketConnectParams = {
    pile: validatedPile,
    sessionId: validatedSessionId,
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

export function MatchChatWebSocketPath(pathname: string): boolean
{
  return pathname === "/ws/chat";
}

async function SessionFileExists(
  context: ChatWebSocketContext,
  pile: string,
  sessionId: string,
): Promise<boolean>
{
  const sessionPath = ResolveSessionFilePath(context.agentManager.storagePaths, pile, sessionId);

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
  const exists = await SessionFileExists(context, params.pile, params.sessionId);

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
    pile: params.pile,
    sessionId: params.sessionId,
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
    params.pile,
    params.sessionId,
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
    helloPayload.provisionalSession = {
      rootDirectory: RelativizeAbsolutePath(
        status.provisionalRootDirectory,
        context.config.repoRoot,
      ),
      model: status.model,
    };
  }

  const envelope = CreateChatEnvelope({
    kind: x_serverHelloKind,
    pile: params.pile,
    sessionId: params.sessionId,
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
    pile: params.pile,
    sessionId: params.sessionId,
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
    pile: params.pile,
    sessionId: params.sessionId,
  };

  const broadcaster = await context.broadcasterRegistry.GetOrCreate({
    key,
    config: context.config,
    storagePaths: context.agentManager.storagePaths,
    agentManager: context.agentManager,
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

  if (frame.frame.pile !== params.pile || frame.frame.sessionId !== params.sessionId)
  {
    SendErrorFrame(
      socket,
      params,
      "invalid_frame",
      "frame pile/sessionId does not match connection",
      false,
      frame.frame.id,
    );
    return;
  }

  const key = {
    pile: params.pile,
    sessionId: params.sessionId,
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
          pile: params.pile,
          sessionId: params.sessionId,
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

    case "invalid_pile":
    case "invalid_session_id":
    case "invalid_request":
    case "invalid_history_request":
      return 400;

    default:
      return 400;
  }
}
