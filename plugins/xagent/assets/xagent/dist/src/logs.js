import { appendFile, mkdir, readFile, readdir, rename, unlink, writeFile } from "node:fs/promises";
import path from "node:path";
import { randomBytes } from "node:crypto";
const GENERATED_RUN_ID_PATTERN = /^xrun_[0-9]{17}_[0-9a-f]{8}$/;
const TEST_RUN_ID_PATTERN = /^xrun_[A-Za-z0-9_]+$/;
export async function createRunRecord(options) {
    const clock = options.clock ?? (() => new Date());
    const runId = options.runId ?? generateRunId(clock());
    validateRunIdForCreate(runId);
    const logRoot = options.logRoot ?? getDefaultLogRoot(options.repoRoot);
    const runDir = getRunDir(logRoot, runId);
    const metadataPath = path.join(runDir, "metadata.json");
    const normalizedLogPath = path.join(runDir, "normalized.jsonl");
    const rawProviderLogPath = path.join(runDir, "raw-provider.jsonl");
    const watchdogLogPath = path.join(runDir, "watchdog.jsonl");
    const timestamp = clock().toISOString();
    await mkdir(runDir, { recursive: true });
    await writeFile(normalizedLogPath, "", { flag: "a" });
    await writeFile(rawProviderLogPath, "", { flag: "a" });
    await writeFile(watchdogLogPath, "", { flag: "a" });
    const metadata = {
        run_id: runId,
        harness: options.harness,
        mode: options.mode,
        model: options.model,
        thinking_level: options.thinkingLevel,
        created_at: timestamp,
        updated_at: timestamp,
        exit_status: "running",
        ...(options.supervised === undefined ? {} : { supervised: options.supervised }),
        supervision: {
            phase: "starting",
            sequence: 0,
            last_transport_progress_at: timestamp,
            last_semantic_progress_at: timestamp,
            provider_thread_id: undefined,
        },
        watchdog: {
            invocation_count: 0,
            controller_wake_count: 0,
            deterministic_alert_count: 0,
            evidence_truncation_count: 0,
        },
        owned_process: undefined,
        paths: {
            run_dir: path.relative(logRoot, runDir),
            metadata: path.relative(logRoot, metadataPath),
            normalized: path.relative(logRoot, normalizedLogPath),
            raw_provider: path.relative(logRoot, rawProviderLogPath),
            watchdog: path.relative(logRoot, watchdogLogPath),
        },
        runDir,
        metadataPath,
        normalizedLogPath,
        rawProviderLogPath,
        watchdogLogPath,
    };
    await writeMetadata(metadata);
    return metadata;
}
export async function appendNormalizedEvent(record, event) {
    await appendJsonLine(record.normalizedLogPath, event);
}
export async function openRunRecord(logRoot, runId) {
    validateRunIdForCreate(runId);
    const runDir = getRunDir(logRoot, runId);
    const metadataPath = path.join(runDir, "metadata.json");
    assertPathInside(logRoot, metadataPath);
    const metadata = JSON.parse(await readFile(metadataPath, "utf8"));
    if (metadata.run_id !== runId) {
        throw new Error(`Run metadata id ${metadata.run_id} does not match directory ${runId}.`);
    }
    return {
        ...metadata,
        runDir,
        metadataPath,
        normalizedLogPath: path.join(runDir, "normalized.jsonl"),
        rawProviderLogPath: path.join(runDir, "raw-provider.jsonl"),
        watchdogLogPath: path.join(runDir, "watchdog.jsonl"),
    };
}
export async function appendRawProviderEvent(record, event) {
    await appendJsonLine(record.rawProviderLogPath, event);
}
export async function appendWatchdogTelemetry(record, telemetry) {
    await appendJsonLine(record.watchdogLogPath, telemetry);
}
export async function updateRunExitStatus(record, exitStatus, clock = () => new Date()) {
    record.exit_status = exitStatus;
    // Advance the supervision phase to a terminal value matching the exit
    // status. The legacy `xagent run` runtime (runtime.ts) only calls
    // `updateRunExitStatus` and never advances `supervision.phase`, so
    // without this advancement a successful interactive run would persist
    // `phase: "starting"` alongside `exit_status: "completed"`. The next
    // service start would then enumerate it from the log root as stale
    // and rewrite it to `abandoned`/`failed` with fabricated
    // `stale_run_abandoned` attention events — corrupting every
    // historical successful interactive run. Advancing phase here keeps
    // list/reconcile consistent for both supervised and legacy paths. We
    // only advance when the exit status is terminal AND the current phase
    // is non-terminal, so a supervised run that already published a more
    // specific terminal phase (`cancelled`/`abandoned`) is not
    // overwritten, and an intermediate `running` status update does not
    // falsely mark a run completed.
    //
    if ((exitStatus === "completed" || exitStatus === "failed")
        && !terminalSupervisionPhases.has(record.supervision.phase)) {
        record.supervision = {
            ...record.supervision,
            phase: exitStatus === "failed" ? "failed" : "completed",
        };
    }
    record.updated_at = clock().toISOString();
    await writeMetadata(record);
}
const terminalSupervisionPhases = new Set([
    "completed",
    "failed",
    "cancelled",
    "abandoned",
]);
export async function updateRunSupervision(record, update, clock = () => new Date()) {
    const { watchdog, owned_process, ...supervision } = update;
    record.supervision = supervision;
    if (watchdog !== undefined) {
        record.watchdog = watchdog;
    }
    record.owned_process = owned_process;
    // `updateRunExitStatus` is called only from the legacy `xagent run` runtime,
    // so every service-owned run persisted `exit_status: "running"` forever while
    // `supervision.phase` in the same file said completed/failed/cancelled. The
    // phase is authoritative; derive the legacy field from it so both agree on
    // the supervised path too.
    //
    if (terminalSupervisionPhases.has(supervision.phase)) {
        record.exit_status = supervision.phase === "completed" ? "completed" : "failed";
    }
    record.updated_at = clock().toISOString();
    await writeMetadata(record);
}
export async function listRuns(logRoot) {
    const root = logRoot;
    let entries;
    try {
        entries = await readdir(root);
    }
    catch (error) {
        if (isNodeError(error) && error.code === "ENOENT") {
            return [];
        }
        throw error;
    }
    const runs = [];
    for (const entry of entries) {
        const metadataPath = path.join(root, entry, "metadata.json");
        let raw;
        try {
            raw = await readFile(metadataPath, "utf8");
        }
        catch (error) {
            // Skip missing or non-directory stray entries; surface other I/O failures.
            if (isNodeError(error)
                && (error.code === "ENOENT" || error.code === "ENOTDIR")) {
                continue;
            }
            throw error;
        }
        let parsed;
        try {
            parsed = JSON.parse(raw);
        }
        catch {
            continue;
        }
        const metadata = normalizeListedRunMetadata(parsed);
        if (metadata === undefined) {
            continue;
        }
        runs.push(metadata);
    }
    return runs.sort((left, right) => right.created_at.localeCompare(left.created_at));
}
export async function readNormalizedLog(logRoot, runId) {
    validateGeneratedRunId(runId);
    const logPath = path.join(getRunDir(logRoot, runId), "normalized.jsonl");
    assertPathInside(logRoot, logPath);
    return readFile(logPath, "utf8");
}
export function generateRunId(date = new Date()) {
    const timestamp = date.toISOString().replace(/[-:.TZ]/g, "").slice(0, 17);
    return `xrun_${timestamp}_${randomBytes(4).toString("hex")}`;
}
export function getDefaultLogRoot(repoRoot) {
    return path.join(repoRoot, "data", "xagent");
}
function getRunDir(logRoot, runId) {
    return path.join(logRoot, runId);
}
function validateRunIdForCreate(runId) {
    if (!TEST_RUN_ID_PATTERN.test(runId)) {
        throw new Error(`Invalid run id: ${runId}`);
    }
}
function validateGeneratedRunId(runId) {
    if (!GENERATED_RUN_ID_PATTERN.test(runId)) {
        throw new Error(`Invalid run id: ${runId}`);
    }
}
function assertPathInside(root, candidate) {
    const resolvedRoot = path.resolve(root);
    const resolvedCandidate = path.resolve(candidate);
    const relative = path.relative(resolvedRoot, resolvedCandidate);
    if (relative.startsWith("..") || path.isAbsolute(relative)) {
        throw new Error(`Path escapes xagent data directory: ${candidate}`);
    }
}
async function appendJsonLine(filePath, value) {
    await appendFile(filePath, `${JSON.stringify(value)}\n`);
}
async function writeMetadata(record) {
    const { runDir: _runDir, metadataPath: _metadataPath, normalizedLogPath: _normalized, rawProviderLogPath: _raw, watchdogLogPath: _watchdog, ...metadata } = record;
    const temporaryPath = path.join(path.dirname(record.metadataPath), `.${path.basename(record.metadataPath)}.${process.pid}.${randomBytes(6).toString("hex")}.tmp`);
    try {
        await writeFile(temporaryPath, `${JSON.stringify(metadata, null, 2)}\n`);
        await rename(temporaryPath, record.metadataPath);
    }
    finally {
        try {
            await unlink(temporaryPath);
        }
        catch (error) {
            if (!isNodeError(error) || error.code !== "ENOENT") {
                throw error;
            }
        }
    }
}
function isNodeError(error) {
    return error instanceof Error && "code" in error;
}
function normalizeListedRunMetadata(value) {
    if (!isLegacyListableRunMetadata(value)) {
        return undefined;
    }
    const createdAt = value.created_at;
    const supervision = isRecord(value.supervision) && isSupervisionBlock(value.supervision)
        ? {
            phase: value.supervision.phase,
            sequence: value.supervision.sequence,
            last_transport_progress_at: value.supervision.last_transport_progress_at,
            last_semantic_progress_at: value.supervision.last_semantic_progress_at,
            provider_thread_id: value.supervision.provider_thread_id,
        }
        : {
            phase: phaseFromLegacyExitStatus(value.exit_status),
            sequence: 0,
            last_transport_progress_at: createdAt,
            last_semantic_progress_at: createdAt,
            provider_thread_id: undefined,
        };
    const watchdog = isRecord(value.watchdog) && isWatchdogAggregate(value.watchdog)
        ? value.watchdog
        : {
            invocation_count: 0,
            controller_wake_count: 0,
            deterministic_alert_count: 0,
            evidence_truncation_count: 0,
        };
    const paths = value.paths;
    const watchdogPath = typeof paths.watchdog === "string"
        ? paths.watchdog
        : path.join(paths.run_dir, "watchdog.jsonl");
    return {
        run_id: value.run_id,
        harness: value.harness,
        mode: value.mode,
        ...(value.model === undefined ? {} : { model: value.model }),
        ...(value.thinking_level === undefined ? {} : { thinking_level: value.thinking_level }),
        created_at: value.created_at,
        updated_at: value.updated_at,
        exit_status: value.exit_status,
        ...(value.supervised === undefined ? {} : { supervised: value.supervised }),
        supervision,
        watchdog,
        ...(value.owned_process === undefined ? {} : { owned_process: value.owned_process }),
        paths: {
            run_dir: paths.run_dir,
            metadata: paths.metadata,
            normalized: paths.normalized,
            raw_provider: paths.raw_provider,
            watchdog: watchdogPath,
        },
    };
}
function isLegacyListableRunMetadata(value) {
    if (!isRecord(value) || !isRecord(value.paths)) {
        return false;
    }
    return (typeof value.run_id === "string"
        && (value.harness === "codex"
            || value.harness === "pi"
            || value.harness === "cursor"
            || value.harness === "claude_code")
        && (value.mode === "subagent" || value.mode === "full")
        && (value.model === undefined || typeof value.model === "string")
        && (value.thinking_level === undefined
            || value.thinking_level === "low"
            || value.thinking_level === "medium"
            || value.thinking_level === "high"
            || value.thinking_level === "xhigh")
        && typeof value.created_at === "string"
        && typeof value.updated_at === "string"
        && (value.exit_status === "running"
            || value.exit_status === "completed"
            || value.exit_status === "failed")
        && (value.supervised === undefined
            || typeof value.supervised === "boolean")
        && (value.supervision === undefined
            || (isRecord(value.supervision) && isSupervisionBlock(value.supervision)))
        && (value.watchdog === undefined
            || (isRecord(value.watchdog) && isWatchdogAggregate(value.watchdog)))
        && (value.owned_process === undefined
            || isOwnedProcessIdentity(value.owned_process))
        && typeof value.paths.run_dir === "string"
        && typeof value.paths.metadata === "string"
        && typeof value.paths.normalized === "string"
        && typeof value.paths.raw_provider === "string"
        && (value.paths.watchdog === undefined || typeof value.paths.watchdog === "string"));
}
function isSupervisionBlock(value) {
    return ((value.phase === "starting"
        || value.phase === "running"
        || value.phase === "ready"
        || value.phase === "completed"
        || value.phase === "failed"
        || value.phase === "cancelled"
        || value.phase === "abandoned")
        && Number.isSafeInteger(value.sequence)
        && typeof value.last_transport_progress_at === "string"
        && typeof value.last_semantic_progress_at === "string"
        && (value.provider_thread_id === undefined
            || typeof value.provider_thread_id === "string"));
}
function isWatchdogAggregate(value) {
    return isNonNegativeInteger(value.invocation_count)
        && isNonNegativeInteger(value.controller_wake_count)
        && isNonNegativeInteger(value.deterministic_alert_count)
        && isNonNegativeInteger(value.evidence_truncation_count);
}
function phaseFromLegacyExitStatus(exitStatus) {
    if (exitStatus === "failed") {
        return "failed";
    }
    if (exitStatus === "completed") {
        return "completed";
    }
    // Pre-supervision runs with exit_status "running" are historical artifacts,
    // not live supervised workers — treat them as completed so list remains
    // useful without feeding them into restart reconciliation.
    return "completed";
}
function isOwnedProcessIdentity(value) {
    return isRecord(value)
        && isPositiveInteger(value.pid)
        && (value.process_group_id === undefined
            || isPositiveInteger(value.process_group_id))
        && typeof value.started_at === "string"
        && typeof value.start_identity === "string";
}
function isNonNegativeInteger(value) {
    return typeof value === "number"
        && Number.isSafeInteger(value)
        && value >= 0;
}
function isPositiveInteger(value) {
    return typeof value === "number"
        && Number.isSafeInteger(value)
        && value > 0;
}
function isRecord(value) {
    return typeof value === "object" && value !== null && !Array.isArray(value);
}
//# sourceMappingURL=logs.js.map