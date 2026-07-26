import type { ProcessInspector } from "./process_identity.js";
export type ReconciliationCleanup = "terminated" | "identity_mismatch" | "process_not_found" | "process_group_unproven" | "inspection_failed" | "termination_failed" | "persistence_failed";
export type ReconciliationResult = {
    readonly run_id: string;
    readonly cleanup: ReconciliationCleanup;
};
export declare function reconcileStaleRuns(logRoot: string, processInspector: ProcessInspector): Promise<ReconciliationResult[]>;
//# sourceMappingURL=reconcile.d.ts.map