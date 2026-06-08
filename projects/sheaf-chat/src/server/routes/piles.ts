import type { IncomingMessage, ServerResponse } from "node:http";

import { CreatePile, ListPiles } from "../../storage/index.js";
import { StorageError } from "../../storage/errors.js";
import { ReadJsonBody, SendJson } from "../http.js";
import type { RouteContext } from "./context.js";

function ParseCreatePileBody(body: unknown): string
{
  if (body === null || typeof body !== "object")
  {
    throw new StorageError("invalid_request", "request body must be a JSON object");
  }

  const pile = (body as { pile?: unknown }).pile;

  if (typeof pile !== "string" || pile.trim().length === 0)
  {
    throw new StorageError("invalid_request", "pile name is required");
  }

  return pile;
}

export async function HandleListPiles(context: RouteContext, response: ServerResponse): Promise<void>
{
  const piles = await ListPiles(context.agentManager.storagePaths);
  SendJson(response, 200, { piles });
}

export async function HandleCreatePile(
  context: RouteContext,
  request: IncomingMessage,
  response: ServerResponse,
): Promise<void>
{
  const body = await ReadJsonBody(request);
  const pile = ParseCreatePileBody(body);
  const summary = await CreatePile(context.agentManager.storagePaths, pile);
  SendJson(response, 201, summary);
}
