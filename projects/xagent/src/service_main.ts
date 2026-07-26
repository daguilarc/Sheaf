#!/usr/bin/env node

import { loadXagentServiceConfig } from "./service/config.js";
import { XagentRunManager } from "./service/run_manager.js";
import {
  createXagentServer,
  type XagentServer,
  type XagentShutdownController,
} from "./service/server.js";
import { platformProcessInspector } from "./supervision/process_identity.js";
import { reconcileStaleRuns } from "./supervision/reconcile.js";

async function main(): Promise<void> {
  const config = await loadXagentServiceConfig();

  await reconcileStaleRuns(config.logRoot, platformProcessInspector);

  const runManager = new XagentRunManager({
    repoRoot: config.repoRoot,
    logRoot: config.logRoot,
    policy: {
      silenceTimeoutMs: 300_000,
      watchdog: {},
    },
  });

  let server: XagentServer | undefined;
  const shutdownController: XagentShutdownController = createShutdownController({
    closeRuns: () => runManager.closeAll(),
    closeServer: async () => {
      await server?.close();
    },
    onShutdownComplete: () => {
      process.exit(0);
    },
  });

  server = createXagentServer({
    bindHost: config.bindHost,
    bindPort: config.bindPort,
    runManager,
    shutdownController,
  });

  const port = await server.listen();
  console.error(`xagent service listening on ${config.bindHost}:${port}`);
}

function createShutdownController(deps: {
  closeRuns: () => Promise<void>;
  closeServer: () => Promise<void>;
  onShutdownComplete?: () => void;
}): XagentShutdownController {
  let requested = false;
  let pending: Promise<void> | undefined;
  return {
    requestShutdown(): Promise<void> {
      if (pending !== undefined) {
        return pending;
      }
      requested = true;
      pending = (async () => {
        try {
          await deps.closeRuns();
        } finally {
          await deps.closeServer();
          deps.onShutdownComplete?.();
        }
      })();
      return pending;
    },
    wasShutdownRequested(): boolean {
      return requested;
    },
  };
}

main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
