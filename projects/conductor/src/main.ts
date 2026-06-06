#!/usr/bin/env node

import { createRepoPaths } from "./paths.js";
import { findServiceByName, loadServiceRegistry } from "./service_registry.js";

async function main(): Promise<void>
{
  const paths = createRepoPaths();
  const services = await loadServiceRegistry(paths.servicesJsonPath);
  const conductor = findServiceByName(services, "conductor");

  if (!conductor)
  {
    console.error("conductor service is not registered in config/services.json");
    process.exitCode = 1;
    return;
  }

  console.error(
    `Conductor server not implemented yet (configured for ${conductor.host}:${conductor.port})`,
  );
  process.exitCode = 1;
}

main().catch((error: unknown) =>
{
  console.error(error);
  process.exitCode = 1;
});
