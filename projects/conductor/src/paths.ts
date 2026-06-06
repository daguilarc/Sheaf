import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

export type RepoPaths =
{
  repoRoot: string;
  servicesJsonPath: string;
  sharedCssPath: string;
  serviceLogRoot: (serviceName: string) => string;
};

function findRepoRoot(startDir: string): string
{
  let current = startDir;

  while (current !== dirname(current))
  {
    const servicesJsonPath = join(current, "config", "services.json");
    const structureDir = join(current, "structure");

    if (existsSync(servicesJsonPath) && existsSync(structureDir))
    {
      return current;
    }

    current = dirname(current);
  }

  throw new Error("repository root not found");
}

function buildRepoPaths(repoRoot: string): RepoPaths
{
  return {
    repoRoot,
    servicesJsonPath: join(repoRoot, "config", "services.json"),
    sharedCssPath: join(repoRoot, "projects", "web", "src", "sheaf.css"),
    serviceLogRoot(serviceName: string)
    {
      return join(repoRoot, "logs", serviceName);
    },
  };
}

export function createRepoPathsForRoot(repoRoot: string): RepoPaths
{
  return buildRepoPaths(repoRoot);
}

export function createRepoPaths(startDir?: string): RepoPaths
{
  const resolvedStartDir = startDir ?? dirname(fileURLToPath(import.meta.url));
  const repoRoot = findRepoRoot(resolvedStartDir);

  return buildRepoPaths(repoRoot);
}
