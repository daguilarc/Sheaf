import { readFile } from "node:fs/promises";

import type { ServiceDefinition } from "./service_definition.js";

export async function loadServiceRegistry(servicesJsonPath: string): Promise<ServiceDefinition[]>
{
  const raw = await readFile(servicesJsonPath, "utf8");
  const parsed = JSON.parse(raw) as unknown;

  if (!Array.isArray(parsed))
  {
    throw new Error("service registry must be a JSON array");
  }

  return parsed as ServiceDefinition[];
}

export function findServiceByName(
  services: ServiceDefinition[],
  name: string,
): ServiceDefinition | undefined
{
  return services.find((service) => service.name === name);
}
