import type { ServiceDefinition } from "./service_definition.js";
import type { HeartbeatState } from "./health_poller.js";

export type PresentedService =
{
  name: string;
  host: string;
  port: number;
  command: string;
  home_path?: string;
  healthy: boolean;
  last_checked_at: string | null;
  last_error: string | null;
  uptime?: number;
  warning?: string;
  home_url?: string;
};

export type PresentedServiceHealth =
{
  name: string;
  healthy: boolean;
  last_checked_at: string | null;
  last_error: string | null;
  uptime?: number;
  warning?: string;
};

function deriveHomeUrl(service: ServiceDefinition): string | undefined
{
  if (service.home_path === undefined)
  {
    return undefined;
  }

  return `http://${service.host}:${service.port}${service.home_path}`;
}

function mergeHeartbeatFields(
  heartbeat: HeartbeatState,
): Pick<PresentedService, "healthy" | "last_checked_at" | "last_error" | "uptime" | "warning">
{
  const merged: Pick<PresentedService, "healthy" | "last_checked_at" | "last_error" | "uptime" | "warning"> =
  {
    healthy: heartbeat.healthy,
    last_checked_at: heartbeat.last_checked_at,
    last_error: heartbeat.last_error,
  };

  if (heartbeat.uptime !== undefined)
  {
    merged.uptime = heartbeat.uptime;
  }

  if (heartbeat.warning !== undefined)
  {
    merged.warning = heartbeat.warning;
  }

  return merged;
}

export function presentService(
  service: ServiceDefinition,
  heartbeat: HeartbeatState,
): PresentedService
{
  const presented: PresentedService =
  {
    name: service.name,
    host: service.host,
    port: service.port,
    command: service.command,
    ...mergeHeartbeatFields(heartbeat),
  };

  if (service.home_path !== undefined)
  {
    presented.home_path = service.home_path;
    presented.home_url = deriveHomeUrl(service);
  }

  return presented;
}

export function presentServiceHealth(
  serviceName: string,
  heartbeat: HeartbeatState,
): PresentedServiceHealth
{
  return {
    name: serviceName,
    ...mergeHeartbeatFields(heartbeat),
  };
}

export function presentAllServices(
  services: ServiceDefinition[],
  getHeartbeat: (serviceName: string) => HeartbeatState | undefined,
): PresentedService[]
{
  return services.map((service) =>
  {
    const heartbeat = getHeartbeat(service.name);

    if (!heartbeat)
    {
      throw new Error(`missing heartbeat state for service: ${service.name}`);
    }

    return presentService(service, heartbeat);
  });
}
