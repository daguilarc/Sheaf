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
