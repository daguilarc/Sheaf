import type { IncomingMessage, ServerResponse } from "node:http";

import {
  ListRepositories,
  ListWorkspaces,
  ReadWorkspaceEditorState,
  WriteWorkspaceEditorState,
} from "../../storage/repositories.js";
import { ReadJsonBody, SendJson } from "../http.js";
import type { RouteContext } from "./context.js";

export async function HandleListRepositories(
  context: RouteContext,
  response: ServerResponse,
): Promise<void>
{
  const repositories = await ListRepositories(context.agentManager.storagePaths);
  SendJson(response, 200, { repositories });
}

export async function HandleListWorkspaces(
  context: RouteContext,
  repoId: string,
  response: ServerResponse,
): Promise<void>
{
  const workspaces = await ListWorkspaces(context.agentManager.storagePaths, repoId);
  SendJson(response, 200, { workspaces });
}

export async function HandleGetWorkspaceEditorState(
  context: RouteContext,
  repoId: string,
  workspaceId: string,
  response: ServerResponse,
): Promise<void>
{
  const editorState = await ReadWorkspaceEditorState(
    context.agentManager.storagePaths,
    repoId,
    workspaceId,
  );
  SendJson(response, 200, { editorState });
}

export async function HandlePutWorkspaceEditorState(
  context: RouteContext,
  repoId: string,
  workspaceId: string,
  request: IncomingMessage,
  response: ServerResponse,
): Promise<void>
{
  const body = await ReadJsonBody(request);
  const editorState = await WriteWorkspaceEditorState(
    context.agentManager.storagePaths,
    repoId,
    workspaceId,
    body,
  );
  SendJson(response, 200, { editorState });
}
