#!/usr/bin/env node

import { loadXagentServiceConfig } from "./service/config.js";
import { createUncaughtExceptionHandler } from "./service/crash_handler.js";
import {
  logReconciliationResults,
  reconciliationWarning,
} from "./service/reconciliation.js";
import { XagentRunManager } from "./service/run_manager.js";
import { createTestAdapterFactory, isTestAdapterEnabled } from "./service/test_hooks.js";
import {
  createShutdownController,
  createXagentServer,
  type XagentServer,
  type XagentShutdownController,
} from "./service/server.js";
import { platformProcessInspector } from "./supervision/process_identity.js";
import { reconcileStaleRuns } from "./supervision/reconcile.js";

async function main(): Promise<void> {
  const config = await loadXagentServiceConfig();

  const reconciliationResults = await reconcileStaleRuns(
    config.logRoot,
    platformProcessInspector,
  );
  // Surface reconciliation outcomes to the operator: log each result to
  // stderr for Conductor capture, and derive the `/health` warning from
  // any non-clean outcome so a sandbox-bypassed child that could not be
  // terminated is visible rather than silent. Previously the return value
  // was discarded and `/health` could never report degradation.
  //
  logReconciliationResults(reconciliationResults);
  const warning = reconciliationWarning(reconciliationResults);

  const runManager = new XagentRunManager({
    repoRoot: config.repoRoot,
    logRoot: config.logRoot,
    policy: {
      silenceTimeoutMs: 300_000,
      watchdog: {},
    },
    ...(isTestAdapterEnabled()
      ? { adapterFactory: createTestAdapterFactory() }
      : {}),
  });

  // Last-resort guard against an unhandled error taking down the whole
  // service before owned provider process groups are cleaned up. The
  // supervisor runs in-process with every active run, so an uncaught
  // exception (e.g. a stray stream `error` event that escaped the per-spawn
  // stdin guards) would otherwise orphan every detached provider group
  // until the next manual restart + reconciliation. Log, attempt an
  // orderly close of owned runs, then exit non-zero.
  //
  process.on("uncaughtException", createUncaughtExceptionHandler({ runManager }));

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
    ...(warning !== undefined ? { warning } : {}),
  });

  const port = await server.listen();
  console.error(`xagent service listening on ${config.bindHost}:${port}`);
}

main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
