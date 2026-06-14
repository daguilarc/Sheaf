import type { IncomingMessage, ServerResponse } from "node:http";

import { StorageError } from "../storage/errors.js";
import { HandleRouteError, SendRestError } from "./errors.js";
import { HandleGetAgentReviewAvailability } from "./routes/agentReview.js";
import { HandleHealth } from "./routes/health.js";
import {
  HandleGetChatFile,
  HandleGetWorkspaceFile,
  HandleListChatFiles,
  HandleListWorkspaceFiles,
} from "./routes/files.js";
import { HandleSessionHistory } from "./routes/history.js";
import { HandleListModels } from "./routes/models.js";
import {
  HandleGetWorkspaceEditorState,
  HandleListRepositories,
  HandleListWorkspaces,
  HandlePutWorkspaceEditorState,
} from "./routes/repositories.js";
import {
  HandleCreateChat,
  HandleGetChat,
  HandleListChats,
} from "./routes/sessions.js";
import type { RouteContext } from "./routes/context.js";

export interface MatchedRoute
{
  repoId?: string;
  workspaceId?: string;
  chatId?: string;
  history?: boolean;
  agentReview?: boolean;
  file?: boolean;
  files?: boolean;
  editorState?: boolean;
  workspaceFile?: boolean;
  workspaceFiles?: boolean;
}

function DecodePathSegment(segment: string): string
{
  try
  {
    return decodeURIComponent(segment);
  }
  catch
  {
    throw new StorageError("invalid_request", "route path is not valid");
  }
}

export function MatchApiRoute(pathname: string): MatchedRoute | null
{
  const segments = pathname.split("/").filter((segment) => segment.length > 0);

  if (segments.length < 2 || segments[0] !== "api")
  {
    return null;
  }

  if (segments.length === 2)
  {
    if (
      segments[1] === "health" ||
      segments[1] === "models" ||
      segments[1] === "repositories"
    )
    {
      return {};
    }

    return null;
  }

  if (segments[1] !== "repositories" || segments.length < 3)
  {
    return null;
  }

  const repoId = DecodePathSegment(segments[2]);

  if (segments.length === 3)
  {
    return { repoId };
  }

  if (segments[3] !== "workspaces")
  {
    return null;
  }

  if (segments.length === 4)
  {
    return { repoId };
  }

  const workspaceId = DecodePathSegment(segments[4]);

  if (segments.length === 5)
  {
    return { repoId, workspaceId };
  }

  if (segments.length === 6 && segments[5] === "editor-state")
  {
    return { repoId, workspaceId, editorState: true };
  }

  if (segments.length === 6 && segments[5] === "file")
  {
    return { repoId, workspaceId, workspaceFile: true };
  }

  if (segments.length === 6 && segments[5] === "files")
  {
    return { repoId, workspaceId, workspaceFiles: true };
  }

  if (segments.length === 6 && segments[5] === "agent-review")
  {
    return { repoId, workspaceId, agentReview: true };
  }

  if (segments[5] !== "chats")
  {
    return null;
  }

  if (segments.length === 6)
  {
    return { repoId, workspaceId };
  }

  const chatId = DecodePathSegment(segments[6]);

  if (segments.length === 7)
  {
    return { repoId, workspaceId, chatId };
  }

  if (segments.length === 8)
  {
    if (segments[7] === "history")
    {
      return { repoId, workspaceId, chatId, history: true };
    }

    if (segments[7] === "file")
    {
      return { repoId, workspaceId, chatId, file: true };
    }

    if (segments[7] === "files")
    {
      return { repoId, workspaceId, chatId, files: true };
    }
  }

  return null;
}

export function ResolveApiEndpoint(pathname: string): string | null
{
  const segments = pathname.split("/").filter((segment) => segment.length > 0);

  if (segments.length < 2 || segments[0] !== "api")
  {
    return null;
  }

  if (segments.length === 2)
  {
    return segments[1] ?? null;
  }

  if (segments[1] !== "repositories")
  {
    return null;
  }

  if (segments.length === 4 && segments[3] === "workspaces")
  {
    return "repository_workspaces";
  }

  if (segments.length === 6 && segments[3] === "workspaces" && segments[5] === "chats")
  {
    return "workspace_chats";
  }

  if (
    segments.length === 6 &&
    segments[3] === "workspaces" &&
    segments[5] === "editor-state"
  )
  {
    return "workspace_editor_state";
  }

  if (segments.length === 6 && segments[3] === "workspaces" && segments[5] === "file")
  {
    return "workspace_file";
  }

  if (segments.length === 6 && segments[3] === "workspaces" && segments[5] === "files")
  {
    return "workspace_files";
  }

  if (segments.length === 6 && segments[3] === "workspaces" && segments[5] === "agent-review")
  {
    return "workspace_agent_review";
  }

  if (segments.length === 7 && segments[3] === "workspaces" && segments[5] === "chats")
  {
    return "workspace_chat";
  }

  if (segments.length === 8 && segments[3] === "workspaces" && segments[5] === "chats")
  {
    if (segments[7] === "history")
    {
      return "workspace_chat_history";
    }

    if (segments[7] === "file")
    {
      return "workspace_chat_file";
    }

    if (segments[7] === "files")
    {
      return "workspace_chat_files";
    }
  }

  return null;
}

function HasWorkspace(route: MatchedRoute): route is MatchedRoute & {
  repoId: string;
  workspaceId: string;
}
{
  return route.repoId !== undefined && route.workspaceId !== undefined;
}

function HasChat(route: MatchedRoute): route is MatchedRoute & {
  repoId: string;
  workspaceId: string;
  chatId: string;
}
{
  return HasWorkspace(route) && route.chatId !== undefined;
}

export async function DispatchApiRoute(
  context: RouteContext,
  request: IncomingMessage,
  response: ServerResponse,
  url: URL,
): Promise<void>
{
  const endpoint = ResolveApiEndpoint(url.pathname);

  if (endpoint === null)
  {
    SendRestError(response, 404, "not_found", "route not found");
    return;
  }

  const route = MatchApiRoute(url.pathname);

  if (route === null)
  {
    SendRestError(response, 404, "not_found", "route not found");
    return;
  }

  try
  {
    if (endpoint === "health")
    {
      if (request.method !== "GET")
      {
        SendRestError(response, 405, "method_not_allowed", "method not allowed");
        return;
      }

      HandleHealth(context, response);
      return;
    }

    if (endpoint === "models")
    {
      if (request.method !== "GET")
      {
        SendRestError(response, 405, "method_not_allowed", "method not allowed");
        return;
      }

      HandleListModels(context, response);
      return;
    }

    if (endpoint === "repositories")
    {
      if (request.method !== "GET")
      {
        SendRestError(response, 405, "method_not_allowed", "method not allowed");
        return;
      }

      await HandleListRepositories(context, response);
      return;
    }

    if (endpoint === "repository_workspaces")
    {
      if (route.repoId === undefined)
      {
        SendRestError(response, 404, "not_found", "route not found");
        return;
      }

      if (request.method !== "GET")
      {
        SendRestError(response, 405, "method_not_allowed", "method not allowed");
        return;
      }

      await HandleListWorkspaces(context, route.repoId, response);
      return;
    }

    if (endpoint === "workspace_editor_state")
    {
      if (!HasWorkspace(route))
      {
        SendRestError(response, 404, "not_found", "route not found");
        return;
      }

      if (request.method === "GET")
      {
        await HandleGetWorkspaceEditorState(context, route.repoId, route.workspaceId, response);
        return;
      }

      if (request.method === "PUT")
      {
        await HandlePutWorkspaceEditorState(
          context,
          route.repoId,
          route.workspaceId,
          request,
          response,
        );
        return;
      }

      SendRestError(response, 405, "method_not_allowed", "method not allowed");
      return;
    }

    if (endpoint === "workspace_chats")
    {
      if (!HasWorkspace(route))
      {
        SendRestError(response, 404, "not_found", "route not found");
        return;
      }

      if (request.method === "GET")
      {
        await HandleListChats(context, route.repoId, route.workspaceId, response);
        return;
      }

      if (request.method === "POST")
      {
        await HandleCreateChat(context, route.repoId, route.workspaceId, request, response);
        return;
      }

      SendRestError(response, 405, "method_not_allowed", "method not allowed");
      return;
    }

    if (endpoint === "workspace_file")
    {
      if (!HasWorkspace(route))
      {
        SendRestError(response, 404, "not_found", "route not found");
        return;
      }

      if (request.method !== "GET")
      {
        SendRestError(response, 405, "method_not_allowed", "method not allowed");
        return;
      }

      await HandleGetWorkspaceFile(
        context,
        route.repoId,
        route.workspaceId,
        url.searchParams.get("path"),
        response,
      );
      return;
    }

    if (endpoint === "workspace_files")
    {
      if (!HasWorkspace(route))
      {
        SendRestError(response, 404, "not_found", "route not found");
        return;
      }

      if (request.method !== "GET")
      {
        SendRestError(response, 405, "method_not_allowed", "method not allowed");
        return;
      }

      await HandleListWorkspaceFiles(
        context,
        route.repoId,
        route.workspaceId,
        url.searchParams.get("path"),
        response,
      );
      return;
    }

    if (endpoint === "workspace_chat")
    {
      if (!HasChat(route))
      {
        SendRestError(response, 404, "not_found", "route not found");
        return;
      }

      if (request.method !== "GET")
      {
        SendRestError(response, 405, "method_not_allowed", "method not allowed");
        return;
      }

      await HandleGetChat(context, route.repoId, route.workspaceId, route.chatId, response);
      return;
    }

    if (endpoint === "workspace_chat_history")
    {
      if (!HasChat(route))
      {
        SendRestError(response, 404, "not_found", "route not found");
        return;
      }

      if (request.method !== "GET")
      {
        SendRestError(response, 405, "method_not_allowed", "method not allowed");
        return;
      }

      await HandleSessionHistory(
        context,
        route.repoId,
        route.workspaceId,
        route.chatId,
        url.searchParams,
        response,
      );
      return;
    }

    if (endpoint === "workspace_agent_review")
    {
      if (!HasWorkspace(route))
      {
        SendRestError(response, 404, "not_found", "route not found");
        return;
      }

      if (request.method !== "GET")
      {
        SendRestError(response, 405, "method_not_allowed", "method not allowed");
        return;
      }

      await HandleGetAgentReviewAvailability(
        context,
        route.repoId,
        route.workspaceId,
        response,
      );
      return;
    }

    if (endpoint === "workspace_chat_file")
    {
      if (!HasChat(route))
      {
        SendRestError(response, 404, "not_found", "route not found");
        return;
      }

      if (request.method !== "GET")
      {
        SendRestError(response, 405, "method_not_allowed", "method not allowed");
        return;
      }

      await HandleGetChatFile(
        context,
        route.repoId,
        route.workspaceId,
        route.chatId,
        url.searchParams.get("path"),
        response,
      );
      return;
    }

    if (endpoint === "workspace_chat_files")
    {
      if (!HasChat(route))
      {
        SendRestError(response, 404, "not_found", "route not found");
        return;
      }

      if (request.method !== "GET")
      {
        SendRestError(response, 405, "method_not_allowed", "method not allowed");
        return;
      }

      await HandleListChatFiles(
        context,
        route.repoId,
        route.workspaceId,
        route.chatId,
        url.searchParams.get("path"),
        response,
      );
      return;
    }

    SendRestError(response, 404, "not_found", "route not found");
  }
  catch (error)
  {
    HandleRouteError(response, error);
  }
}
