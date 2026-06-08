import type { ServerResponse } from "node:http";

import { AgentManagerError } from "../agents/manager.js";
import { ModelValidationError } from "../agents/models.js";
import { FormatRestError } from "../shared/errors.js";
import { StorageError } from "../storage/errors.js";
import { SendJson } from "./http.js";

const x_errorStatusCodes: Record<string, number> = {
  invalid_request: 400,
  invalid_json: 400,
  invalid_pile: 400,
  invalid_session_id: 400,
  invalid_name: 400,
  invalid_manifest: 400,
  invalid_history_request: 400,
  invalid_sequence: 400,
  model_unavailable: 400,
  invalid_root_directory: 400,
  method_not_allowed: 405,
  not_found: 404,
  pile_not_found: 404,
  manifest_not_found: 404,
  model_not_found: 404,
  path_escape: 403,
};

export function ResolveErrorStatusCode(code: string): number
{
  return x_errorStatusCodes[code] ?? 500;
}

export function SendRestError(
  response: ServerResponse,
  statusCode: number,
  code: string,
  message: string,
): void
{
  SendJson(response, statusCode, FormatRestError(code, message));
}

export function HandleRouteError(response: ServerResponse, error: unknown): void
{
  if (error instanceof StorageError)
  {
    SendRestError(
      response,
      ResolveErrorStatusCode(error.code),
      error.code,
      error.message,
    );
    return;
  }

  if (error instanceof ModelValidationError)
  {
    SendRestError(
      response,
      ResolveErrorStatusCode(error.code),
      error.code,
      error.message,
    );
    return;
  }

  if (error instanceof AgentManagerError)
  {
    SendRestError(
      response,
      ResolveErrorStatusCode(error.code),
      error.code,
      error.message,
    );
    return;
  }

  if (error instanceof Error && error.message.length > 0)
  {
    SendRestError(response, 500, "internal_error", error.message);
    return;
  }

  SendRestError(response, 500, "internal_error", "unexpected server error");
}
