import type {
  ReconciliationCleanup,
  ReconciliationResult,
} from "../supervision/reconcile.js";

// Outcomes that indicate supervision is degraded after startup
// reconciliation: the stale owned process could not be provably terminated
// (it may still be running unattended) or the abandonment metadata could
// not be persisted. `terminated` and `process_not_found` are clean: either
// the stale process was killed or it was already gone.
//
const degradedCleanups: ReadonlySet<ReconciliationCleanup> = new Set([
  "identity_mismatch",
  "process_group_unproven",
  "inspection_failed",
  "termination_failed",
  "persistence_failed",
]);

export function isDegradedReconciliationCleanup(
  cleanup: ReconciliationCleanup,
): boolean {
  return degradedCleanups.has(cleanup);
}

// Returns a bounded health warning string when any reconciliation result
// represents a degraded outcome, or `undefined` when every stale run was
// cleaned up cleanly (or there were no stale runs). Wired into the
// production service_main path so `/health` reflects reconciliation
// outcomes rather than a constructor-only option.
//
export function reconciliationWarning(
  results: readonly ReconciliationResult[],
): string | undefined {
  const degraded = results.filter((result) =>
    isDegradedReconciliationCleanup(result.cleanup)
  );
  if (degraded.length === 0) {
    return undefined;
  }
  return `supervision_degraded: ${degraded.length} stale run(s) require attention`;
}

// Logs each reconciliation result to stderr for Conductor log capture.
// Each line is bounded and structured so an operator can grep for the
// run_id and cleanup outcome without replaying run logs.
//
export function logReconciliationResults(
  results: readonly ReconciliationResult[],
  log: (message: string) => void = defaultLog,
): void {
  for (const result of results) {
    log(
      `xagent service reconciliation: run_id=${result.run_id} cleanup=${result.cleanup}`,
    );
  }
}

function defaultLog(message: string): void {
  console.error(message);
}
