import { appendNormalizedEvent, listRuns, openRunRecord, updateRunSupervision, } from "../logs.js";
const activePhases = new Set([
    "starting",
    "running",
    "ready",
]);
export async function reconcileStaleRuns(logRoot, processInspector, liveRunIds) {
    const results = [];
    for (const metadata of await listRuns(logRoot)) {
        if (!activePhases.has(metadata.supervision.phase)) {
            continue;
        }
        // Skip runs owned by the live XagentRunManager of this same service
        // instance. After C1 moved reconciliation to run after `listen()`
        // resolved, a run created in the listen→reconcile window would
        // otherwise be enumerated from the log root, classified as stale,
        // marked `abandoned`, and have its (matching) owned provider
        // process group SIGTERMed — silently destroying in-flight work
        // owned by this very instance. The live manager's `listRunIds()`
        // is the authoritative set of runs this instance owns.
        //
        if (liveRunIds !== undefined && liveRunIds.has(metadata.run_id)) {
            continue;
        }
        try {
            results.push(await reconcileStaleRun(logRoot, metadata.run_id, processInspector));
        }
        catch {
            results.push({
                run_id: metadata.run_id,
                cleanup: "persistence_failed",
            });
        }
    }
    return results;
}
async function reconcileStaleRun(logRoot, runId, processInspector) {
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
async function cleanupOwnedProcess(ownedProcess, inspector) {
    if (ownedProcess === undefined) {
        return "process_not_found";
    }
    let current;
    try {
        current = await inspector.inspect(ownedProcess.pid);
    }
    catch {
        return "inspection_failed";
    }
    if (current === undefined) {
        return "process_not_found";
    }
    if (current.start_identity !== ownedProcess.start_identity) {
        return "identity_mismatch";
    }
    if (ownedProcess.process_group_id === undefined
        || current.process_group_id === undefined
        || current.process_group_id !== ownedProcess.process_group_id) {
        return "process_group_unproven";
    }
    try {
        await inspector.terminateProcessGroup(current.process_group_id);
        return "terminated";
    }
    catch {
        return "termination_failed";
    }
}
async function persistReconciliationEvent(record, body, attention = false) {
    const sequence = record.supervision.sequence + 1;
    const event = {
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
    const watchdog = attention
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
function cleanupReason(cleanup) {
    const reasons = {
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
//# sourceMappingURL=reconcile.js.map