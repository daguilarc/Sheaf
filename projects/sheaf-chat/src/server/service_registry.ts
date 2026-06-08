import { readFile } from "node:fs/promises";

export interface ServiceDefinition
{
  name: string;
  host: string;
  port: number;
  home_path: string;
  command: string;
}

export async function LoadServiceRegistry(servicesJsonPath: string): Promise<ServiceDefinition[]>
{
  const raw = await readFile(servicesJsonPath, "utf8");
  const parsed = JSON.parse(raw) as ServiceDefinition[];

  if (!Array.isArray(parsed))
  {
    throw new Error("services.json must contain an array");
  }

  return parsed;
}

export function FindServiceByName(
  services: ServiceDefinition[],
  serviceName: string,
): ServiceDefinition | undefined
{
  return services.find((service) => service.name === serviceName);
}
