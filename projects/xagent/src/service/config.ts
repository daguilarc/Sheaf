import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { getDefaultLogRoot } from "../logs.js";

export const XAGENT_SERVICE_NAME = "xagent";
export const XAGENT_DEFAULT_BIND_PORT = 9005;
export const XAGENT_DEFAULT_BIND_HOST = "127.0.0.1";

export type XagentServiceConfig = {
  readonly repoRoot: string;
  readonly bindHost: string;
  readonly bindPort: number;
  readonly command: string;
  readonly logRoot: string;
};

export type LoadXagentServiceConfigOptions = {
  readonly startDir?: string;
  readonly servicesJsonPath?: string;
};

export function findSheafRoot(startDir: string): string {
  let current = resolve(startDir);
  while (true) {
    if (
      existsSync(join(current, "config", "services.json"))
      && existsSync(join(current, "structure"))
    ) {
      return current;
    }
    const parent = dirname(current);
    if (parent === current) {
      throw new Error(`Sheaf root not found from ${startDir}`);
    }
    current = parent;
  }
}

export function resolveXagentLogRoot(repoRoot: string): string {
  return getDefaultLogRoot(repoRoot);
}

export async function loadXagentServiceConfig(
  options: LoadXagentServiceConfigOptions = {},
): Promise<XagentServiceConfig> {
  const servicesJsonPath = options.servicesJsonPath
    ?? join(findSheafRoot(options.startDir ?? process.cwd()), "config", "services.json");
  const services = await readServiceRegistry(servicesJsonPath);
  const entry = services.find((service) => service.name === XAGENT_SERVICE_NAME);
  if (entry === undefined) {
    throw new Error(`"${XAGENT_SERVICE_NAME}" service is not registered in ${servicesJsonPath}`);
  }
  if (!isLoopbackHost(entry.host)) {
    throw new Error(
      `"${XAGENT_SERVICE_NAME}" service must bind to loopback; found ${entry.host}`,
    );
  }
  const repoRoot = dirname(dirname(servicesJsonPath));
  return {
    repoRoot,
    bindHost: entry.host,
    bindPort: entry.port,
    command: entry.command,
    logRoot: resolveXagentLogRoot(repoRoot),
  };
}

type RegistryEntry = {
  readonly name: string;
  readonly host: string;
  readonly port: number;
  readonly command: string;
};

async function readServiceRegistry(servicesJsonPath: string): Promise<RegistryEntry[]> {
  const raw = await readFile(servicesJsonPath, "utf8");
  const parsed = JSON.parse(raw) as unknown;
  if (!Array.isArray(parsed)) {
    throw new Error(`Service registry ${servicesJsonPath} must be a JSON array`);
  }
  return parsed.map((entry, index) => {
    if (!isRecord(entry) || typeof entry.name !== "string" || typeof entry.host !== "string" || !Number.isInteger(entry.port) || typeof entry.command !== "string") {
      throw new Error(`Invalid service registry entry at index ${index} in ${servicesJsonPath}`);
    }
    return {
      name: entry.name,
      host: entry.host,
      port: entry.port as number,
      command: entry.command,
    };
  });
}

function isLoopbackHost(host: string): boolean {
  return host === "127.0.0.1" || host === "localhost" || host === "::1";
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function defaultStartDir(): string {
  return dirname(fileURLToPath(import.meta.url));
}
