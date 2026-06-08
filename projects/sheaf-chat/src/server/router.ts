import type { IncomingMessage, ServerResponse } from "node:http";

import { StorageError } from "../storage/errors.js";
import { HandleRouteError, SendRestError } from "./errors.js";
import { HandleHealth } from "./routes/health.js";
import { HandleSessionHistory } from "./routes/history.js";
import { HandleListModels } from "./routes/models.js";
import { HandleCreatePile, HandleListPiles } from "./routes/piles.js";
import {
  HandleCreateSession,
  HandleGetSession,
  HandleListSessions,
} from "./routes/sessions.js";
import type { RouteContext } from "./routes/context.js";

export interface MatchedRoute
{
  pile?: string;
  sessionId?: string;
  history?: boolean;
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
    if (segments[1] === "health" || segments[1] === "models")
    {
      return {};
    }

    if (segments[1] === "piles")
    {
      return {};
    }

    return null;
  }

  if (segments[1] !== "piles" || segments.length < 3)
  {
    return null;
  }

  const pile = DecodePathSegment(segments[2]);

  if (segments.length === 3)
  {
    return { pile };
  }

  if (segments[3] !== "sessions")
  {
    return null;
  }

  if (segments.length === 4)
  {
    return { pile };
  }

  const sessionId = DecodePathSegment(segments[4]);

  if (segments.length === 5)
  {
    return { pile, sessionId };
  }

  if (segments.length === 6 && segments[5] === "history")
  {
    return { pile, sessionId, history: true };
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

  if (segments[1] === "piles")
  {
    if (segments[3] === "sessions")
    {
      if (segments.length === 4)
      {
        return "pile_sessions";
      }

      if (segments.length === 5)
      {
        return "pile_session";
      }

      if (segments.length === 6 && segments[5] === "history")
      {
        return "pile_session_history";
      }
    }
  }

  return null;
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

    if (endpoint === "piles")
    {
      if (request.method === "GET")
      {
        await HandleListPiles(context, response);
        return;
      }

      if (request.method === "POST")
      {
        await HandleCreatePile(context, request, response);
        return;
      }

      SendRestError(response, 405, "method_not_allowed", "method not allowed");
      return;
    }

    if (endpoint === "pile_sessions")
    {
      if (route.pile === undefined)
      {
        SendRestError(response, 404, "not_found", "route not found");
        return;
      }

      if (request.method === "GET")
      {
        await HandleListSessions(context, route.pile, response);
        return;
      }

      if (request.method === "POST")
      {
        await HandleCreateSession(context, route.pile, request, response);
        return;
      }

      SendRestError(response, 405, "method_not_allowed", "method not allowed");
      return;
    }

    if (endpoint === "pile_session")
    {
      if (route.pile === undefined || route.sessionId === undefined)
      {
        SendRestError(response, 404, "not_found", "route not found");
        return;
      }

      if (request.method !== "GET")
      {
        SendRestError(response, 405, "method_not_allowed", "method not allowed");
        return;
      }

      await HandleGetSession(context, route.pile, route.sessionId, response);
      return;
    }

    if (endpoint === "pile_session_history")
    {
      if (route.pile === undefined || route.sessionId === undefined)
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
        route.pile,
        route.sessionId,
        url.searchParams,
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
