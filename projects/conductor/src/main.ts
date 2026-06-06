#!/usr/bin/env node

import { HealthPoller } from "./health_poller.js";
import { createRepoPaths } from "./paths.js";
import { loadServiceRegistry } from "./service_registry.js";
import { createConductorServer, findConductorService } from "./server.js";
import { createShutdownController } from "./shutdown.js";

async function main(): Promise<void>
{
  const paths = createRepoPaths();
  const services = await loadServiceRegistry(paths.servicesJsonPath);
  const conductor = findConductorService(services);
  const healthPoller = new HealthPoller({ services });
  let conductorServer: ReturnType<typeof createConductorServer> | undefined;

  const shutdownController = createShutdownController({
    stopPoller: () => healthPoller.stop(),
    closeServer: async () =>
    {
      if (conductorServer)
      {
        await conductorServer.close();
      }
    },
    exitProcess: (code) =>
    {
      process.exit(code ?? 0);
    },
  });

  conductorServer = createConductorServer({
    services,
    bindHost: conductor.host,
    bindPort: conductor.port,
    healthPoller,
    shutdownController,
  });

  const port = await conductorServer.listen();
  healthPoller.start();

  console.error(`Conductor listening on ${conductor.host}:${port}`);
}

main().catch((error: unknown) =>
{
  console.error(error);
  process.exitCode = 1;
});
