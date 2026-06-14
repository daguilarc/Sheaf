import type { IncomingMessage, ServerResponse } from "node:http";

import type { ModelReference } from "../../shared/types.js";
import { ListChatManifests, ReadManifest } from "../../storage/manifests.js";
import { StorageError } from "../../storage/errors.js";
import { ReadJsonBody, SendJson } from "../http.js";
import { BuildChatWebSocketUrl } from "../websockets.js";
import type { RouteContext } from "./context.js";

function ParseModelReference(value: unknown): ModelReference
{
  if (value === null || typeof value !== "object")
  {
    throw new StorageError("invalid_request", "model must be an object");
  }

  const provider = (value as { provider?: unknown }).provider;
  const id = (value as { id?: unknown }).id;

  if (typeof provider !== "string" || provider.trim().length === 0)
  {
    throw new StorageError("invalid_request", "model.provider is required");
  }

  if (typeof id !== "string" || id.trim().length === 0)
  {
    throw new StorageError("invalid_request", "model.id is required");
  }

  return { provider, id };
}

function ParseCreateChatBody(body: unknown): { model: ModelReference }
{
  if (body === null || typeof body !== "object")
  {
    throw new StorageError("invalid_request", "request body must be a JSON object");
  }

  return {
    model: ParseModelReference((body as { model?: unknown }).model),
  };
}

export async function HandleListChats(
  context: RouteContext,
  repoId: string,
  workspaceId: string,
  response: ServerResponse,
): Promise<void>
{
  const chats = await ListChatManifests(
    context.agentManager.storagePaths,
    repoId,
    workspaceId,
  );
  SendJson(response, 200, { chats });
}

export async function HandleGetChat(
  context: RouteContext,
  repoId: string,
  workspaceId: string,
  chatId: string,
  response: ServerResponse,
): Promise<void>
{
  const manifest = await ReadManifest(
    context.agentManager.storagePaths,
    repoId,
    workspaceId,
    chatId,
  );
  SendJson(response, 200, { manifest });
}

export async function HandleCreateChat(
  context: RouteContext,
  repoId: string,
  workspaceId: string,
  request: IncomingMessage,
  response: ServerResponse,
): Promise<void>
{
  const body = await ReadJsonBody(request);
  const input = ParseCreateChatBody(body);
  const result = await context.agentManager.createBlankChat(repoId, workspaceId, input.model);

  SendJson(response, 201, {
    chatId: result.shell.chatId,
    provisionalChat: result.shell.provisionalChat,
    webSocketUrl: BuildChatWebSocketUrl({
      repoId: result.shell.repoId,
      workspaceId: result.shell.workspaceId,
      chatId: result.shell.chatId,
    }),
  });
}
