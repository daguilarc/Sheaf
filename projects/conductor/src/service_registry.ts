import { readFile } from "node:fs/promises";

import type { ServiceDefinition } from "./service_definition.js";

export type LoadServiceRegistryOptions =
{
  servicesJsonPath: string;
};

function validateServiceEntry(entry: unknown, index: number): ServiceDefinition
{
  if (typeof entry !== "object" || entry === null || Array.isArray(entry))
  {
    throw new Error(`service registry entry at index ${index} must be an object`);
  }

  const record = entry as Record<string, unknown>;
  const name = record.name;

  if (typeof name !== "string" || name.length === 0)
  {
    throw new Error(`service registry entry at index ${index} has invalid name`);
  }

  if (typeof record.host !== "string" || record.host.length === 0)
  {
    throw new Error(`service registry entry "${name}" has invalid host`);
  }

  if (!Number.isInteger(record.port))
  {
    throw new Error(`service registry entry "${name}" has invalid port`);
  }

  if (typeof record.command !== "string")
  {
    throw new Error(`service registry entry "${name}" has invalid command`);
  }

  if (record.home_path !== undefined && typeof record.home_path !== "string")
  {
    throw new Error(`service registry entry "${name}" has invalid home_path`);
  }

  const service: ServiceDefinition =
  {
    name,
    host: record.host,
    port: record.port as number,
    command: record.command,
  };

  if (record.home_path !== undefined)
  {
    service.home_path = record.home_path;
  }

  return service;
}

export async function loadServiceRegistry(
  servicesJsonPathOrOptions: string | LoadServiceRegistryOptions,
): Promise<ServiceDefinition[]>
{
  const servicesJsonPath = typeof servicesJsonPathOrOptions === "string"
    ? servicesJsonPathOrOptions
    : servicesJsonPathOrOptions.servicesJsonPath;

  let parsed: unknown;

  try
  {
    const raw = await readFile(servicesJsonPath, "utf8");
    parsed = JSON.parse(raw) as unknown;
  }
  catch (error: unknown)
  {
    if (error instanceof SyntaxError)
    {
      throw new Error("service registry contains malformed JSON");
    }

    throw error;
  }

  if (!Array.isArray(parsed))
  {
    throw new Error("service registry must be a JSON array");
  }

  const services: ServiceDefinition[] = [];
  const seenNames = new Set<string>();

  for (let index = 0; index < parsed.length; index += 1)
  {
    const service = validateServiceEntry(parsed[index], index);

    if (seenNames.has(service.name))
    {
      throw new Error(`duplicate service name: ${service.name}`);
    }

    seenNames.add(service.name);
    services.push(service);
  }

  return services;
}

export function findServiceByName(
  services: ServiceDefinition[],
  name: string,
): ServiceDefinition | undefined
{
  return services.find((service) => service.name === name);
}
