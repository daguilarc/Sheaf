import { readdirSync } from "node:fs";
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
  ".woff": "font/woff",
  ".woff2": "font/woff2",
  ".ttf": "font/ttf",
};

export const x_webAssetPrefix = "/assets/web";
export const x_sheafChatAssetPrefix = "/assets/sheaf-chat";
export const x_vendorAssetPrefix = "/assets/vendor";
export const x_aguiChatCssPath = `${x_webAssetPrefix}/agui-chat.css`;
export const x_aguiChatJsPath = `${x_webAssetPrefix}/agui-chat.js`;
export const x_sheafChatCssPath = `${x_sheafChatAssetPrefix}/sheaf-chat.css`;
export const x_sheafChatJsPath = `${x_sheafChatAssetPrefix}/sheaf-chat.js`;
export const x_sheafMarkdownJsPath = `${x_sheafChatAssetPrefix}/sheaf-markdown.js`;
export const x_markdownItJsPath = `${x_vendorAssetPrefix}/markdown-it.min.js`;
export const x_katexJsPath = `${x_vendorAssetPrefix}/katex.min.js`;
export const x_katexCssPath = `${x_vendorAssetPrefix}/katex.min.css`;
export const x_katexFontsUrlPrefix = `${x_vendorAssetPrefix}/katex/fonts`;

function NormalizeUrlPrefix(urlPrefix: string): string
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

function IsPathInsideRoot(rootDir: string, candidatePath: string): boolean
{
  const normalizedRoot = normalize(rootDir);
  const normalizedCandidate = normalize(candidatePath);

  if (normalizedCandidate === normalizedRoot)
  {
    return true;
  }

  return normalizedCandidate.startsWith(normalizedRoot + sep);
}

function ResolvePackageRoot(repoRoot: string): string
{
  return join(repoRoot, "projects", "sheaf-chat");
}

function ListKatexFontFileNames(packageRoot: string): string[]
{
  const fontsDir = join(packageRoot, "node_modules", "katex", "dist", "fonts");

  try
  {
    return readdirSync(fontsDir).filter((entry) =>
    {
      const extension = extname(entry).toLowerCase();
      return extension === ".woff" || extension === ".woff2" || extension === ".ttf";
    });
  }
  catch
  {
    return [];
  }
}

export function BuildVendorAssetAllowlist(repoRoot: string): Map<string, string>
{
  const packageRoot = ResolvePackageRoot(repoRoot);
  const nodeModulesDir = join(packageRoot, "node_modules");
  const allowlist = new Map<string, string>([
    [x_markdownItJsPath, join(nodeModulesDir, "markdown-it", "dist", "markdown-it.min.js")],
    [x_katexJsPath, join(nodeModulesDir, "katex", "dist", "katex.min.js")],
    [x_katexCssPath, join(nodeModulesDir, "katex", "dist", "katex.min.css")],
  ]);

  for (const fontFileName of ListKatexFontFileNames(packageRoot))
  {
    allowlist.set(
      `${x_katexFontsUrlPrefix}/${fontFileName}`,
      join(nodeModulesDir, "katex", "dist", "fonts", fontFileName),
    );
  }

  return allowlist;
}

export function BuildSheafChatStaticRoots(repoRoot: string): StaticAssetRoot[]
{
  return [
    {
      urlPrefix: x_webAssetPrefix,
      rootDir: join(repoRoot, "projects", "web", "src"),
    },
    {
      urlPrefix: x_sheafChatAssetPrefix,
      rootDir: join(repoRoot, "projects", "sheaf-chat", "src", "ui"),
    },
  ];
}

export function ResolveSheafChatIndexPath(repoRoot: string): string
{
  return join(repoRoot, "projects", "sheaf-chat", "src", "ui", "index.html");
}

export function ResolveVendorFile(
  urlPath: string,
  allowlist: Map<string, string>,
): { absolutePath: string; contentType: string } | undefined
{
  const fontsPrefix = x_katexFontsUrlPrefix + "/";

  if (urlPath.startsWith(fontsPrefix))
  {
    const relativePath = urlPath.slice(fontsPrefix.length);

    if (
      relativePath.length === 0 ||
      relativePath.includes("..") ||
      relativePath.includes("\\") ||
      relativePath.includes("/")
    )
    {
      return undefined;
    }

    const absolutePath = allowlist.get(urlPath);

    if (!absolutePath)
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

  const absolutePath = allowlist.get(urlPath);

  if (!absolutePath)
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

export function ResolveStaticFile(
  urlPath: string,
  roots: StaticAssetRoot[],
  vendorAllowlist?: Map<string, string>,
): { absolutePath: string; contentType: string } | undefined
{
  if (vendorAllowlist)
  {
    const vendorResolved = ResolveVendorFile(urlPath, vendorAllowlist);

    if (vendorResolved)
    {
      return vendorResolved;
    }
  }

  for (const root of roots)
  {
    const urlPrefix = NormalizeUrlPrefix(root.urlPrefix);

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

    if (!IsPathInsideRoot(root.rootDir, absolutePath))
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

export async function ReadStaticFile(
  urlPath: string,
  roots: StaticAssetRoot[],
  vendorAllowlist?: Map<string, string>,
): Promise<StaticFileResult | undefined>
{
  const resolved = ResolveStaticFile(urlPath, roots, vendorAllowlist);

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

export function SendBytes(
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

export function SendHtml(response: ServerResponse, html: string): void
{
  const content = Buffer.from(html, "utf-8");
  SendBytes(response, 200, "text/html; charset=utf-8", content);
}

export function SendStaticResult(response: ServerResponse, result: StaticFileResult): void
{
  SendBytes(response, 200, result.contentType, result.content);
}
