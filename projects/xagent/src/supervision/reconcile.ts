import type { OwnedProcessIdentity } from "../adapters/types.js";
import {
  appendNormalizedEvent,
  listRuns,
  openRunRecord,
  updateRunSupervision,
  type RunRecord,
} from "../logs.js";
import type { ProcessInspection, ProcessInspector } from "./process_identity.js";
import type {
  SupervisionEvent,
  SupervisionPhase,
  WatchdogAggregate,
} from "./types.js";

const activePhases = new Set<SupervisionPhase>([
  "starting",
  "running",
  "ready",
]);

export type ReconciliationCleanup =
  | "terminated"
  | "identity_mismatch"
  | "process_not_found"
  | "process_group_unproven"
  | "inspection_failed"
  | "termination_failed"
  | "persistence_failed";

export type ReconciliationResult = {
  readonly run_id: string;
  readonly cleanup: ReconciliationCleanup;
};

export async function reconcileStaleRuns(
  logRoot: string,
  processInspector: ProcessInspector,
): Promise<ReconciliationResult[]> {
  const results: ReconciliationResult[] = [];
  for (const metadata of await listRuns(logRoot)) {
    if (!activePhases.has(metadata.supervision.phase)) {
      continue;
    }
    try {
      results.push(
        await reconcileStaleRun(
          logRoot,
          metadata.run_id,
          processInspector,
        ),
      );
    } catch {
      results.push({
        run_id: metadata.run_id,
        cleanup: "persistence_failed",
      });
    }
  }
  return results;
}

async function reconcileStaleRun(
  logRoot: string,
  runId: string,
  processInspector: ProcessInspector,
): Promise<ReconciliationResult> {
  const record = await openRunRecord(logRoot, runId);
  record.exit_status = "failed";
  await persistReconciliationEvent(record, {
    type: "supervision.state",
    phase: "abandoned",
    reason: "stale_run_abandoned",
  });
  await persistReconciliationEvent(record, {
    type: "supervision.attention",
    phase: "abandoned",
    reason: "stale_run_abandoned",
    payload: {
      cleanup: "pending",
      owned_process_recorded: record.owned_process !== undefined,
    },
  }, true);

  const cleanup = await cleanupOwnedProcess(record.owned_process, processInspector);
  await persistReconciliationEvent(record, {
    type: "supervision.state",
    phase: "abandoned",
    reason: cleanupReason(cleanup),
  });
  return { run_id: record.run_id, cleanup };
}

async function cleanupOwnedProcess(
  ownedProcess: OwnedProcessIdentity | undefined,
  inspector: ProcessInspector,
): Promise<ReconciliationCleanup> {
  if (ownedProcess === undefined) {
    return "process_not_found";
  }

  let current: ProcessInspection | undefined;
  try {
    current = await inspector.inspect(ownedProcess.pid);
  } catch {
    return "inspection_failed";
  }
  if (current === undefined) {
    return "process_not_found";
  }
  if (current.start_identity !== ownedProcess.start_identity) {
    return "identity_mismatch";
  }
  if (
    ownedProcess.process_group_id === undefined
    || current.process_group_id === undefined
    || current.process_group_id !== ownedProcess.process_group_id
  ) {
    return "process_group_unproven";
  }
  try {
    await inspector.terminateProcessGroup(current.process_group_id);
    return "terminated";
  } catch {
    return "termination_failed";
  }
}

async function persistReconciliationEvent(
  record: RunRecord,
  body: Pick<SupervisionEvent, "type" | "phase" | "reason" | "payload">,
  attention = false,
): Promise<void> {
  const sequence = record.supervision.sequence + 1;
  const event: SupervisionEvent = {
    schema_version: 1,
    run_id: record.run_id,
    sequence,
    timestamp: new Date().toISOString(),
    type: body.type,
    phase: body.phase,
    reason: body.reason,
    ...(body.payload === undefined ? {} : { payload: body.payload }),
  };
  await appendNormalizedEvent(record, event);
  const watchdog: WatchdogAggregate = attention
    ? {
        ...record.watchdog,
        controller_wake_count: record.watchdog.controller_wake_count + 1,
        deterministic_alert_count: record.watchdog.deterministic_alert_count + 1,
      }
    : record.watchdog;
  await updateRunSupervision(record, {
    ...record.supervision,
    phase: "abandoned",
    sequence,
    owned_process: record.owned_process,
    watchdog,
  });
}

function cleanupReason(cleanup: ReconciliationCleanup): string {
  const reasons: Record<ReconciliationCleanup, string> = {
    terminated: "stale_process_terminated",
    identity_mismatch: "stale_process_identity_mismatch",
    process_not_found: "stale_process_not_found",
    process_group_unproven: "stale_process_group_unproven",
    inspection_failed: "stale_process_inspection_failed",
    termination_failed: "stale_process_termination_failed",
    persistence_failed: "stale_run_persistence_failed",
  };
  return reasons[cleanup];
}
