import type { IncomingMessage, ServerResponse } from "node:http";

import { RelativizeAbsolutePath } from "../../agui/sanitizer.js";
import type { ModelReference } from "../../shared/types.js";
import { ListSessionManifests, ReadManifest } from "../../storage/manifests.js";
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

  return {
    provider,
    id,
  };
}

function ParseCreateSessionBody(body: unknown): { rootDirectory: string; model: ModelReference }
{
  if (body === null || typeof body !== "object")
  {
    throw new StorageError("invalid_request", "request body must be a JSON object");
  }

  const rootDirectory = (body as { rootDirectory?: unknown }).rootDirectory;

  if (typeof rootDirectory !== "string" || rootDirectory.trim().length === 0)
  {
    throw new StorageError("invalid_request", "rootDirectory is required");
  }

  const model = ParseModelReference((body as { model?: unknown }).model);

  return {
    rootDirectory,
    model,
  };
}

export async function HandleListSessions(
  context: RouteContext,
  pile: string,
  response: ServerResponse,
): Promise<void>
{
  const sessions = await ListSessionManifests(context.agentManager.storagePaths, pile);
  SendJson(response, 200, { sessions });
}

export async function HandleGetSession(
  context: RouteContext,
  pile: string,
  sessionId: string,
  response: ServerResponse,
): Promise<void>
{
  const manifest = await ReadManifest(context.agentManager.storagePaths, pile, sessionId);
  SendJson(response, 200, { manifest });
}

export async function HandleCreateSession(
  context: RouteContext,
  pile: string,
  request: IncomingMessage,
  response: ServerResponse,
): Promise<void>
{
  const body = await ReadJsonBody(request);
  const input = ParseCreateSessionBody(body);
  const result = await context.agentManager.createBlankSession(
    pile,
    input.rootDirectory,
    input.model,
  );
  const relativeRoot = RelativizeAbsolutePath(
    result.shell.provisionalSession.rootDirectory,
    context.config.repoRoot,
  );

  SendJson(response, 201, {
    sessionId: result.shell.sessionId,
    provisionalSession: {
      rootDirectory: relativeRoot,
      model: result.shell.provisionalSession.model,
    },
    webSocketUrl: BuildChatWebSocketUrl({
      pile: result.key.pile,
      sessionId: result.key.sessionId,
    }),
  });
}
