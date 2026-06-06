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

export function createRepoPaths(startDir?: string): RepoPaths
{
  const resolvedStartDir = startDir ?? dirname(fileURLToPath(import.meta.url));
  const repoRoot = findRepoRoot(resolvedStartDir);
  const servicesJsonPath = join(repoRoot, "config", "services.json");
  const sharedCssPath = join(repoRoot, "projects", "web", "src", "sheaf.css");

  return {
    repoRoot,
    servicesJsonPath,
    sharedCssPath,
    serviceLogRoot(serviceName: string)
    {
      return join(repoRoot, "logs", serviceName);
    },
  };
}
