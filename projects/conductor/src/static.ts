import { readFile } from "node:fs/promises";
import { extname, join, normalize, sep } from "node:path";
import type { ServerResponse } from "node:http";

export type StaticAssetRoot =
{
  urlPrefix: string;
  rootDir: string;
};

export type StaticFileResult =
{
  content: Buffer;
  contentType: string;
};

const x_ContentTypes: Record<string, string> =
{
  ".css": "text/css; charset=utf-8",
  ".js": "application/javascript; charset=utf-8",
  ".html": "text/html; charset=utf-8",
};

function normalizeUrlPrefix(urlPrefix: string): string
{
  if (!urlPrefix.startsWith("/"))
  {
    throw new Error("static asset urlPrefix must start with /");
  }

  if (urlPrefix.length > 1 && urlPrefix.endsWith("/"))
  {
    return urlPrefix.slice(0, -1);
  }

  return urlPrefix;
}

function isPathInsideRoot(rootDir: string, candidatePath: string): boolean
{
  const normalizedRoot = normalize(rootDir);
  const normalizedCandidate = normalize(candidatePath);

  if (normalizedCandidate === normalizedRoot)
  {
    return true;
  }

  return normalizedCandidate.startsWith(normalizedRoot + sep);
}

export function resolveStaticFile(
  urlPath: string,
  roots: StaticAssetRoot[],
): { absolutePath: string; contentType: string } | undefined
{
  for (const root of roots)
  {
    const urlPrefix = normalizeUrlPrefix(root.urlPrefix);

    if (urlPath === urlPrefix || !urlPath.startsWith(urlPrefix + "/"))
    {
      continue;
    }

    const relativePath = urlPath.slice(urlPrefix.length + 1);

    if (relativePath.includes("..") || relativePath.includes("\\"))
    {
      return undefined;
    }

    const absolutePath = normalize(join(root.rootDir, relativePath));

    if (!isPathInsideRoot(root.rootDir, absolutePath))
    {
      return undefined;
    }

    const extension = extname(absolutePath).toLowerCase();
    const contentType = x_ContentTypes[extension];

    if (!contentType)
    {
      return undefined;
    }

    return { absolutePath, contentType };
  }

  return undefined;
}

export async function readStaticFile(
  urlPath: string,
  roots: StaticAssetRoot[],
): Promise<StaticFileResult | undefined>
{
  const resolved = resolveStaticFile(urlPath, roots);

  if (!resolved)
  {
    return undefined;
  }

  const content = await readFile(resolved.absolutePath);

  return {
    content,
    contentType: resolved.contentType,
  };
}

export function sendBytes(
  response: ServerResponse,
  statusCode: number,
  contentType: string,
  content: Buffer,
): void
{
  response.statusCode = statusCode;
  response.setHeader("Content-Type", contentType);
  response.setHeader("Content-Length", content.length);
  response.end(content);
}

export function sendHtml(response: ServerResponse, html: string): void
{
  const content = Buffer.from(html, "utf-8");
  sendBytes(response, 200, "text/html; charset=utf-8", content);
}

export function sendStaticResult(response: ServerResponse, result: StaticFileResult): void
{
  sendBytes(response, 200, result.contentType, result.content);
}
