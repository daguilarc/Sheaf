import type { ServerResponse } from "node:http";

import { StorageError } from "../../storage/errors.js";
import {
  CreateSessionRootPolicy,
  CreateWorkspaceRootPolicy,
  ListSessionDirectory,
  ReadSessionFile,
} from "../files/sessionBrowser.js";
import { SendJson } from "../http.js";
import type { RouteContext } from "./context.js";

export async function HandleGetChatFile(
  context: RouteContext,
  repoId: string,
  workspaceId: string,
  chatId: string,
  pathParam: string | null,
  response: ServerResponse,
): Promise<void>
{
  if (pathParam === null || pathParam.trim().length === 0)
  {
    throw new StorageError("invalid_request", "path query parameter is required");
  }

  const policy = await CreateSessionRootPolicy(context.agentManager, repoId, workspaceId, chatId);
  const result = await ReadSessionFile(policy, pathParam);
  SendJson(response, 200, result);
}

export async function HandleGetWorkspaceFile(
  context: RouteContext,
  repoId: string,
  workspaceId: string,
  pathParam: string | null,
  response: ServerResponse,
): Promise<void>
{
  if (pathParam === null || pathParam.trim().length === 0)
  {
    throw new StorageError("invalid_request", "path query parameter is required");
  }

  const policy = await CreateWorkspaceRootPolicy(context.agentManager, repoId, workspaceId);
  const result = await ReadSessionFile(policy, pathParam);
  SendJson(response, 200, result);
}

export async function HandleListChatFiles(
  context: RouteContext,
  repoId: string,
  workspaceId: string,
  chatId: string,
  pathParam: string | null,
  response: ServerResponse,
): Promise<void>
{
  const policy = await CreateSessionRootPolicy(context.agentManager, repoId, workspaceId, chatId);
  const relativePath = pathParam ?? ".";
  const result = await ListSessionDirectory(policy, relativePath);
  SendJson(response, 200, result);
}

export async function HandleListWorkspaceFiles(
  context: RouteContext,
  repoId: string,
  workspaceId: string,
  pathParam: string | null,
  response: ServerResponse,
): Promise<void>
{
  const policy = await CreateWorkspaceRootPolicy(context.agentManager, repoId, workspaceId);
  const relativePath = pathParam ?? ".";
  const result = await ListSessionDirectory(policy, relativePath);
  SendJson(response, 200, result);
}
