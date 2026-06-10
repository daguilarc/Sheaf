import type { ServerResponse } from "node:http";

import { StorageError } from "../../storage/errors.js";
import {
  CreateSessionRootPolicy,
  ListSessionDirectory,
  ReadSessionFile,
} from "../files/sessionBrowser.js";
import { SendJson } from "../http.js";
import type { RouteContext } from "./context.js";

export async function HandleGetSessionFile(
  context: RouteContext,
  pile: string,
  sessionId: string,
  pathParam: string | null,
  response: ServerResponse,
): Promise<void>
{
  if (pathParam === null || pathParam.trim().length === 0)
  {
    throw new StorageError("invalid_request", "path query parameter is required");
  }

  const policy = await CreateSessionRootPolicy(context.agentManager, pile, sessionId);
  const result = await ReadSessionFile(policy, pathParam);
  SendJson(response, 200, result);
}

export async function HandleListSessionFiles(
  context: RouteContext,
  pile: string,
  sessionId: string,
  pathParam: string | null,
  response: ServerResponse,
): Promise<void>
{
  const policy = await CreateSessionRootPolicy(context.agentManager, pile, sessionId);
  const relativePath = pathParam ?? ".";
  const result = await ListSessionDirectory(policy, relativePath);
  SendJson(response, 200, result);
}
