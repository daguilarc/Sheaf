import { join } from "node:path";

export function resolveBrowserHomeUrl(
  homeUrl: string | undefined,
  pageHostname: string,
): string | undefined
{
  if (homeUrl === undefined)
  {
    return undefined;
  }

  try
  {
    const url = new URL(homeUrl);

    if (url.hostname === "0.0.0.0")
    {
      url.hostname = pageHostname;
    }

    return url.toString();
  }
  catch
  {
    return homeUrl;
  }
}

export function matchLogsPagePath(path: string): string | null
{
  const match = path.match(/^\/services\/([^/]+)\/logs$/);

  if (!match)
  {
    return null;
  }

  return decodeURIComponent(match[1]!);
}

export function buildConductorStaticRoots(repoRoot: string): Array<{ urlPrefix: string; rootDir: string }>
{
  return [
    {
      urlPrefix: "/assets/web",
      rootDir: join(repoRoot, "projects", "web", "src"),
    },
    {
      urlPrefix: "/assets/conductor",
      rootDir: join(repoRoot, "projects", "conductor", "src", "ui"),
    },
  ];
}

export const x_SharedCssAssetPath = "/assets/web/sheaf.css";
export const x_MainJsAssetPath = "/assets/conductor/main.js";
export const x_LogsJsAssetPath = "/assets/conductor/logs.js";
