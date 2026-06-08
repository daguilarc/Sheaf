import type { IncomingMessage, ServerResponse } from "node:http";

import { StorageError } from "../storage/errors.js";

export function SendJson(response: ServerResponse, statusCode: number, body: unknown): void
{
  const payload = JSON.stringify(body);
  response.writeHead(statusCode, {
    "content-type": "application/json; charset=utf-8",
    "content-length": Buffer.byteLength(payload),
  });
  response.end(payload);
}

export async function ReadJsonBody(request: IncomingMessage): Promise<unknown>
{
  const chunks: Buffer[] = [];

  for await (const chunk of request)
  {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }

  const raw = Buffer.concat(chunks).toString("utf8").trim();

  if (raw.length === 0)
  {
    return null;
  }

  try
  {
    return JSON.parse(raw) as unknown;
  }
  catch
  {
    throw new StorageError("invalid_json", "request body is not valid JSON");
  }
}

export function ParseOptionalInteger(
  value: string | null,
  label: string,
): number | undefined
{
  if (value === null || value.length === 0)
  {
    return undefined;
  }

  const parsed = Number.parseInt(value, 10);

  if (!Number.isFinite(parsed))
  {
    throw new StorageError("invalid_history_request", `${label} must be an integer`);
  }

  return parsed;
}
