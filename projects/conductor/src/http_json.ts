import type { IncomingMessage, ServerResponse } from "node:http";

export function sendJson(
  response: ServerResponse,
  statusCode: number,
  body: unknown,
): void
{
  const payload = JSON.stringify(body);
  response.statusCode = statusCode;
  response.setHeader("Content-Type", "application/json; charset=utf-8");
  response.setHeader("Content-Length", Buffer.byteLength(payload));
  response.end(payload);
}

export function sendJsonAfterFlush(
  response: ServerResponse,
  statusCode: number,
  body: unknown,
  onFlushed: () => void | Promise<void>,
): void
{
  const payload = JSON.stringify(body);
  response.statusCode = statusCode;
  response.setHeader("Content-Type", "application/json; charset=utf-8");
  response.setHeader("Content-Length", Buffer.byteLength(payload));
  response.end(payload, () =>
  {
    void Promise.resolve(onFlushed());
  });
}

export function parseRequestPath(request: IncomingMessage): string
{
  const url = new URL(request.url ?? "/", "http://localhost");
  return url.pathname;
}

export function decodePathSegment(segment: string): string
{
  return decodeURIComponent(segment);
}

export async function readJsonBody(request: IncomingMessage): Promise<unknown>
{
  if (typeof (request as AsyncIterable<unknown>)[Symbol.asyncIterator] !== "function")
  {
    return undefined;
  }

  const chunks: Buffer[] = [];

  for await (const chunk of request)
  {
    chunks.push(chunk as Buffer);
  }

  const raw = Buffer.concat(chunks).toString("utf8").trim();

  if (raw.length === 0)
  {
    return undefined;
  }

  try
  {
    return JSON.parse(raw);
  }
  catch
  {
    return undefined;
  }
}

export function readSmokeTestFlag(body: unknown): boolean
{
  return typeof body === "object"
    && body !== null
    && (body as Record<string, unknown>).smoke_test === true;
}
