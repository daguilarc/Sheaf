#!/usr/bin/env node

import { AgentManager } from "../agents/manager.js";
import { LoadSheafChatConfig } from "./config.js";
import { FindServiceByName, LoadServiceRegistry } from "./service_registry.js";
import { CreateSheafChatServer, x_serviceName } from "./server.js";

async function main(): Promise<void>
{
  const config = await LoadSheafChatConfig();
  const services = await LoadServiceRegistry(config.paths.servicesJsonFile);
  const service = FindServiceByName(services, x_serviceName);

  if (service === undefined)
  {
    throw new Error(`${x_serviceName} is not registered in config/services.json`);
  }

  const agentManager = await AgentManager.Create({ config });
  const server = CreateSheafChatServer({
    config,
    bindHost: service.host,
    bindPort: service.port,
    agentManager,
    onShutdownComplete: () =>
    {
      process.exit(0);
    },
  });

  const port = await server.listen();
  console.error(`Sheaf Chat listening on ${service.host}:${port}`);
}

main().catch((error: unknown) =>
{
  console.error(error);
  process.exitCode = 1;
});
